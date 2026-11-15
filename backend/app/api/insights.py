"""KAVI 2.0 insight endpoints: Why-Lens, repository tree, and (later) promises, graph and quality."""

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.access import assert_repo_access, require_github_account, require_user_id
from app.core.audit import audit_log
from app.core.database import get_db
from app.core.security import UserContext, decrypt_token, get_current_user
from app.core.tokens import create_token, list_tokens, revoke_token
from app.services.github_service import GitHubService
from app.services.why_service import get_file_why

router = APIRouter(prefix="/insights", tags=["insights"])


def github_for_user(db: Session, current_user: UserContext) -> GitHubService:
    user_id = require_user_id(db, current_user.sub)
    account = require_github_account(db, user_id)
    return GitHubService(decrypt_token(account["access_token_encrypted"]))


@router.get("/repositories/{repo_id}/tree")
def repository_tree(
    repo_id: str,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repo = assert_repo_access(db, repo_id, current_user.sub)
    github = github_for_user(db, current_user)
    rows = github.list_repository_tree(
        str(repo["full_name"]), branch=str(repo.get("default_branch") or "main"), max_entries=10000
    )
    audit_log("insights.tree.viewed", auth0_sub=current_user.sub, repo_id=repo_id, count=len(rows))
    return {
        "branch": repo.get("default_branch"),
        "files": [{"path": row.get("path"), "size": row.get("size")} for row in rows if row.get("path")],
    }


@router.get("/repositories/{repo_id}/why")
def why_lens(
    repo_id: str,
    path: str = Query(..., min_length=1, max_length=500),
    ref: str | None = Query(None, max_length=200),
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    repo = assert_repo_access(db, repo_id, current_user.sub)
    if ".." in path.split("/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file path")
    github = github_for_user(db, current_user)
    result = get_file_why(db, repo_meta=repo, github=github, path=path, ref=ref)
    if not result.get("segments") and not result.get("content"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on this branch")
    audit_log("insights.why.viewed", auth0_sub=current_user.sub, repo_id=repo_id, path=path)
    return result


# ── Personal access tokens (Guardian GitHub Action / MCP server) ─────────────


class TokenCreateRequest(BaseModel):
    scope: str = Field(pattern=r"^(guardian|mcp)$")
    repo_id: str | None = Field(default=None, max_length=64)
    label: str | None = Field(default=None, max_length=80)


@router.get("/tokens")
def list_personal_tokens(
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = require_user_id(db, current_user.sub)
    return {"tokens": list_tokens(db, user_id=user_id)}


@router.post("/tokens")
def create_personal_token(
    payload: TokenCreateRequest,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = require_user_id(db, current_user.sub)
    if payload.scope == "guardian":
        if not payload.repo_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Guardian tokens need a repository")
        assert_repo_access(db, payload.repo_id, current_user.sub)
    token = create_token(
        db,
        user_id=user_id,
        scope=payload.scope,
        repo_id=payload.repo_id if payload.scope == "guardian" else None,
        label=payload.label,
    )
    audit_log("token.created", user_id=user_id, scope=payload.scope, repo_id=payload.repo_id)
    return {"token": token}


@router.post("/tokens/{token_id}/revoke")
def revoke_personal_token(
    token_id: str,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = require_user_id(db, current_user.sub)
    if not revoke_token(db, user_id=user_id, token_id=token_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")
    audit_log("token.revoked", user_id=user_id, token_id=token_id)
    return {"status": "revoked"}


# ── Promise Tracker ──────────────────────────────────────────────────────────


@router.get("/repositories/{repo_id}/promises")
def repository_promises(
    repo_id: str,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assert_repo_access(db, repo_id, current_user.sub)
    rows = db.execute(
        text(
            """
            SELECT p.id, p.quote, p.summary, p.kind, p.source, p.source_url, p.status, p.author_login,
                   p.made_at, p.resolution_note, p.resolution_confidence, p.updated_at,
                   pr.github_pr_number, pr.title AS pr_title, pr.url AS pr_url,
                   rp.github_pr_number AS resolved_pr_number, rp.title AS resolved_pr_title,
                   rp.url AS resolved_pr_url, rp.merged_at AS resolved_at
            FROM pr_promises p
            JOIN pull_requests pr ON pr.id = p.pr_id
            LEFT JOIN pull_requests rp ON rp.id = p.resolved_pr_id
            WHERE p.repo_id = :repo_id
            ORDER BY p.made_at ASC NULLS LAST
            LIMIT 500
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()
    promises = [dict(row) for row in rows]
    now = datetime.now(timezone.utc)
    open_ages = [
        (now - row["made_at"]).days for row in promises if row["status"] == "open" and row.get("made_at")
    ]
    kept_lags = [
        (row["resolved_at"] - row["made_at"]).days
        for row in promises
        if row["status"] == "kept" and row.get("resolved_at") and row.get("made_at")
    ]
    stats = {
        "total": len(promises),
        "open": sum(1 for row in promises if row["status"] == "open"),
        "kept": sum(1 for row in promises if row["status"] == "kept"),
        "dismissed": sum(1 for row in promises if row["status"] == "dismissed"),
        "oldest_open_days": max(open_ages) if open_ages else None,
        "median_open_days": sorted(open_ages)[len(open_ages) // 2] if open_ages else None,
        "median_days_to_keep": sorted(kept_lags)[len(kept_lags) // 2] if kept_lags else None,
    }
    audit_log("insights.promises.viewed", auth0_sub=current_user.sub, repo_id=repo_id, count=len(promises))
    return {"stats": stats, "promises": promises}


class PromiseStatusRequest(BaseModel):
    status: str = Field(pattern=r"^(open|kept|dismissed)$")


@router.post("/promises/{promise_id}/status")
def update_promise_status(
    promise_id: str,
    payload: PromiseStatusRequest,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", promise_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promise not found")
    row = db.execute(
        text("SELECT repo_id FROM pr_promises WHERE id = CAST(:id AS uuid)"), {"id": promise_id}
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promise not found")
    assert_repo_access(db, str(row["repo_id"]), current_user.sub)
    db.execute(
        text(
            """
            UPDATE pr_promises
            SET status = :status, updated_at = NOW(),
                resolution_note = CASE WHEN :status = 'open' THEN NULL ELSE COALESCE(resolution_note, 'Marked manually') END,
                resolved_pr_id = CASE WHEN :status = 'open' THEN NULL ELSE resolved_pr_id END
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"status": payload.status, "id": promise_id},
    )
    db.commit()
    return {"status": payload.status}
