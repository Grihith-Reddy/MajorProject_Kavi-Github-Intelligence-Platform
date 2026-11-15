import argparse
import logging
import time

from sqlalchemy import text

from app.core.audit import audit_log
from app.core.database import SessionLocal
from app.core.security import decrypt_token
from app.core.settings import settings
from app.services.ingestion_service import sync_repository
from app.services.sync_jobs import (
    claim_next_sync_job,
    mark_sync_job_failed,
    mark_sync_job_succeeded,
    recycle_stale_jobs,
    update_sync_job_progress,
)


logger = logging.getLogger(__name__)


def _get_github_token(db, github_account_id: str) -> str:
    account = db.execute(
        text(
            """
            SELECT access_token_encrypted, authorization_type
            FROM github_accounts
            WHERE id = :github_account_id
            """
        ),
        {"github_account_id": github_account_id},
    ).mappings().first()
    if not account:
        raise RuntimeError("GitHub account not found for sync job")
    if account["authorization_type"] != "github_app":
        raise RuntimeError("GitHub account must be reconnected using the read-only GitHub App")
    return decrypt_token(account["access_token_encrypted"])


def _progress_writer(job_id: str):
    """Persist progress through a separate session so it never commits partial ingestion state."""

    def _write(progress: dict) -> None:
        progress_db = SessionLocal()
        try:
            update_sync_job_progress(progress_db, job_id=job_id, progress=progress)
        finally:
            progress_db.close()

    return _write


def execute_job(db, job: dict) -> None:
    try:
        token = _get_github_token(db, job["github_account_id"])
        result = sync_repository(
            db,
            job["repo_full_name"],
            token,
            job["github_account_id"],
            full_resync=bool(job.get("full_resync")),
            progress_callback=_progress_writer(str(job["id"])),
        )
        mark_sync_job_succeeded(db, job_id=job["id"], repo_id=result["repo_id"], result_summary=result)
        _progress_writer(str(job["id"]))(
            {"phase": "completed", "processed": result.get("synced_prs", 0), "total": result.get("synced_prs", 0)}
        )
        audit_log(
            "sync.job.completed",
            job_id=job["id"],
            repo_full_name=job["repo_full_name"],
            repo_id=result["repo_id"],
            synced_prs=result.get("synced_prs", 0),
            error_count=len(result.get("errors", [])),
        )
    except Exception as exc:
        logger.exception("Sync worker job failed")
        db.rollback()
        mark_sync_job_failed(db, job_id=job["id"], error_message=str(exc))
        audit_log(
            "sync.job.failed",
            job_id=job["id"],
            repo_full_name=job["repo_full_name"],
            error=str(exc),
        )


def process_one_job() -> bool:
    db = SessionLocal()
    try:
        recycle_stale_jobs(db)
        job = claim_next_sync_job(db)
        if not job:
            return False
        execute_job(db, job)
        return True
    except Exception:
        logger.exception("Sync worker loop failed")
        return True
    finally:
        db.close()


def process_job_by_id(job_id: str) -> bool:
    """Run a specific queued job in-process (used right after the API enqueues it).

    The claim uses FOR UPDATE SKIP LOCKED, so if a standalone worker already took
    the job this is a no-op.
    """
    db = SessionLocal()
    try:
        job = claim_next_sync_job(db, job_id=job_id)
        if not job:
            return False
        execute_job(db, job)
        return True
    except Exception:
        logger.exception("Inline sync job failed")
        return False
    finally:
        db.close()


def run_forever() -> None:
    while True:
        processed = process_one_job()
        if not processed:
            time.sleep(settings.SYNC_WORKER_POLL_SECONDS)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Process KAVI repository ingestion jobs.")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Process at most one queued job and exit.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=settings.LOG_LEVEL)
    if args.once:
        process_one_job()
    else:
        run_forever()


if __name__ == "__main__":
    main()
