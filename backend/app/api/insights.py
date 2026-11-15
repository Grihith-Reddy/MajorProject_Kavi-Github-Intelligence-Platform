"""KAVI 2.0 insight endpoints: Why-Lens, repository tree, and (later) promises, graph and quality."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
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
