
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app.core.access import assert_repo_access, is_uuid, require_github_account, require_user_id
from app.core.audit import audit_log
from app.core.database import get_db
from app.core.security import UserContext, decrypt_token, get_current_user
from app.services.ingestion_service import sync_repository
from app.core.settings import settings
from app.services.sync_jobs import enqueue_sync_job, get_latest_sync_job_for_repo, get_sync_job_for_user

router = APIRouter(prefix="/ingestion", tags=["ingestion"])


class SyncRequest(BaseModel):
    repo_full_name: str = Field(
        min_length=3,
        max_length=250,
        pattern=r"^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?/[A-Za-z0-9._-]+$",
    )
    full_resync: bool = False


def _run_job_inline(job_id: str) -> None:
    # Imported lazily so the API module does not import the worker at startup.
    from app.workers.ingestion_worker import process_job_by_id

    process_job_by_id(job_id)


@router.post("/repositories/sync")
def sync_repo(
    payload: SyncRequest,
    background_tasks: BackgroundTasks,
    wait: bool = Query(False),
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = require_user_id(db, current_user.sub)
    gh_account = require_github_account(db, user_id)
    token = decrypt_token(gh_account["access_token_encrypted"])

    if wait:
        result = sync_repository(
            db, payload.repo_full_name, token, gh_account["id"], full_resync=payload.full_resync
        )
        audit_log(
            "repository.sync.request.completed",
            user_id=user_id,
            github_account_id=gh_account["id"],
            repo_full_name=payload.repo_full_name,
            repo_id=result["repo_id"],
            synced_prs=result.get("synced_prs", 0),
        )
        return {"status": "completed", **result}

    try:
        job = enqueue_sync_job(
            db,
            user_id=user_id,
            github_account_id=gh_account["id"],
            repo_full_name=payload.repo_full_name,
            full_resync=payload.full_resync,
        )
    except ProgrammingError as exc:
        db.rollback()
        if "sync_jobs" in str(exc).lower() and "does not exist" in str(exc).lower():
            # Legacy DB without sync_jobs migration: fallback to synchronous sync.
            result = sync_repository(db, payload.repo_full_name, token, gh_account["id"])
            audit_log(
                "repository.sync.request.completed.fallback",
                user_id=user_id,
                github_account_id=gh_account["id"],
                repo_full_name=payload.repo_full_name,
                repo_id=result["repo_id"],
                synced_prs=result.get("synced_prs", 0),
            )
            return {"status": "completed", "queue_unavailable": True, **result}
        raise

    audit_log(
        "repository.sync.request.queued",
        user_id=user_id,
        github_account_id=gh_account["id"],
        repo_full_name=payload.repo_full_name,
        job_id=job["id"],
    )
    if settings.INLINE_SYNC_WORKER:
        background_tasks.add_task(_run_job_inline, str(job["id"]))
    return {
        "status": "queued",
        "repo_full_name": job["repo_full_name"],
        "job_id": job["id"],
    }


@router.get("/repositories/{repo_id}/status")
def repo_status(
    repo_id: str,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repo = assert_repo_access(db, repo_id, current_user.sub)
    job = get_latest_sync_job_for_repo(db, repo_id)
    audit_log("repository.status.checked", auth0_sub=current_user.sub, repo_id=repo_id)
    return {"repository": repo, "sync_job": job}


@router.get("/jobs/{job_id}")
def sync_job_status(
    job_id: str,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not is_uuid(job_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync job not found")
    user_id = require_user_id(db, current_user.sub)
    job = get_sync_job_for_user(db, job_id=job_id, user_id=user_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync job not found")
    return {"job": job}
