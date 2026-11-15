"""Knowledge map: modules, who holds their context, and how they are coupled.

- Modules are directories (two levels deep) of files KAVI has seen change in PRs.
- Context ownership weights each person's involvement per module
  (author 3, reviewer 2, commenter 1). The bus factor is the smallest number of
  people covering more than half of that weight.
- A module is 'at_risk' when one person holds most of its context and they have not
  been active recently; 'single_expert' when one person holds it but is active.
- Co-change coupling links modules that keep changing in the same pull requests.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from itertools import combinations
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

ROLE_WEIGHT = {"author": 3.0, "reviewer": 2.0, "commenter": 1.0}
INACTIVE_AFTER_DAYS = 90
MAX_MODULES = 40


def module_of(path: str, depth: int = 2) -> str:
    parts = [part for part in str(path or "").split("/") if part]
    if len(parts) <= 1:
        return "(root)"
    return "/".join(parts[: min(depth, len(parts) - 1)])


def bus_factor(weights: dict[str, float]) -> int:
    total = sum(weights.values())
    if total <= 0:
        return 0
    covered, count = 0.0, 0
    for value in sorted(weights.values(), reverse=True):
        covered += value
        count += 1
        if covered > total / 2:
            break
    return count


def build_knowledge_map(db: Session, repo_id: str) -> dict[str, Any]:
    file_rows = db.execute(
        text(
            """
            SELECT DISTINCT fm.file_path, pr.id AS pr_id, pr.github_pr_number,
                   COALESCE(pr.merged_at, pr.updated_at, pr.created_at) AS at, pr.author_login
            FROM file_mappings fm
            JOIN knowledge_entries k ON k.id = fm.knowledge_entry_id
            JOIN pull_requests pr ON pr.id = k.pr_id
            WHERE fm.repo_id = :repo_id
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()
    participant_rows = db.execute(
        text(
            """
            SELECT pp.pr_id, pp.login, pp.role, pp.interactions, pp.last_seen_at
            FROM pr_participants pp
            WHERE pp.repo_id = :repo_id
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()

    people_by_pr: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in participant_rows:
        people_by_pr[str(row["pr_id"])].append(dict(row))

    module_files: dict[str, set[str]] = defaultdict(set)
    module_prs: dict[str, set[str]] = defaultdict(set)
    pr_modules: dict[str, set[str]] = defaultdict(set)
    pr_meta: dict[str, dict[str, Any]] = {}
    for row in file_rows:
        module = module_of(row["file_path"])
        pr_id = str(row["pr_id"])
        module_files[module].add(row["file_path"])
        module_prs[module].add(pr_id)
        pr_modules[pr_id].add(module)
        pr_meta[pr_id] = {"number": row["github_pr_number"], "at": row["at"], "author": row["author_login"]}

    now = datetime.now(timezone.utc)
    repo_last_activity = max((meta["at"] for meta in pr_meta.values() if meta["at"]), default=now)
    # Measure inactivity relative to the repository's own last activity, so an archived
    # project does not flag everyone as inactive.
    inactive_before = repo_last_activity - timedelta(days=INACTIVE_AFTER_DAYS)

    person_last_seen: dict[str, datetime] = {}
    person_prs: dict[str, set[str]] = defaultdict(set)
    person_modules: dict[str, set[str]] = defaultdict(set)

    modules: list[dict[str, Any]] = []
    ranked_modules = sorted(module_prs, key=lambda m: len(module_prs[m]), reverse=True)[:MAX_MODULES]
    for module in ranked_modules:
        weights: dict[str, float] = defaultdict(float)
        last_seen: dict[str, datetime] = {}
        for pr_id in module_prs[module]:
            people = people_by_pr.get(pr_id) or (
                [{"login": pr_meta[pr_id]["author"], "role": "author", "interactions": 1, "last_seen_at": pr_meta[pr_id]["at"]}]
                if pr_meta[pr_id].get("author")
                else []
            )
            for person in people:
                login = person["login"]
                weights[login] += ROLE_WEIGHT.get(person["role"], 1.0)
                seen = person.get("last_seen_at") or pr_meta[pr_id]["at"]
                if seen and (login not in last_seen or seen > last_seen[login]):
                    last_seen[login] = seen
                person_prs[login].add(pr_id)
                person_modules[login].add(module)
                if seen and (login not in person_last_seen or seen > person_last_seen[login]):
                    person_last_seen[login] = seen

        total = sum(weights.values()) or 1.0
        contributors = sorted(
            ({"login": login, "share": round(value / total, 3), "last_seen_at": last_seen.get(login)} for login, value in weights.items()),
            key=lambda item: item["share"],
            reverse=True,
        )
        factor = bus_factor(weights)
        top = contributors[0] if contributors else None
        if factor <= 1 and top:
            risk = "at_risk" if (top["last_seen_at"] and top["last_seen_at"] < inactive_before) else "single_expert"
        else:
            risk = "healthy"
        activity = [pr_meta[pr_id]["at"] for pr_id in module_prs[module] if pr_meta[pr_id]["at"]]
        modules.append(
            {
                "id": module,
                "path": module,
                "pr_count": len(module_prs[module]),
                "file_count": len(module_files[module]),
                "bus_factor": factor,
                "risk": risk,
                "contributors": contributors[:5],
                "last_activity": max(activity) if activity else None,
            }
        )

    kept = {module["id"] for module in modules}
    pair_counts: dict[tuple[str, str], int] = defaultdict(int)
    for module_set in pr_modules.values():
        relevant = sorted(module_set & kept)
        for left, right in combinations(relevant, 2):
            pair_counts[(left, right)] += 1
    edges = []
    for (left, right), shared in pair_counts.items():
        strength = shared / max(1, min(len(module_prs[left]), len(module_prs[right])))
        if shared >= 2 or strength >= 0.5:
            edges.append({"source": left, "target": right, "shared_prs": shared, "strength": round(strength, 3)})
    edges.sort(key=lambda edge: (edge["strength"], edge["shared_prs"]), reverse=True)

    people = sorted(
        (
            {
                "login": login,
                "pr_count": len(prs),
                "module_count": len(person_modules[login]),
                "last_seen_at": person_last_seen.get(login),
                "active": bool(person_last_seen.get(login) and person_last_seen[login] >= inactive_before),
            }
            for login, prs in person_prs.items()
        ),
        key=lambda item: item["pr_count"],
        reverse=True,
    )[:20]

    return {
        "modules": modules,
        "edges": edges[:60],
        "people": people,
        "summary": {
            "module_count": len(modules),
            "at_risk": sum(1 for m in modules if m["risk"] == "at_risk"),
            "single_expert": sum(1 for m in modules if m["risk"] == "single_expert"),
            "healthy": sum(1 for m in modules if m["risk"] == "healthy"),
            "strongest_coupling": edges[0] if edges else None,
            "repo_last_activity": repo_last_activity,
        },
    }
