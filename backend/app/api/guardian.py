"""KAVI Guardian endpoints.

The review endpoint is called by a GitHub Action in the user's repository with a
repo-scoped Guardian token. The Action (not KAVI) posts the comment with its own
GITHUB_TOKEN, so KAVI's GitHub App stays read-only.
"""

from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.access import assert_repo_access
from app.core.audit import audit_log
from app.core.database import get_db
from app.core.security import UserContext, get_current_user
from app.core.tokens import TokenPrincipal, require_token
from app.core.access import require_github_account
from app.core.settings import settings
from app.services.guardian_service import review_pull_request
from app.services.sync_jobs import enqueue_sync_job

router = APIRouter(prefix="/guardian", tags=["guardian"])


class GuardianFile(BaseModel):
    filename: str = Field(max_length=500)
    status: str | None = Field(default=None, max_length=32)
    patch: str | None = Field(default=None, max_length=6000)


class GuardianReviewRequest(BaseModel):
    pr_number: int = Field(ge=1)
    head_sha: str | None = Field(default=None, max_length=80)
    title: str = Field(default="", max_length=500)
    body: str | None = Field(default="", max_length=20000)
    author: str | None = Field(default=None, max_length=100)
    files: list[GuardianFile] = Field(default_factory=list, max_length=100)


@router.post("/review")
def guardian_review(
    payload: GuardianReviewRequest,
    principal: TokenPrincipal = Depends(require_token("guardian")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not principal.repo_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Guardian token is not bound to a repository")
    # The token owner must still have access to the repository.
    repo = assert_repo_access(db, principal.repo_id, principal.auth0_sub)
    result = review_pull_request(db, repo=repo, pr=payload.model_dump())
    audit_log(
        "guardian.review.completed",
        repo_id=principal.repo_id,
        pr_number=payload.pr_number,
        verdict=result["verdict"],
        findings=len(result["findings"]),
    )
    return result


@router.post("/sync")
def guardian_sync(
    background_tasks: BackgroundTasks,
    principal: TokenPrincipal = Depends(require_token("guardian")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Called by the Guardian Action when a PR merges: refresh KAVI's memory incrementally."""
    if not principal.repo_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Guardian token is not bound to a repository")
    repo = assert_repo_access(db, principal.repo_id, principal.auth0_sub)
    account = require_github_account(db, principal.user_id)
    job = enqueue_sync_job(
        db,
        user_id=principal.user_id,
        github_account_id=str(account["id"]),
        repo_full_name=str(repo["full_name"]),
    )
    if settings.INLINE_SYNC_WORKER:
        from app.api.ingestion import _run_job_inline

        background_tasks.add_task(_run_job_inline, str(job["id"]))
    audit_log("guardian.sync.queued", repo_id=principal.repo_id, job_id=str(job["id"]))
    return {"status": "queued", "job_id": str(job["id"])}


@router.get("/repositories/{repo_id}/reviews")
def guardian_reviews(
    repo_id: str,
    limit: int = Query(20, ge=1, le=100),
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assert_repo_access(db, repo_id, current_user.sub)
    params = {"repo_id": repo_id, "limit": limit}
    try:
        rows = db.execute(
            text(
                """
                SELECT id, pr_number, head_sha, verdict, findings, comment_markdown, impact, reviewers, created_at
                FROM guardian_reviews
                WHERE repo_id = :repo_id
                ORDER BY created_at DESC
                LIMIT :limit
                """
            ),
            params,
        ).mappings().all()
    except Exception:
        db.rollback()  # databases without migration 006
        rows = db.execute(
            text(
                """
                SELECT id, pr_number, head_sha, verdict, findings, comment_markdown, created_at
                FROM guardian_reviews
                WHERE repo_id = :repo_id
                ORDER BY created_at DESC
                LIMIT :limit
                """
            ),
            params,
        ).mappings().all()
    return {"reviews": [dict(row) for row in rows]}


WORKFLOW_TEMPLATE = """name: KAVI Guardian

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, closed]

permissions:
  contents: read
  pull-requests: write

jobs:
  guardian:
    if: ${{ !github.event.pull_request.draft || github.event.action == 'closed' }}
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Review against KAVI memory
        uses: actions/github-script@v7
        env:
          KAVI_API_URL: ${{ vars.KAVI_API_URL }}
          KAVI_GUARDIAN_TOKEN: ${{ secrets.KAVI_GUARDIAN_TOKEN }}
        with:
          script: |
            if (!process.env.KAVI_GUARDIAN_TOKEN || !process.env.KAVI_API_URL) {
              core.warning('KAVI Guardian is not configured (KAVI_API_URL variable / KAVI_GUARDIAN_TOKEN secret).');
              return;
            }
            const pr = context.payload.pull_request;
            const api = process.env.KAVI_API_URL.replace(/\/$/, '');
            const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.KAVI_GUARDIAN_TOKEN}` };
            if (context.payload.action === 'closed') {
              if (!pr.merged) return;
              // Merged: ask KAVI to learn from it (incremental sync), retrying while the API wakes up.
              for (let attempt = 0; attempt < 5; attempt++) {
                try {
                  const res = await fetch(`${api}/api/guardian/sync`, { method: 'POST', headers });
                  if (res.ok) { core.info('KAVI memory refresh queued.'); return; }
                  if (res.status === 401 || res.status === 403) { core.warning(`KAVI rejected the token (${res.status}).`); return; }
                } catch (error) {
                  core.info(`KAVI not reachable yet: ${error.message}`);
                }
                await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
              }
              core.warning('KAVI was unavailable; memory will refresh on the next sync.');
              return;
            }
            const files = await github.paginate(github.rest.pulls.listFiles, {
              ...context.repo, pull_number: pr.number, per_page: 100,
            });
            const payload = {
              pr_number: pr.number,
              head_sha: pr.head.sha,
              title: pr.title,
              body: (pr.body || '').slice(0, 20000),
              author: pr.user.login,
              files: files.slice(0, 50).map((f) => ({ filename: f.filename, status: f.status, patch: (f.patch || '').slice(0, 2500) })),
            };
            // Free hosting can sleep; retry while the API wakes up.
            let review = null;
            for (let attempt = 0; attempt < 5 && !review; attempt++) {
              try {
                const res = await fetch(`${api}/api/guardian/review`, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify(payload),
                });
                if (res.ok) review = await res.json();
                else if (res.status === 401 || res.status === 403) { core.warning(`KAVI rejected the token (${res.status}).`); return; }
              } catch (error) {
                core.info(`KAVI not reachable yet: ${error.message}`);
              }
              if (!review) await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
            }
            if (!review) { core.warning('KAVI Guardian was unavailable; skipping.'); return; }
            const marker = '<!-- kavi-guardian -->';
            const comments = await github.paginate(github.rest.issues.listComments, {
              ...context.repo, issue_number: pr.number, per_page: 100,
            });
            const existing = comments.find((c) => c.body && c.body.includes(marker));
            if (existing) {
              await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body: review.comment_markdown });
            } else {
              await github.rest.issues.createComment({ ...context.repo, issue_number: pr.number, body: review.comment_markdown });
            }
            core.summary.addRaw(review.comment_markdown).write();
"""


@router.get("/workflow", response_class=PlainTextResponse)
def guardian_workflow() -> str:
    return WORKFLOW_TEMPLATE
