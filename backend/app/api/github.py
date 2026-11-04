from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from urllib.parse import urlencode

from app.core.access import require_github_account
from app.core.audit import audit_log
from app.core.database import get_db
from app.core.security import (
    UserContext,
    create_oauth_state,
    decrypt_token,
    encrypt_token,
    get_current_user,
    verify_oauth_state,
)
from app.core.settings import settings
from app.services.github_service import GitHubService, exchange_code_for_token, get_authenticated_user

router = APIRouter(prefix="/github", tags=["github"])


def _upsert_user_id(db: Session, current_user: UserContext) -> str:
    result = db.execute(
        text(
            """
            INSERT INTO users (id, auth0_sub, email, name)
            VALUES (gen_random_uuid(), :auth0_sub, :email, :name)
            ON CONFLICT (auth0_sub)
            DO UPDATE SET
                email = EXCLUDED.email,
                name = EXCLUDED.name,
                updated_at = NOW()
            RETURNING id
            """
        ),
        {
            "auth0_sub": current_user.sub,
            "email": current_user.email,
            "name": current_user.name,
        },
    ).fetchone()
    db.commit()
    return str(result[0])


@router.get("/connect-url")
def github_connect_url(
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = _upsert_user_id(db, current_user)
    state, code_verifier, code_challenge = create_oauth_state()
    db.execute(
        text("DELETE FROM github_oauth_states WHERE expires_at <= NOW()")
    )
    db.execute(
        text(
            """
            INSERT INTO github_oauth_states (
                state_id, user_id, code_verifier_encrypted, expires_at
            )
            VALUES (:state_id, :user_id, :code_verifier_encrypted, NOW() + INTERVAL '10 minutes')
            """
        ),
        {
            "state_id": verify_oauth_state(state),
            "user_id": user_id,
            "code_verifier_encrypted": encrypt_token(code_verifier),
        },
    )
    db.commit()
    params = {
        "client_id": settings.GITHUB_CLIENT_ID,
        "redirect_uri": settings.GITHUB_OAUTH_REDIRECT_URI,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        # Always surface account selection to avoid sticky browser sessions
        # reconnecting to the previously active GitHub identity.
        "prompt": "select_account",
    }
    url = f"https://github.com/login/oauth/authorize?{urlencode(params)}"
    audit_log("github.connect_url.created", user_id=user_id, auth0_sub=current_user.sub)
    return {"url": url}


@router.get("/callback")
def github_callback(
    code: str | None = Query(None, min_length=1, max_length=256),
    state: str = Query(..., min_length=1, max_length=512),
    error: str | None = Query(None, max_length=128),
    redirect: bool = Query(True),
    db: Session = Depends(get_db),
):
    state_id = verify_oauth_state(state)
    state_record = db.execute(
        text(
            """
            DELETE FROM github_oauth_states
            WHERE state_id = :state_id
              AND expires_at > NOW()
            RETURNING user_id, code_verifier_encrypted
            """
        ),
        {"state_id": state_id},
    ).mappings().first()
    if not state_record:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OAuth state is invalid, expired, or already used",
        )
    db.commit()
    user_id = str(state_record["user_id"])
    code_verifier = decrypt_token(state_record["code_verifier_encrypted"])

    if error or not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GitHub App authorization was not completed",
        )

    token_data = exchange_code_for_token(code, code_verifier)
    oauth_error = token_data.get("error")
    if oauth_error:
        audit_log(
            "github.callback.exchange_failed",
            user_id=user_id,
            error=oauth_error,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"GitHub App authorization failed: {oauth_error}",
        )

    access_token = token_data.get("access_token")
    if not access_token:
        audit_log(
            "github.callback.exchange_missing_token",
            user_id=user_id,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GitHub App authorization did not return an access token. Check the app credentials and callback URL.",
        )
    if "expires_in" in token_data or token_data.get("refresh_token"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Expiring GitHub App tokens are not supported; disable user access token expiration.",
        )

    gh_user = get_authenticated_user(access_token)
    encrypted_token = encrypt_token(access_token)

    github_user_id = gh_user.get("id")
    if not github_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to read GitHub user id")

    # Keep one GitHub account per app user while allowing account re-link after auth migrations.
    db.execute(
        text(
            """
            DELETE FROM github_accounts
            WHERE user_id = :user_id
              AND github_user_id <> :github_user_id
            """
        ),
        {
            "user_id": user_id,
            "github_user_id": github_user_id,
        },
    )

    result = db.execute(
        text(
            """
            INSERT INTO github_accounts (
                id, user_id, github_user_id, username, access_token_encrypted, token_scopes, authorization_type
            )
            VALUES (
                gen_random_uuid(), :user_id, :github_user_id, :username, :access_token_encrypted, :token_scopes, 'github_app'
            )
            ON CONFLICT (github_user_id)
            DO UPDATE SET
                user_id = EXCLUDED.user_id,
                github_user_id = EXCLUDED.github_user_id,
                username = EXCLUDED.username,
                access_token_encrypted = EXCLUDED.access_token_encrypted,
                token_scopes = EXCLUDED.token_scopes,
                authorization_type = EXCLUDED.authorization_type,
                updated_at = NOW()
            RETURNING id;
            """
        ),
        {
            "user_id": user_id,
            "github_user_id": github_user_id,
            "username": gh_user.get("login"),
            "access_token_encrypted": encrypted_token,
            "token_scopes": token_data.get("scope"),
        },
    ).fetchone()
    db.commit()

    audit_log(
        "github.connected",
        user_id=user_id,
        github_account_id=str(result[0]),
        github_username=gh_user.get("login"),
    )

    if redirect:
        return RedirectResponse(url=f"{settings.FRONTEND_URL.split(',')[0]}/repositories")

    return {"status": "connected", "github_account_id": str(result[0])}


@router.get("/status")
def github_status(
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = _upsert_user_id(db, current_user)
    account = db.execute(
        text(
            """
            SELECT id, username, updated_at, authorization_type
            FROM github_accounts
            WHERE user_id = :user_id
            """
        ),
        {"user_id": user_id},
    ).mappings().first()

    connected = bool(account and account["authorization_type"] == "github_app")
    audit_log("github.status.checked", user_id=user_id, connected=connected)
    if not account:
        return {"connected": False, "account": None, "reauthorization_required": False}
    if not connected:
        audit_log("github.reauthorization.required", user_id=user_id)
        return {"connected": False, "account": None, "reauthorization_required": True}

    account_data = dict(account)
    account_data.pop("authorization_type")
    return {"connected": True, "account": account_data, "reauthorization_required": False}


@router.get("/repositories")
def list_repositories(
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    user_id = _upsert_user_id(db, current_user)
    gh_account = require_github_account(db, user_id)
    token = decrypt_token(gh_account["access_token_encrypted"])

    github = GitHubService(token)
    repos = github.list_repositories(page=page, per_page=per_page)
    repo_ids = [repo["id"] for repo in repos]

    synced_map: dict[int, dict] = {}
    if repo_ids:
        synced = db.execute(
            text(
                """
                SELECT
                    r.id AS repo_uuid,
                    r.github_repo_id,
                    r.synced_at,
                    COALESCE(pr_counts.pr_count, 0) AS pr_count
                FROM repositories r
                JOIN repository_access ra ON ra.repository_id = r.id
                LEFT JOIN (
                    SELECT repo_id, COUNT(*) AS pr_count
                    FROM pull_requests
                    GROUP BY repo_id
                ) pr_counts ON pr_counts.repo_id = r.id
                WHERE ra.github_account_id = :github_account_id
                  AND r.github_repo_id = ANY(:repo_ids)
                """
            ),
            {"repo_ids": repo_ids, "github_account_id": gh_account["id"]},
        ).mappings().all()
        synced_map = {
            row["github_repo_id"]: {
                "repo_uuid": str(row["repo_uuid"]),
                "synced_at": row["synced_at"],
                "pr_count": int(row["pr_count"] or 0),
            }
            for row in synced
        }

    response = []
    for repo in repos:
        sync_meta = synced_map.get(repo["id"], {})
        response.append(
            {
                "id": repo["id"],
                "name": repo["name"],
                "full_name": repo["full_name"],
                "private": repo.get("private", False),
                "default_branch": repo.get("default_branch"),
                "synced_at": sync_meta.get("synced_at"),
                "pr_count": sync_meta.get("pr_count", 0),
                "repo_uuid": sync_meta.get("repo_uuid"),
            }
        )

    audit_log(
        "github.repositories.listed",
        user_id=user_id,
        github_account_id=gh_account["id"],
        repository_count=len(response),
    )
    return {"repositories": response}
