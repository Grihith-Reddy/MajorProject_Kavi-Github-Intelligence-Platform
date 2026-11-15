"""Why-Lens: line-level intent.

Maps every line of a file to the commit that last touched it (GitHub GraphQL blame),
then to the pull request that introduced that commit, and finally to the intent
KAVI recorded for that PR. Results are cached per (repo, path, ref) for a short time.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.github_service import GitHubService


logger = logging.getLogger(__name__)

BLAME_CACHE_MINUTES = 20
MAX_FILE_CHARS = 160_000


def _load_cached_blame(db: Session, repo_id: str, path: str, ref: str) -> dict[str, Any] | None:
    try:
        row = db.execute(
            text(
                """
                SELECT payload
                FROM blame_cache
                WHERE repo_id = :repo_id AND file_path = :path AND ref = :ref
                  AND fetched_at > NOW() - make_interval(mins => :ttl)
                """
            ),
            {"repo_id": repo_id, "path": path, "ref": ref, "ttl": BLAME_CACHE_MINUTES},
        ).mappings().first()
    except Exception:
        db.rollback()
        return None
    payload = (row or {}).get("payload")
    return payload if isinstance(payload, dict) else None


def _store_cached_blame(db: Session, repo_id: str, path: str, ref: str, payload: dict[str, Any]) -> None:
    try:
        db.execute(
            text(
                """
                INSERT INTO blame_cache (repo_id, file_path, ref, payload, fetched_at)
                VALUES (:repo_id, :path, :ref, CAST(:payload AS jsonb), NOW())
                ON CONFLICT (repo_id, file_path, ref)
                DO UPDATE SET payload = EXCLUDED.payload, fetched_at = NOW()
                """
            ),
            {"repo_id": repo_id, "path": path, "ref": ref, "payload": json.dumps(payload, default=str)},
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("Unable to cache blame for %s", path, exc_info=True)


def _normalize_ranges(raw_ranges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranges: list[dict[str, Any]] = []
    for item in raw_ranges:
        if not isinstance(item, dict):
            continue
        commit = item.get("commit") or {}
        author = commit.get("author") or {}
        prs = ((commit.get("associatedPullRequests") or {}).get("nodes")) or []
        pr = prs[0] if prs and isinstance(prs[0], dict) else {}
        ranges.append(
            {
                "start_line": int(item.get("startingLine") or 0),
                "end_line": int(item.get("endingLine") or 0),
                "age": int(item.get("age") or 0),
                "commit_oid": commit.get("oid"),
                "commit_short": commit.get("abbreviatedOid"),
                "commit_headline": commit.get("messageHeadline"),
                "committed_at": commit.get("committedDate"),
                "author_name": author.get("name"),
                "author_login": ((author.get("user") or {}).get("login")),
                "pr_number": pr.get("number"),
                "pr_title": pr.get("title"),
                "pr_url": pr.get("url"),
                "pr_merged_at": pr.get("mergedAt"),
            }
        )
    ranges.sort(key=lambda item: item["start_line"])
    return ranges


def _merge_segments(ranges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge adjacent blame ranges that belong to the same PR (or commit, when no PR)."""
    segments: list[dict[str, Any]] = []
    for item in ranges:
        key = ("pr", item["pr_number"]) if item.get("pr_number") else ("commit", item.get("commit_oid"))
        if segments and segments[-1]["_key"] == key and segments[-1]["end_line"] + 1 >= item["start_line"]:
            segments[-1]["end_line"] = max(segments[-1]["end_line"], item["end_line"])
            continue
        segments.append({**item, "_key": key})
    for segment in segments:
        segment.pop("_key", None)
    return segments


def _knowledge_for_prs(db: Session, repo_id: str, pr_numbers: list[int]) -> dict[int, dict[str, Any]]:
    if not pr_numbers:
        return {}
    rows = db.execute(
        text(
            """
            SELECT pr.github_pr_number, pr.title, pr.url, pr.author_login, pr.merged_at,
                   k.id AS entry_id, k.summary, k.intent, k.decisions, k.risks, k.tags
            FROM pull_requests pr
            LEFT JOIN knowledge_entries k ON k.pr_id = pr.id
            WHERE pr.repo_id = :repo_id
              AND pr.github_pr_number = ANY(:numbers)
            """
        ),
        {"repo_id": repo_id, "numbers": pr_numbers},
    ).mappings().all()
    knowledge: dict[int, dict[str, Any]] = {}
    for row in rows:
        tags = row.get("tags")
        knowledge[int(row["github_pr_number"])] = {
            "pr_number": int(row["github_pr_number"]),
            "title": row.get("title"),
            "url": row.get("url"),
            "author_login": row.get("author_login"),
            "merged_at": row.get("merged_at"),
            "entry_id": str(row["entry_id"]) if row.get("entry_id") else None,
            "summary": row.get("summary"),
            "intent": row.get("intent"),
            "decisions": row.get("decisions") if isinstance(row.get("decisions"), list) else [],
            "risks": row.get("risks") if isinstance(row.get("risks"), list) else [],
            "tags": list(tags) if isinstance(tags, (list, tuple)) else [],
            "indexed": True,
        }
    return knowledge


def get_file_why(
    db: Session,
    *,
    repo_meta: dict[str, Any],
    github: GitHubService,
    path: str,
    ref: str | None = None,
    include_content: bool = True,
) -> dict[str, Any]:
    repo_id = str(repo_meta["id"])
    full_name = str(repo_meta["full_name"])
    normalized_path = str(path or "").strip().lstrip("/").replace("\\", "/")
    resolved_ref = (ref or str(repo_meta.get("default_branch") or "") or "HEAD").strip()

    blame = _load_cached_blame(db, repo_id, normalized_path, resolved_ref)
    if blame is None:
        raw = github.get_blame(full_name, normalized_path, resolved_ref)
        blame = {"commit_oid": raw.get("commit_oid"), "ranges": _normalize_ranges(raw.get("ranges") or [])}
        _store_cached_blame(db, repo_id, normalized_path, resolved_ref, blame)

    ranges = blame.get("ranges") or []
    segments = _merge_segments(ranges)
    pr_numbers = sorted({int(item["pr_number"]) for item in segments if item.get("pr_number")})
    knowledge = _knowledge_for_prs(db, repo_id, pr_numbers)

    # PRs found in blame but never synced still get their title/url from GitHub.
    for segment in segments:
        number = segment.get("pr_number")
        if number and int(number) not in knowledge:
            knowledge[int(number)] = {
                "pr_number": int(number),
                "title": segment.get("pr_title"),
                "url": segment.get("pr_url"),
                "merged_at": segment.get("pr_merged_at"),
                "indexed": False,
            }

    line_count = max((int(item.get("end_line") or 0) for item in ranges), default=0)
    content = None
    if include_content:
        content = github.get_file_content(full_name, normalized_path, ref=resolved_ref, max_chars=MAX_FILE_CHARS)
        line_count = max(line_count, content.count("\n") + 1 if content else 0)

    pr_line_counts: dict[int, int] = {}
    for segment in segments:
        if segment.get("pr_number"):
            span = int(segment["end_line"]) - int(segment["start_line"]) + 1
            pr_line_counts[int(segment["pr_number"])] = pr_line_counts.get(int(segment["pr_number"]), 0) + span

    return {
        "path": normalized_path,
        "ref": resolved_ref,
        "commit_oid": blame.get("commit_oid"),
        "line_count": line_count,
        "content": content,
        "segments": segments,
        "prs": [
            {**knowledge[number], "line_count": pr_line_counts.get(number, 0)}
            for number in sorted(knowledge, key=lambda n: pr_line_counts.get(n, 0), reverse=True)
        ],
    }


def why_for_lines(file_why: dict[str, Any], start_line: int, end_line: int) -> dict[str, Any]:
    """Narrow a file's Why-Lens result to a line range."""
    start = max(1, int(start_line or 1))
    end = max(start, int(end_line or start))
    overlapping = [
        segment
        for segment in file_why.get("segments") or []
        if int(segment.get("end_line") or 0) >= start and int(segment.get("start_line") or 0) <= end
    ]
    numbers = {int(segment["pr_number"]) for segment in overlapping if segment.get("pr_number")}
    prs = [pr for pr in file_why.get("prs") or [] if int(pr.get("pr_number") or 0) in numbers]
    content = file_why.get("content") or ""
    excerpt = ""
    if content:
        lines = content.splitlines()
        excerpt = "\n".join(f"{index + 1:>5}  {lines[index]}" for index in range(start - 1, min(end, len(lines))))
    return {
        "path": file_why.get("path"),
        "ref": file_why.get("ref"),
        "start_line": start,
        "end_line": end,
        "segments": overlapping,
        "prs": prs,
        "excerpt": excerpt[:6000],
    }
