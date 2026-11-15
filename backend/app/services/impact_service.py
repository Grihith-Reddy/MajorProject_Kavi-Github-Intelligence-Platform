"""Change-impact prediction and reviewer suggestions for a pull request.

Both use history KAVI already has, with no AI calls:

- Co-change rules: for every file the PR changes, look at past PRs that changed it and
  count which *other* files changed alongside. A rule f -> g with high confidence
  (share of f's PRs that also touched g) and enough support (at least 3 PRs) that the
  current PR does not satisfy becomes a "probably also needs" warning.
- Blast radius: everything historically coupled to the changed files.
- Reviewer suggestions: people who authored, reviewed or discussed past PRs touching
  the same files, weighted by role and decayed by recency; the PR author is excluded.
  If the strongest context holder has gone quiet, that is called out.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.map_service import ROLE_WEIGHT, module_of

MIN_SUPPORT = 3
MIN_CONFIDENCE = 0.6
RECENCY_HALF_LIFE_DAYS = 180
INACTIVE_DAYS = 90


def _history(db: Session, repo_id: str, exclude_pr_number: int | None) -> dict[str, set[str]]:
    rows = db.execute(
        text(
            """
            SELECT DISTINCT pr.github_pr_number, fm.file_path
            FROM file_mappings fm
            JOIN knowledge_entries k ON k.id = fm.knowledge_entry_id
            JOIN pull_requests pr ON pr.id = k.pr_id
            WHERE fm.repo_id = :repo_id
              AND (CAST(:exclude AS integer) IS NULL OR pr.github_pr_number <> CAST(:exclude AS integer))
            """
        ),
        {"repo_id": repo_id, "exclude": exclude_pr_number},
    ).mappings().all()
    files_by_pr: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        files_by_pr[str(row["github_pr_number"])].add(row["file_path"])
    return files_by_pr


def predict_change_impact(db: Session, repo_id: str, changed_paths: list[str], exclude_pr_number: int | None = None) -> dict[str, Any]:
    changed = {path for path in changed_paths if path}
    files_by_pr = _history(db, repo_id, exclude_pr_number)
    prs_by_file: dict[str, set[str]] = defaultdict(set)
    for pr_number, files in files_by_pr.items():
        for path in files:
            prs_by_file[path].add(pr_number)

    missing: dict[str, dict[str, Any]] = {}
    coupled: set[str] = set()
    for source in changed:
        source_prs = prs_by_file.get(source, set())
        if len(source_prs) < MIN_SUPPORT:
            continue
        co_counts: dict[str, int] = defaultdict(int)
        for pr_number in source_prs:
            for other in files_by_pr[pr_number]:
                if other != source:
                    co_counts[other] += 1
        for other, count in co_counts.items():
            confidence = count / len(source_prs)
            if count >= 2:
                coupled.add(other)
            if other in changed or count < MIN_SUPPORT or confidence < MIN_CONFIDENCE:
                continue
            current = missing.get(other)
            if current is None or confidence > current["confidence"]:
                examples = sorted((p for p in source_prs if other in files_by_pr[p]), key=int, reverse=True)[:3]
                missing[other] = {
                    "path": other,
                    "because_of": source,
                    "confidence": round(confidence, 2),
                    "support": count,
                    "of_prs": len(source_prs),
                    "example_prs": [int(p) for p in examples],
                }

    # Module-level rule for repositories where exact files vary between PRs.
    changed_modules = {module_of(path) for path in changed}
    modules_by_pr = {pr: {module_of(path) for path in files} for pr, files in files_by_pr.items()}
    module_missing: list[dict[str, Any]] = []
    for module in changed_modules:
        module_prs = [pr for pr, modules in modules_by_pr.items() if module in modules]
        if len(module_prs) < MIN_SUPPORT:
            continue
        counts: dict[str, int] = defaultdict(int)
        for pr in module_prs:
            for other in modules_by_pr[pr]:
                if other != module:
                    counts[other] += 1
        for other, count in counts.items():
            confidence = count / len(module_prs)
            if other not in changed_modules and count >= MIN_SUPPORT and confidence >= 0.7:
                module_missing.append(
                    {"module": other, "because_of": module, "confidence": round(confidence, 2), "support": count, "of_prs": len(module_prs)}
                )

    ranked_missing = sorted(missing.values(), key=lambda item: (item["confidence"], item["support"]), reverse=True)[:5]
    module_missing.sort(key=lambda item: (item["confidence"], item["support"]), reverse=True)
    covered_modules = {module_of(item["path"]) for item in ranked_missing}
    return {
        "likely_missing": ranked_missing,
        "likely_missing_modules": [m for m in module_missing if m["module"] not in covered_modules][:3],
        "blast_radius": {
            "coupled_files": len(coupled - changed),
            "modules": sorted({module_of(path) for path in coupled | changed}),
            "history_prs": len({pr for path in changed for pr in prs_by_file.get(path, set())}),
        },
    }


def suggest_reviewers(db: Session, repo_id: str, changed_paths: list[str], author: str | None, limit: int = 3) -> dict[str, Any]:
    paths = [path for path in changed_paths if path][:60]
    if not paths:
        return {"reviewers": [], "context_risk": None}
    rows = db.execute(
        text(
            """
            SELECT pp.login, pp.role, pp.last_seen_at, pr.github_pr_number,
                   COALESCE(pr.merged_at, pr.updated_at, pr.created_at) AS pr_at,
                   ARRAY_AGG(DISTINCT fm.file_path) AS files
            FROM file_mappings fm
            JOIN knowledge_entries k ON k.id = fm.knowledge_entry_id
            JOIN pull_requests pr ON pr.id = k.pr_id
            JOIN pr_participants pp ON pp.pr_id = pr.id
            WHERE fm.repo_id = :repo_id AND fm.file_path = ANY(:paths)
            GROUP BY pp.login, pp.role, pp.last_seen_at, pr.github_pr_number, pr_at
            """
        ),
        {"repo_id": repo_id, "paths": paths},
    ).mappings().all()

    now = datetime.now(timezone.utc)
    author_key = (author or "").lower()
    people: dict[str, dict[str, Any]] = {}
    for row in rows:
        login = row["login"]
        if not login or login.lower() == author_key or login.endswith("[bot]"):
            continue
        when = row["last_seen_at"] or row["pr_at"]
        age_days = max(0.0, (now - when).total_seconds() / 86400) if when else 365.0
        weight = ROLE_WEIGHT.get(row["role"], 1.0) * math.pow(0.5, age_days / RECENCY_HALF_LIFE_DAYS)
        person = people.setdefault(login, {"login": login, "score": 0.0, "prs": set(), "files": set(), "roles": set(), "last_active": None})
        person["score"] += weight
        person["prs"].add(int(row["github_pr_number"]))
        person["files"].update(row["files"] or [])
        person["roles"].add(row["role"])
        if when and (person["last_active"] is None or when > person["last_active"]):
            person["last_active"] = when

    total = sum(p["score"] for p in people.values()) or 1.0
    ranked = sorted(people.values(), key=lambda p: p["score"], reverse=True)
    reviewers = []
    for person in ranked[:limit]:
        inactive = bool(person["last_active"] and (now - person["last_active"]).days > INACTIVE_DAYS)
        role_text = " and ".join(sorted(person["roles"]))
        reviewers.append(
            {
                "login": person["login"],
                "share": round(person["score"] / total, 2),
                "pr_numbers": sorted(person["prs"], reverse=True)[:5],
                "files": sorted(person["files"])[:4],
                "reason": f"{role_text} on {len(person['prs'])} PR{'s' if len(person['prs']) != 1 else ''} touching these files",
                "last_active": person["last_active"],
                "inactive": inactive,
            }
        )

    context_risk = None
    if reviewers and reviewers[0]["share"] >= 0.6:
        top = reviewers[0]
        context_risk = {
            "login": top["login"],
            "share": top["share"],
            "inactive": top["inactive"],
            "message": (
                f"Most of the context on these files sits with {top['login']}, who has not been active for over {INACTIVE_DAYS} days."
                if top["inactive"]
                else f"Most of the context on these files sits with {top['login']}."
            ),
        }
    return {"reviewers": reviewers, "context_risk": context_risk}
