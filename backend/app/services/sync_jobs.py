import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.settings import settings


def enqueue_sync_job(
    db: Session,
    *,
    user_id: str,
    github_account_id: str,
    repo_full_name: str,
    full_resync: bool = False,
) -> dict[str, Any]:
    existing = db.execute(
        text(
            """
            SELECT id, status, repo_full_name, created_at
            FROM sync_jobs
            WHERE github_account_id = :github_account_id
              AND repo_full_name = :repo_full_name
              AND status IN ('queued', 'running')
            ORDER BY created_at DESC
            LIMIT 1
            """
        ),
        {
            "github_account_id": github_account_id,
            "repo_full_name": repo_full_name,
        },
    ).mappings().first()
    if existing:
        return dict(existing)

    job = db.execute(
        text(
            """
            INSERT INTO sync_jobs (
                id, user_id, github_account_id, repo_full_name, status, max_attempts, full_resync, progress
            )
            VALUES (
                gen_random_uuid(), :user_id, :github_account_id, :repo_full_name, 'queued', :max_attempts,
                :full_resync, CAST(:progress AS jsonb)
            )
            RETURNING id, status, repo_full_name, created_at
            """
        ),
        {
            "user_id": user_id,
            "github_account_id": github_account_id,
            "repo_full_name": repo_full_name,
            "max_attempts": settings.SYNC_JOB_MAX_ATTEMPTS,
            "full_resync": bool(full_resync),
            "progress": json.dumps({"phase": "queued", "processed": 0, "total": 0}),
        },
    ).mappings().first()
    db.commit()
    return dict(job)


def claim_next_sync_job(db: Session, job_id: str | None = None) -> dict[str, Any] | None:
    job_filter = "AND id = CAST(:job_id AS uuid)" if job_id else ""
    job = db.execute(
        text(
            f"""
            WITH claimed AS (
                SELECT id
                FROM sync_jobs
                WHERE status = 'queued'
                  AND available_at <= NOW()
                  AND attempt_count < max_attempts
                  {job_filter}
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE sync_jobs j
            SET
                status = 'running',
                started_at = NOW(),
                attempt_count = j.attempt_count + 1,
                updated_at = NOW()
            FROM claimed
            WHERE j.id = claimed.id
            RETURNING
                j.id,
                j.user_id,
                j.github_account_id,
                j.repo_full_name,
                j.attempt_count,
                j.max_attempts,
                j.full_resync
            """
        ),
        {"job_id": job_id} if job_id else {},
    ).mappings().first()
    if not job:
        db.rollback()
        return None
    db.commit()
    return dict(job)


def recycle_stale_jobs(db: Session) -> int:
    result = db.execute(
        text(
            """
            UPDATE sync_jobs
            SET
                status = 'queued',
                available_at = NOW(),
                updated_at = NOW(),
                last_error = COALESCE(last_error, 'Worker recycled a stale running job')
            WHERE status = 'running'
              AND started_at < NOW() - make_interval(secs => :stale_after_seconds)
            """
        ),
        {"stale_after_seconds": settings.SYNC_JOB_STALE_AFTER_SECONDS},
    )
    db.commit()
    return int(result.rowcount or 0)


def mark_sync_job_succeeded(
    db: Session,
    *,
    job_id: str,
    repo_id: str,
    result_summary: dict[str, Any],
) -> None:
    db.execute(
        text(
            """
            UPDATE sync_jobs
            SET
                status = 'completed',
                repo_id = :repo_id,
                result_summary = CAST(:result_summary AS jsonb),
                last_error = NULL,
                finished_at = NOW(),
                updated_at = NOW()
            WHERE id = :job_id
            """
        ),
        {
            "job_id": job_id,
            "repo_id": repo_id,
            "result_summary": json.dumps(result_summary),
        },
    )
    db.commit()


def update_sync_job_progress(db: Session, *, job_id: str, progress: dict[str, Any]) -> None:
    db.execute(
        text(
            """
            UPDATE sync_jobs
            SET progress = CAST(:progress AS jsonb), updated_at = NOW()
            WHERE id = :job_id
            """
        ),
        {"job_id": job_id, "progress": json.dumps(progress, default=str)},
    )
    db.commit()


def get_sync_job_for_user(db: Session, *, job_id: str, user_id: str) -> dict[str, Any] | None:
    job = db.execute(
        text(
            """
            SELECT id, status, repo_id, repo_full_name, attempt_count, max_attempts, last_error,
                   result_summary, progress, full_resync, created_at, started_at, finished_at, updated_at
            FROM sync_jobs
            WHERE id = CAST(:job_id AS uuid) AND user_id = :user_id
            """
        ),
        {"job_id": job_id, "user_id": user_id},
    ).mappings().first()
    return dict(job) if job else None


def mark_sync_job_failed(db: Session, *, job_id: str, error_message: str) -> None:
    db.execute(
        text(
            """
            UPDATE sync_jobs
            SET
                status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END,
                available_at = CASE
                    WHEN attempt_count >= max_attempts THEN available_at
                    ELSE NOW() + make_interval(secs => :retry_delay_seconds)
                END,
                last_error = :error_message,
                finished_at = CASE WHEN attempt_count >= max_attempts THEN NOW() ELSE NULL END,
                updated_at = NOW()
            WHERE id = :job_id
            """
        ),
        {
            "job_id": job_id,
            "error_message": error_message[:2000],
            "retry_delay_seconds": settings.SYNC_JOB_RETRY_DELAY_SECONDS,
        },
    )
    db.commit()


def get_latest_sync_job_for_repo(db: Session, repo_id: str) -> dict[str, Any] | None:
    job = db.execute(
        text(
            """
            SELECT
                id,
                status,
                repo_full_name,
                attempt_count,
                max_attempts,
                last_error,
                result_summary,
                progress,
                created_at,
                started_at,
                finished_at,
                updated_at
            FROM sync_jobs
            WHERE repo_id = :repo_id
            ORDER BY created_at DESC
            LIMIT 1
            """
        ),
        {"repo_id": repo_id},
    ).mappings().first()
    return dict(job) if job else None
