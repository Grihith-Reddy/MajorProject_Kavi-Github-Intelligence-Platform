"""KAVI 2.0 insight endpoints: Why-Lens, repository tree, and (later) promises, graph and quality."""

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.access import assert_repo_access, require_github_account, require_user_id
from app.core.audit import audit_log
from app.core.database import SessionLocal, get_db
from app.core.security import UserContext, decrypt_token, get_current_user
from app.core.tokens import create_token, list_tokens, revoke_token
from app.services.eval_service import run_evaluation
from app.services.github_service import GitHubService
from app.services.map_service import build_knowledge_map
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
    as_of: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    repo = assert_repo_access(db, repo_id, current_user.sub)
    if ".." in path.split("/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file path")
    github = github_for_user(db, current_user)
    if as_of and not ref:
        # History slider: the file as it was at the end of that day.
        ref = github.commit_at(str(repo["full_name"]), str(repo.get("default_branch") or "main"), f"{as_of}T23:59:59Z")
        if not ref:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The repository had no commits by that date")
    result = get_file_why(db, repo_meta=repo, github=github, path=path, ref=ref)
    result["as_of"] = as_of
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


# ── Knowledge map ────────────────────────────────────────────────────────────


@router.get("/repositories/{repo_id}/knowledge-map")
def knowledge_map(
    repo_id: str,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assert_repo_access(db, repo_id, current_user.sub)
    result = build_knowledge_map(db, repo_id)
    audit_log("insights.map.viewed", auth0_sub=current_user.sub, repo_id=repo_id, modules=len(result["modules"]))
    return result


# ── Retrieval quality (evaluation harness) ───────────────────────────────────


def _run_evaluation_in_background(repo_id: str, run_id: str) -> None:
    session = SessionLocal()
    try:
        run_evaluation(session, repo_id, run_id)
    finally:
        session.close()


@router.post("/repositories/{repo_id}/quality/run")
def start_quality_run(
    repo_id: str,
    background_tasks: BackgroundTasks,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assert_repo_access(db, repo_id, current_user.sub)
    running = db.execute(
        text("SELECT id FROM eval_runs WHERE repo_id = :repo_id AND status = 'running' AND created_at > NOW() - INTERVAL '20 minutes'"),
        {"repo_id": repo_id},
    ).first()
    if running:
        return {"run_id": str(running[0]), "status": "running"}
    user_id = require_user_id(db, current_user.sub)
    run_id = db.execute(
        text("INSERT INTO eval_runs (repo_id, created_by_user_id) VALUES (:repo_id, :user_id) RETURNING id"),
        {"repo_id": repo_id, "user_id": user_id},
    ).scalar()
    db.commit()
    background_tasks.add_task(_run_evaluation_in_background, repo_id, str(run_id))
    audit_log("insights.quality.started", auth0_sub=current_user.sub, repo_id=repo_id, run_id=str(run_id))
    return {"run_id": str(run_id), "status": "running"}


@router.get("/repositories/{repo_id}/quality")
def quality_runs(
    repo_id: str,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assert_repo_access(db, repo_id, current_user.sub)
    rows = db.execute(
        text(
            """
            SELECT id, status, metrics, cases, error, created_at, finished_at
            FROM eval_runs
            WHERE repo_id = :repo_id
            ORDER BY created_at DESC
            LIMIT 10
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()
    runs = [dict(row) for row in rows]
    for run in runs[1:]:
        run["cases"] = None  # only the latest run needs per-question detail
    feedback = None
    try:
        stats = db.execute(
            text(
                """
                SELECT COUNT(*) FILTER (WHERE rating = 1) AS helpful,
                       COUNT(*) FILTER (WHERE rating = -1) AS not_helpful
                FROM chat_feedback WHERE repo_id = :repo_id
                """
            ),
            {"repo_id": repo_id},
        ).mappings().one()
        recent = db.execute(
            text(
                """
                SELECT f.reason, f.created_at, LEFT(m.content, 240) AS answer
                FROM chat_feedback f JOIN chat_messages m ON m.id = f.message_id
                WHERE f.repo_id = :repo_id AND f.rating = -1
                ORDER BY f.created_at DESC LIMIT 5
                """
            ),
            {"repo_id": repo_id},
        ).mappings().all()
        rated = int(stats["helpful"]) + int(stats["not_helpful"])
        feedback = {
            "helpful": int(stats["helpful"]),
            "not_helpful": int(stats["not_helpful"]),
            "helpful_rate": round(int(stats["helpful"]) / rated, 3) if rated else None,
            "recent_not_helpful": [dict(row) for row in recent],
        }
    except Exception:
        db.rollback()  # migration 006 not applied yet
    return {"runs": runs, "feedback": feedback}


# ── Repository health (repository cards) ─────────────────────────────────────


@router.get("/health")
def repositories_health(
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Small health summary for every repository the user can open."""
    user_id = require_user_id(db, current_user.sub)
    rows = db.execute(
        text(
            """
            SELECT DISTINCT r.id, r.synced_at,
                   (SELECT COUNT(*) FROM pull_requests pr WHERE pr.repo_id = r.id) AS pr_count,
                   (SELECT COUNT(*) FROM knowledge_entries k WHERE k.repo_id = r.id) AS indexed_count
            FROM repositories r
            JOIN repository_access ra ON ra.repository_id = r.id
            JOIN github_accounts ga ON ga.id = ra.github_account_id
            WHERE ga.user_id = :user_id
            """
        ),
        {"user_id": user_id},
    ).mappings().all()
    health: dict[str, Any] = {}
    for row in rows:
        repo_id = str(row["id"])
        entry: dict[str, Any] = {
            "synced_at": row["synced_at"],
            "pr_count": int(row["pr_count"] or 0),
            "indexed_count": int(row["indexed_count"] or 0),
            "open_promises": 0,
            "kept_promises": 0,
            "at_risk_modules": 0,
            "single_expert_modules": 0,
        }
        try:
            promise_counts = db.execute(
                text(
                    """
                    SELECT COUNT(*) FILTER (WHERE status = 'open') AS open,
                           COUNT(*) FILTER (WHERE status = 'kept') AS kept
                    FROM pr_promises WHERE repo_id = :repo_id
                    """
                ),
                {"repo_id": repo_id},
            ).mappings().one()
            entry["open_promises"] = int(promise_counts["open"] or 0)
            entry["kept_promises"] = int(promise_counts["kept"] or 0)
            if entry["indexed_count"]:
                summary = build_knowledge_map(db, repo_id)["summary"]
                entry["at_risk_modules"] = int(summary.get("at_risk") or 0)
                entry["single_expert_modules"] = int(summary.get("single_expert") or 0)
        except Exception:
            db.rollback()  # migration 005 missing: basic counts only
        health[repo_id] = entry
    return {"repositories": health}
