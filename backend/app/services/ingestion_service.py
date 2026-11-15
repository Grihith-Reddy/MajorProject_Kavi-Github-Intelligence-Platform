import hashlib
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Any, Callable

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.access import grant_repository_access
from app.core.audit import audit_log
from app.core.settings import settings
from app.services.ai_service import AIService
from app.services.embedding_service import backfill_repo_embeddings
from app.services.promise_service import extract_promises, resolve_promises
from app.services.github_service import GitHubService, parse_github_datetime


logger = logging.getLogger(__name__)
PR_SUMMARY_SCHEMA_VERSION = 2
MAX_SUMMARY_FILE_CONTEXT = 120
MAX_SUMMARY_PATCH_CHARS = 800
MAX_SUMMARY_TEXT_ITEMS = 200
MAX_SUMMARY_TEXT_CHARS = 1000
_TAGS_STORAGE_MODE: str | None = None


def _hash_payload(payload: dict[str, Any]) -> str:
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return digest


def _parse_patch_ranges(patch: str | None) -> tuple[int | None, int | None]:
    if not patch:
        return None, None

    ranges = []
    for match in re.finditer(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", patch):
        start = int(match.group(1))
        length = int(match.group(2) or 1)
        ranges.append((start, start + max(length - 1, 0)))

    if not ranges:
        return None, None

    start_line = min(r[0] for r in ranges)
    end_line = max(r[1] for r in ranges)
    return start_line, end_line


def _normalize_text(value: Any, max_length: int = MAX_SUMMARY_TEXT_CHARS) -> str:
    if value is None:
        return ""
    text_value = str(value).strip()
    if not text_value:
        return ""
    return text_value[:max_length]


def _compact_pr_file(file_info: dict[str, Any]) -> dict[str, Any]:
    patch = _normalize_text(file_info.get("patch"), max_length=MAX_SUMMARY_PATCH_CHARS)
    return {
        "filename": _normalize_text(file_info.get("filename"), max_length=320),
        "status": _normalize_text(file_info.get("status"), max_length=32),
        "previous_filename": _normalize_text(file_info.get("previous_filename"), max_length=320),
        "additions": int(file_info.get("additions") or 0),
        "deletions": int(file_info.get("deletions") or 0),
        "changes": int(file_info.get("changes") or 0),
        "patch_excerpt": patch,
    }


def _build_pr_payload(
    pr_detail: dict[str, Any],
    commits: list[dict[str, Any]],
    comments: list[dict[str, Any]],
    reviews: list[dict[str, Any]],
    files: list[dict[str, Any]],
) -> dict[str, Any]:
    compact_files = [
        _compact_pr_file(item)
        for item in files[:MAX_SUMMARY_FILE_CONTEXT]
        if isinstance(item, dict) and _normalize_text(item.get("filename"), max_length=320)
    ]
    changed_files = [item.get("filename") for item in compact_files if item.get("filename")]

    commits_text = [
        _normalize_text(c.get("commit", {}).get("message"))
        for c in commits[:MAX_SUMMARY_TEXT_ITEMS]
        if isinstance(c, dict)
    ]
    comments_text = [
        _normalize_text(c.get("body"))
        for c in comments[:MAX_SUMMARY_TEXT_ITEMS]
        if isinstance(c, dict)
    ]
    reviews_text = [
        _normalize_text(r.get("body"))
        for r in reviews[:MAX_SUMMARY_TEXT_ITEMS]
        if isinstance(r, dict)
    ]

    additions = sum(int(item.get("additions") or 0) for item in compact_files)
    deletions = sum(int(item.get("deletions") or 0) for item in compact_files)
    renamed_files = sum(1 for item in compact_files if str(item.get("status") or "").lower() == "renamed")
    added_files = sum(1 for item in compact_files if str(item.get("status") or "").lower() == "added")
    removed_files = sum(1 for item in compact_files if str(item.get("status") or "").lower() == "removed")

    return {
        "summary_schema_version": PR_SUMMARY_SCHEMA_VERSION,
        "title": pr_detail.get("title"),
        "body": pr_detail.get("body"),
        "number": pr_detail.get("number"),
        "state": pr_detail.get("state"),
        "merged_at": pr_detail.get("merged_at"),
        "author": pr_detail.get("user", {}).get("login"),
        "base_branch": pr_detail.get("base", {}).get("ref"),
        "head_branch": pr_detail.get("head", {}).get("ref"),
        "commits": [text for text in commits_text if text],
        "comments": [text for text in comments_text if text],
        "reviews": [text for text in reviews_text if text],
        "files": changed_files,
        "file_changes": compact_files,
        "change_stats": {
            "file_count": len(changed_files),
            "additions": additions,
            "deletions": deletions,
            "renamed_files": renamed_files,
            "added_files": added_files,
            "removed_files": removed_files,
        },
    }


def _upsert_repository(db: Session, repo: dict[str, Any], github_account_id: str | None) -> str:
    stmt = text(
        """
        INSERT INTO repositories (
            id, github_repo_id, owner, name, full_name, is_private,
            default_branch, github_account_id
        )
        VALUES (
            gen_random_uuid(), :github_repo_id, :owner, :name, :full_name, :is_private,
            :default_branch, :github_account_id
        )
        ON CONFLICT (github_repo_id)
        DO UPDATE SET
            owner = EXCLUDED.owner,
            name = EXCLUDED.name,
            full_name = EXCLUDED.full_name,
            is_private = EXCLUDED.is_private,
            default_branch = EXCLUDED.default_branch,
            github_account_id = COALESCE(repositories.github_account_id, EXCLUDED.github_account_id),
            updated_at = NOW()
        RETURNING id;
        """
    )
    result = db.execute(
        stmt,
        {
            "github_repo_id": repo["id"],
            "owner": repo["owner"]["login"],
            "name": repo["name"],
            "full_name": repo["full_name"],
            "is_private": repo.get("private", False),
            "default_branch": repo.get("default_branch"),
            "github_account_id": github_account_id,
        },
    ).fetchone()
    return str(result[0])


def _upsert_pr(db: Session, repo_id: str, pr: dict[str, Any]) -> str:
    stmt = text(
        """
        INSERT INTO pull_requests (
            id, repo_id, github_pr_id, github_pr_number, title, body, state,
            merged_at, created_at, updated_at, author_login, url, base_branch, head_branch
        )
        VALUES (
            gen_random_uuid(), :repo_id, :github_pr_id, :github_pr_number, :title, :body, :state,
            :merged_at, :created_at, :updated_at, :author_login, :url, :base_branch, :head_branch
        )
        ON CONFLICT (repo_id, github_pr_number)
        DO UPDATE SET
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            state = EXCLUDED.state,
            merged_at = EXCLUDED.merged_at,
            updated_at = EXCLUDED.updated_at,
            author_login = EXCLUDED.author_login,
            url = EXCLUDED.url,
            base_branch = EXCLUDED.base_branch,
            head_branch = EXCLUDED.head_branch
        RETURNING id;
        """
    )
    result = db.execute(
        stmt,
        {
            "repo_id": repo_id,
            "github_pr_id": pr["id"],
            "github_pr_number": pr["number"],
            "title": pr.get("title"),
            "body": pr.get("body"),
            "state": pr.get("state"),
            "merged_at": pr.get("merged_at"),
            "created_at": pr.get("created_at"),
            "updated_at": pr.get("updated_at"),
            "author_login": pr.get("user", {}).get("login"),
            "url": pr.get("html_url"),
            "base_branch": pr.get("base", {}).get("ref"),
            "head_branch": pr.get("head", {}).get("ref"),
        },
    ).fetchone()
    return str(result[0])


def _upsert_commits(db: Session, repo_id: str, pr_id: str, commits: list[dict[str, Any]]) -> None:
    stmt = text(
        """
        INSERT INTO commits (
            id, repo_id, pr_id, github_sha, message, author_name, author_email, committed_at, url
        )
        VALUES (
            gen_random_uuid(), :repo_id, :pr_id, :github_sha, :message, :author_name,
            :author_email, :committed_at, :url
        )
        ON CONFLICT (repo_id, github_sha)
        DO UPDATE SET
            message = EXCLUDED.message,
            author_name = EXCLUDED.author_name,
            author_email = EXCLUDED.author_email,
            committed_at = EXCLUDED.committed_at,
            url = EXCLUDED.url,
            pr_id = EXCLUDED.pr_id;
        """
    )
    for commit in commits:
        author = commit.get("commit", {}).get("author", {})
        db.execute(
            stmt,
            {
                "repo_id": str(repo_id),
                "pr_id": str(pr_id),
                "github_sha": commit.get("sha"),
                "message": commit.get("commit", {}).get("message"),
                "author_name": author.get("name"),
                "author_email": author.get("email"),
                "committed_at": author.get("date"),
                "url": commit.get("html_url"),
            },
        )

def _upsert_knowledge_entry(
    db: Session,
    repo_id: str,
    pr_id: str,
    summary: dict[str, Any],
    source_hash: str,
) -> str:
    global _TAGS_STORAGE_MODE

    def _detect_tags_storage_mode() -> str:
        global _TAGS_STORAGE_MODE
        if _TAGS_STORAGE_MODE in {"jsonb", "array"}:
            return _TAGS_STORAGE_MODE

        row = db.execute(
            text(
                """
                SELECT udt_name
                FROM information_schema.columns
                WHERE table_name = 'knowledge_entries'
                  AND column_name = 'tags'
                """
            )
        ).mappings().first()
        _TAGS_STORAGE_MODE = "jsonb" if str((row or {}).get("udt_name") or "").lower() == "jsonb" else "array"
        return _TAGS_STORAGE_MODE

    tags = [str(tag).strip() for tag in (summary.get("tags") or []) if str(tag).strip()]
    base_params = {
        "repo_id": str(repo_id),
        "pr_id": str(pr_id),
        "summary": summary.get("summary"),
        "intent": summary.get("intent"),
        "decisions": json.dumps(summary.get("decisions") or []),
        "risks": json.dumps(summary.get("risks") or []),
        "ai_model": settings.AI_MODEL,
        "source_data_hash": source_hash,
    }

    preferred_mode = _detect_tags_storage_mode()
    modes_to_try = [preferred_mode, "jsonb" if preferred_mode == "array" else "array"]
    last_error: Exception | None = None

    for mode in modes_to_try:
        if mode == "jsonb":
            stmt = text(
                """
                INSERT INTO knowledge_entries (
                    id, repo_id, pr_id, summary, intent, decisions, risks, tags,
                    ai_model, source_data_hash
                )
                VALUES (
                    gen_random_uuid(), :repo_id, :pr_id, :summary, :intent, CAST(:decisions AS jsonb), CAST(:risks AS jsonb), CAST(:tags AS jsonb),
                    :ai_model, :source_data_hash
                )
                ON CONFLICT (pr_id)
                DO UPDATE SET
                    summary = EXCLUDED.summary,
                    intent = EXCLUDED.intent,
                    decisions = EXCLUDED.decisions,
                    risks = EXCLUDED.risks,
                    tags = EXCLUDED.tags,
                    ai_model = EXCLUDED.ai_model,
                    source_data_hash = EXCLUDED.source_data_hash,
                    updated_at = NOW()
                RETURNING id;
                """
            )
            params = {**base_params, "tags": json.dumps(tags)}
        else:
            stmt = text(
                """
                INSERT INTO knowledge_entries (
                    id, repo_id, pr_id, summary, intent, decisions, risks, tags,
                    ai_model, source_data_hash
                )
                VALUES (
                    gen_random_uuid(), :repo_id, :pr_id, :summary, :intent, CAST(:decisions AS jsonb), CAST(:risks AS jsonb), CAST(:tags AS text[]),
                    :ai_model, :source_data_hash
                )
                ON CONFLICT (pr_id)
                DO UPDATE SET
                    summary = EXCLUDED.summary,
                    intent = EXCLUDED.intent,
                    decisions = EXCLUDED.decisions,
                    risks = EXCLUDED.risks,
                    tags = EXCLUDED.tags,
                    ai_model = EXCLUDED.ai_model,
                    source_data_hash = EXCLUDED.source_data_hash,
                    updated_at = NOW()
                RETURNING id;
                """
            )
            params = {**base_params, "tags": tags}

        try:
            result = db.execute(stmt, params).fetchone()
            _TAGS_STORAGE_MODE = mode
            return str(result[0])
        except Exception as exc:
            db.rollback()
            last_error = exc

    raise RuntimeError(f"Unable to upsert knowledge entry with either tags storage mode: {last_error}")


def _upsert_file_mappings(
    db: Session,
    repo_id: str,
    knowledge_entry_id: str,
    pr_files: list[dict[str, Any]],
) -> None:
    stmt = text(
        """
        INSERT INTO file_mappings (
            id, repo_id, knowledge_entry_id, file_path, start_line, end_line, confidence
        )
        VALUES (
            gen_random_uuid(), :repo_id, :knowledge_entry_id, :file_path, :start_line, :end_line, :confidence
        )
        ON CONFLICT (knowledge_entry_id, file_path, start_line, end_line)
        DO NOTHING;
        """
    )
    for file_info in pr_files:
        start_line, end_line = _parse_patch_ranges(file_info.get("patch"))
        db.execute(
            stmt,
            {
                "repo_id": str(repo_id),
                "knowledge_entry_id": str(knowledge_entry_id),
                "file_path": file_info.get("filename"),
                "start_line": start_line,
                "end_line": end_line,
                "confidence": 0.6,
            },
        )


def _upsert_participants(
    db: Session,
    repo_id: str,
    pr_id: str,
    pr_detail: dict[str, Any],
    comments: list[dict[str, Any]],
    reviews: list[dict[str, Any]],
) -> None:
    counts: dict[tuple[str, str], dict[str, Any]] = {}

    def _add(login: Any, role: str, seen_at: Any) -> None:
        normalized = str(login or "").strip()
        if not normalized or normalized.endswith("[bot]"):
            return
        key = (normalized, role)
        bucket = counts.setdefault(key, {"interactions": 0, "last_seen_at": None})
        bucket["interactions"] += 1
        parsed = parse_github_datetime(seen_at)
        if parsed and (bucket["last_seen_at"] is None or parsed > bucket["last_seen_at"]):
            bucket["last_seen_at"] = parsed

    _add((pr_detail.get("user") or {}).get("login"), "author", pr_detail.get("created_at"))
    for review in reviews:
        if isinstance(review, dict):
            _add((review.get("user") or {}).get("login"), "reviewer", review.get("submitted_at"))
    for comment in comments:
        if isinstance(comment, dict):
            _add((comment.get("user") or {}).get("login"), "commenter", comment.get("created_at"))

    stmt = text(
        """
        INSERT INTO pr_participants (id, repo_id, pr_id, login, role, interactions, last_seen_at)
        VALUES (gen_random_uuid(), :repo_id, :pr_id, :login, :role, :interactions, :last_seen_at)
        ON CONFLICT (pr_id, login, role)
        DO UPDATE SET interactions = EXCLUDED.interactions, last_seen_at = EXCLUDED.last_seen_at
        """
    )
    for (login, role), bucket in counts.items():
        db.execute(
            stmt,
            {
                "repo_id": str(repo_id),
                "pr_id": str(pr_id),
                "login": login,
                "role": role,
                "interactions": bucket["interactions"],
                "last_seen_at": bucket["last_seen_at"],
            },
        )


def _existing_pr_index(db: Session, repo_id: str) -> dict[int, dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT pr.github_pr_number, pr.updated_at, (k.id IS NOT NULL) AS has_entry
            FROM pull_requests pr
            LEFT JOIN knowledge_entries k ON k.pr_id = pr.id
            WHERE pr.repo_id = :repo_id
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()
    return {
        int(row["github_pr_number"]): {
            "updated_at": parse_github_datetime(row["updated_at"]),
            "has_entry": bool(row["has_entry"]),
        }
        for row in rows
    }


def _needs_processing(pr: dict[str, Any], existing: dict[int, dict[str, Any]]) -> bool:
    known = existing.get(int(pr.get("number") or 0))
    if not known or not known.get("has_entry"):
        return True
    listed_updated_at = parse_github_datetime(pr.get("updated_at"))
    return listed_updated_at is None or known.get("updated_at") != listed_updated_at


ProgressCallback = Callable[[dict[str, Any]], None]


def run_post_sync_enrichment(db: Session, repo_id: str, ai_service: AIService, results: dict[str, Any]) -> None:
    """Repository-level enrichment that runs after PR ingestion (best-effort)."""
    try:
        results["embeddings"] = backfill_repo_embeddings(db, repo_id)
    except Exception as exc:
        db.rollback()
        logger.warning("Embedding backfill failed for repo %s: %s", repo_id, exc)
        results["embeddings"] = {"error": str(exc)[:200]}
    try:
        results["promises"] = resolve_promises(db, repo_id, ai_service)
    except Exception as exc:
        db.rollback()
        logger.warning("Promise resolution failed for repo %s: %s", repo_id, exc)


def sync_repository(
    db: Session,
    repo_full_name: str,
    github_token: str,
    github_account_id: str | None = None,
    *,
    full_resync: bool = False,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    github = GitHubService(github_token)
    ai_service = AIService()

    def _report(**progress: Any) -> None:
        if progress_callback is None:
            return
        try:
            progress_callback(progress)
        except Exception:  # progress is best-effort and must never break ingestion
            logger.debug("Progress callback failed", exc_info=True)

    _report(phase="connecting", processed=0, total=0)
    repo = github.get_repository(repo_full_name)
    repo_id = _upsert_repository(db, repo, github_account_id)
    if github_account_id:
        grant_repository_access(db, repo_id, github_account_id)
    db.commit()

    cursor_row = db.execute(
        text("SELECT last_pr_updated_at FROM repositories WHERE id = :repo_id"),
        {"repo_id": repo_id},
    ).mappings().first()
    cursor = None if full_resync else parse_github_datetime((cursor_row or {}).get("last_pr_updated_at"))

    _report(phase="listing", processed=0, total=0)
    listed_prs = github.list_pull_requests_updated_since(repo_full_name, since=cursor)
    existing_index = _existing_pr_index(db, repo_id)
    prs = [pr for pr in listed_prs if full_resync or _needs_processing(pr, existing_index)]
    results = {
        "repo_id": repo_id,
        "synced_prs": 0,
        "total_prs_fetched": len(listed_prs),
        "skipped_unchanged": len(listed_prs) - len(prs),
        "incremental": cursor is not None,
        "errors": [],
    }
    failed_updated_at: list[datetime] = []
    _report(phase="analyzing", processed=0, total=len(prs))

    for index, pr in enumerate(prs):
        pr_number = pr.get("number")
        if not isinstance(pr_number, int):
            results["errors"].append({"pr": pr_number, "error": "invalid_pr_number"})
            continue

        _report(
            phase="analyzing",
            processed=index,
            total=len(prs),
            current_pr=pr_number,
            current_title=_normalize_text(pr.get("title"), max_length=140),
        )
        listed_updated_at = parse_github_datetime(pr.get("updated_at"))
        try:
            pr_detail = github.get_pull_request(repo_full_name, pr_number)
            commits = github.list_pull_request_commits(repo_full_name, pr_number)
            comments = github.list_pull_request_comments(repo_full_name, pr_number)
            reviews = github.list_pull_request_reviews(repo_full_name, pr_number)
            files = github.list_pull_request_files(repo_full_name, pr_number)

            payload = _build_pr_payload(pr_detail, commits, comments, reviews, files)
            source_hash = _hash_payload(payload)

            pr_id = _upsert_pr(db, repo_id, pr_detail)
            _upsert_commits(db, repo_id, pr_id, commits)
            _upsert_participants(db, repo_id, pr_id, pr_detail, comments, reviews)
            db.commit()
            results["synced_prs"] += 1

            # Keep core ingestion durable. Knowledge enrichment failures should not
            # zero-out PR ingestion for the repository.
            try:
                existing = db.execute(
                    text(
                        """
                        SELECT id, source_data_hash
                        FROM knowledge_entries
                        WHERE pr_id = :pr_id
                        """
                    ),
                    {"pr_id": pr_id},
                ).mappings().first()

                if existing and existing.get("source_data_hash") == source_hash:
                    knowledge_entry_id = str(existing["id"])
                else:
                    summary = ai_service.summarize_pr(payload)
                    knowledge_entry_id = _upsert_knowledge_entry(db, repo_id, pr_id, summary, source_hash)

                _upsert_file_mappings(db, repo_id, knowledge_entry_id, files)
                db.commit()
            except Exception as exc:
                db.rollback()
                logger.warning("Failed to enrich PR %s: %s", pr_number, exc)
                results["errors"].append({"pr": pr_number, "error": f"enrichment_failed: {str(exc)}"})

            # Promise extraction is optional enrichment: isolated so it can never
            # undo the PR or its knowledge entry.
            try:
                found = extract_promises(
                    db,
                    repo_id=repo_id,
                    pr_id=pr_id,
                    pr_detail=pr_detail,
                    comments=comments,
                    reviews=reviews,
                    commits=commits,
                    ai=ai_service,
                )
                db.commit()
                results["promises_found"] = results.get("promises_found", 0) + found
            except Exception as exc:
                db.rollback()
                logger.warning("Promise extraction failed for PR %s: %s", pr_number, exc)
        except HTTPException as exc:
            db.rollback()
            logger.warning("Failed to ingest PR %s: %s", pr_number, exc.detail)
            results["errors"].append({"pr": pr_number, "error": exc.detail})
            if listed_updated_at:
                failed_updated_at.append(listed_updated_at)
        except Exception as exc:
            db.rollback()
            logger.exception("Unexpected ingestion error")
            results["errors"].append({"pr": pr_number, "error": str(exc)})
            if listed_updated_at:
                failed_updated_at.append(listed_updated_at)

    _report(phase="finishing", processed=len(prs), total=len(prs))
    run_post_sync_enrichment(db, repo_id, ai_service, results)

    # Advance the incremental cursor. If any PR failed, keep the cursor just
    # before the oldest failure so the next sync retries it; PRs that already
    # succeeded are skipped cheaply by the unchanged-PR check.
    listed_times = [t for t in (parse_github_datetime(p.get("updated_at")) for p in listed_prs) if t]
    new_cursor = cursor
    if failed_updated_at:
        candidate = min(failed_updated_at) - timedelta(seconds=1)
        new_cursor = candidate if cursor is None or candidate > cursor else cursor
    elif listed_times:
        new_cursor = max(listed_times)

    db.execute(
        text(
            """
            UPDATE repositories
            SET synced_at = NOW(), updated_at = NOW(),
                last_pr_updated_at = :cursor
            WHERE id = :repo_id
            """
        ),
        {"repo_id": repo_id, "cursor": new_cursor},
    )
    db.commit()

    audit_log(
        "repository.sync.completed",
        repo_id=repo_id,
        repo_full_name=repo_full_name,
        synced_prs=results["synced_prs"],
        error_count=len(results["errors"]),
        github_account_id=github_account_id,
    )

    return results
