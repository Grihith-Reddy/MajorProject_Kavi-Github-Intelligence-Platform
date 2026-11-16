"""Endpoints for the KAVI MCP server (editor agents such as Claude Code or Cursor).

Authenticated with a personal 'mcp' token. Repositories can be referenced by
UUID or by full name (owner/name); access is checked for the token's owner.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.access import assert_repo_access
from app.core.audit import audit_log
from app.core.database import get_db
from app.core.security import UserContext
from app.core.tokens import TokenPrincipal, require_token
from app.services.agent_service import AgentUnavailable, RepoAgentTools, run_agent

router = APIRouter(prefix="/mcp", tags=["mcp"])


def _resolve_repo(db: Session, principal: TokenPrincipal, repo: str) -> dict[str, Any]:
    reference = (repo or "").strip()
    row = db.execute(
        text(
            """
            SELECT r.id
            FROM repositories r
            JOIN repository_access ra ON ra.repository_id = r.id
            JOIN github_accounts ga ON ga.id = ra.github_account_id
            WHERE ga.user_id = :user_id
              AND (CAST(r.id AS text) = :ref OR LOWER(r.full_name) = LOWER(:ref))
            LIMIT 1
            """
        ),
        {"user_id": principal.user_id, "ref": reference},
    ).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Repository '{reference}' is not synced in KAVI")
    return assert_repo_access(db, str(row[0]), principal.auth0_sub)


def _tools(db: Session, principal: TokenPrincipal, repo: str, as_of: str | None = None) -> RepoAgentTools:
    return RepoAgentTools(db, _resolve_repo(db, principal, repo), UserContext(sub=principal.auth0_sub), as_of=as_of)


@router.get("/repositories")
def mcp_repositories(principal: TokenPrincipal = Depends(require_token("mcp")), db: Session = Depends(get_db)):
    rows = db.execute(
        text(
            """
            SELECT DISTINCT r.id, r.full_name, r.default_branch, r.synced_at,
                   (SELECT COUNT(*) FROM pull_requests pr WHERE pr.repo_id = r.id) AS pr_count
            FROM repositories r
            JOIN repository_access ra ON ra.repository_id = r.id
            JOIN github_accounts ga ON ga.id = ra.github_account_id
            WHERE ga.user_id = :user_id
            ORDER BY r.full_name
            """
        ),
        {"user_id": principal.user_id},
    ).mappings().all()
    return {"repositories": [dict(row) for row in rows]}


class AskRequest(BaseModel):
    repo: str = Field(min_length=1, max_length=250)
    question: str = Field(min_length=1, max_length=4000)
    as_of: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


@router.post("/ask")
def mcp_ask(payload: AskRequest, principal: TokenPrincipal = Depends(require_token("mcp")), db: Session = Depends(get_db)):
    tools = _tools(db, principal, payload.repo, payload.as_of)
    steps: list[str] = []

    def _emit(name: str, data: dict[str, Any]) -> None:
        if name == "step" and data.get("status") != "running":
            steps.append(f"{data.get('label')} → {data.get('summary') or data.get('status')}")

    try:
        result = run_agent(payload.question, tools=tools, history=[], memory_note=None, emit=_emit)
    except AgentUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The AI provider is unavailable right now. Try again shortly.") from exc
    audit_log("mcp.ask.completed", user_id=principal.user_id, repo=payload.repo, steps=len(steps))
    sources = [
        {"pr_number": s.get("pr_number"), "title": s.get("pr_title"), "url": s.get("pr_url")}
        for s in tools.sources.values()
        if s.get("pr_number")
    ]
    return {"answer": result["answer"], "steps": steps, "sources": sources}


@router.get("/why")
def mcp_why(
    repo: str,
    path: str,
    start_line: int = Query(1, ge=1),
    end_line: int | None = Query(None, ge=1),
    principal: TokenPrincipal = Depends(require_token("mcp")),
    db: Session = Depends(get_db),
):
    tools = _tools(db, principal, repo)
    return tools.call("why_lines", {"path": path, "start_line": start_line, "end_line": end_line or start_line})


@router.get("/search")
def mcp_search(repo: str, q: str = Query(..., min_length=1, max_length=500), principal: TokenPrincipal = Depends(require_token("mcp")), db: Session = Depends(get_db)):
    return _tools(db, principal, repo).call("search_memory", {"query": q})


@router.get("/experts")
def mcp_experts(repo: str, topic: str = Query(..., min_length=1, max_length=300), principal: TokenPrincipal = Depends(require_token("mcp")), db: Session = Depends(get_db)):
    return _tools(db, principal, repo).call("who_knows", {"topic": topic})


@router.get("/promises")
def mcp_promises(repo: str, status_filter: str = Query("open", alias="status"), principal: TokenPrincipal = Depends(require_token("mcp")), db: Session = Depends(get_db)):
    return _tools(db, principal, repo).call("list_promises", {"status": status_filter})


@router.get("/pull-request")
def mcp_pull_request(repo: str, number: int = Query(..., ge=1), principal: TokenPrincipal = Depends(require_token("mcp")), db: Session = Depends(get_db)):
    return _tools(db, principal, repo).call("get_pull_request", {"number": number})
