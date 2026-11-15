"""KAVI Guardian: reviews a pull request against the repository's remembered intent.

For an incoming PR it gathers the history that matters (past PRs that touched the same
files, semantically related decisions, open promises), asks the model to judge whether
the change contradicts or revisits any recorded decision, and renders a concise GitHub
comment with citations. Without an AI provider it still posts the relevant history.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.ai_service import AIService
from app.services.embedding_service import cosine, embed_texts, repo_embedding_model, semantic_search
from app.services.impact_service import predict_change_impact, suggest_reviewers

logger = logging.getLogger(__name__)

COMMENT_MARKER = "<!-- kavi-guardian -->"
MAX_FILES = 50
MAX_CANDIDATES = 10
VERDICT_LABELS = {
    "clear": "✅ No conflicts with recorded decisions",
    "heads_up": "💡 Worth a look before merging",
    "conflict": "⚠️ Possible conflict with a past decision",
}


def _clip(value: Any, limit: int) -> str:
    text_value = " ".join(str(value or "").split())
    return text_value if len(text_value) <= limit else text_value[: limit - 1] + "…"


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return []


def gather_history(db: Session, repo_id: str, pr: dict[str, Any]) -> list[dict[str, Any]]:
    paths = [str(f.get("filename") or "") for f in (pr.get("files") or [])[:MAX_FILES] if f.get("filename")]
    own_number = int(pr.get("pr_number") or 0)
    candidates: dict[int, dict[str, Any]] = {}

    if paths:
        rows = db.execute(
            text(
                """
                SELECT pr.github_pr_number, pr.title, pr.url, pr.merged_at, pr.author_login,
                       k.id AS entry_id, k.summary, k.intent, k.decisions, k.risks, fm.file_path
                FROM file_mappings fm
                JOIN knowledge_entries k ON k.id = fm.knowledge_entry_id
                JOIN pull_requests pr ON pr.id = k.pr_id
                WHERE fm.repo_id = :repo_id
                  AND fm.file_path = ANY(:paths)
                  AND pr.github_pr_number <> :own
                ORDER BY COALESCE(pr.merged_at, pr.updated_at) DESC NULLS LAST
                LIMIT 120
                """
            ),
            {"repo_id": repo_id, "paths": paths, "own": own_number},
        ).mappings().all()
        for row in rows:
            number = int(row["github_pr_number"])
            candidate = candidates.setdefault(number, {**dict(row), "overlap": [], "semantic": 0.0})
            if row["file_path"] not in candidate["overlap"]:
                candidate["overlap"].append(row["file_path"])

    query = "\n".join([str(pr.get("title") or ""), _clip(pr.get("body"), 800), " ".join(paths[:20])])
    hits = semantic_search(db, repo_id, query, limit=8)
    strong = {entry_id: score for entry_id, score in hits if score >= 0.55}
    if strong:
        rows = db.execute(
            text(
                """
                SELECT pr.github_pr_number, pr.title, pr.url, pr.merged_at, pr.author_login,
                       k.id AS entry_id, k.summary, k.intent, k.decisions, k.risks
                FROM knowledge_entries k
                JOIN pull_requests pr ON pr.id = k.pr_id
                WHERE k.id = ANY(CAST(:ids AS uuid[])) AND pr.github_pr_number <> :own
                """
            ),
            {"ids": list(strong), "own": own_number},
        ).mappings().all()
        for row in rows:
            number = int(row["github_pr_number"])
            candidate = candidates.setdefault(number, {**dict(row), "overlap": [], "semantic": 0.0})
            candidate["semantic"] = max(candidate["semantic"], strong.get(str(row["entry_id"]), 0.0))

    ranked = sorted(
        candidates.values(),
        key=lambda c: (len(c["overlap"]) * 1.0 + c["semantic"] * 2.0, str(c.get("merged_at") or "")),
        reverse=True,
    )
    return ranked[:MAX_CANDIDATES]


def matching_promises(db: Session, repo_id: str, pr: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        rows = db.execute(
            text(
                """
                SELECT p.id, p.quote, p.summary, p.author_login, p.made_at, p.embedding, pr.github_pr_number
                FROM pr_promises p
                JOIN pull_requests pr ON pr.id = p.pr_id
                WHERE p.repo_id = :repo_id AND p.status = 'open'
                ORDER BY p.made_at DESC NULLS LAST
                LIMIT 200
                """
            ),
            {"repo_id": repo_id},
        ).mappings().all()
    except Exception:
        db.rollback()
        return []
    if not rows:
        return []
    model = repo_embedding_model(db, repo_id)
    pr_text = "\n".join([str(pr.get("title") or ""), _clip(pr.get("body"), 600)])
    try:
        _, vectors = embed_texts([pr_text], task_type="RETRIEVAL_QUERY", model=model) if model else (None, [])
    except Exception:
        vectors = []
    matches = []
    for row in rows:
        if vectors and row["embedding"]:
            score = cosine(vectors[0], [float(v) for v in row["embedding"]])
            if score >= 0.62:
                matches.append({**dict(row), "score": round(score, 3)})
    matches.sort(key=lambda item: item["score"], reverse=True)
    return matches[:3]


def _judge_with_ai(pr: dict[str, Any], candidates: list[dict[str, Any]], promises: list[dict[str, Any]]) -> dict[str, Any] | None:
    ai = AIService()
    if not ai._can_use_gemini() or not candidates:
        return None
    diff = [
        {"file": f.get("filename"), "status": f.get("status"), "patch": _clip(f.get("patch"), 1500)}
        for f in (pr.get("files") or [])[:25]
    ]
    history = [
        {
            "pr_number": c["github_pr_number"],
            "title": c.get("title"),
            "intent": _clip(c.get("intent"), 400),
            "decisions": _as_list(c.get("decisions"))[:6],
            "risks": _as_list(c.get("risks"))[:4],
            "files_in_common": c["overlap"][:6],
        }
        for c in candidates
    ]
    prompt = (
        "You are KAVI Guardian, reviewing a new pull request against decisions this repository already made.\n"
        "Return STRICT JSON: {\"verdict\": \"clear|heads_up|conflict\", \"summary\": \"one or two sentences\", "
        "\"findings\": [{\"kind\": \"conflict|heads_up|promise\", \"pr_number\": 0, \"file\": \"path or null\", "
        "\"title\": \"short\", \"detail\": \"one or two sentences\", \"confidence\": 0.0}]}\n"
        "Rules:\n"
        "- 'conflict' ONLY when the diff clearly reverses or contradicts a specific recorded decision; cite that PR.\n"
        "- 'heads_up' when the diff touches code whose recorded intent or risk the author should keep in mind.\n"
        "- 'promise' when the diff appears to fulfil an open promise listed in OPEN_PROMISES.\n"
        "- Use only PR numbers from HISTORY. Never invent history. Prefer fewer, sharper findings (max 4).\n"
        "- If nothing material, verdict 'clear' with an empty findings list.\n\n"
        f"NEW_PR:\n{json.dumps({'title': pr.get('title'), 'description': _clip(pr.get('body'), 1500), 'diff': diff}, default=str)}\n\n"
        f"HISTORY:\n{json.dumps(history, default=str)}\n\n"
        f"OPEN_PROMISES:\n{json.dumps([{'promise': p.get('summary') or p.get('quote'), 'made_in_pr': p.get('github_pr_number')} for p in promises], default=str)}"
    )
    try:
        raw = ai._call_gemini(prompt, temperature=0.1, max_output_tokens=1400, response_mime_type="application/json")
        parsed = ai._extract_json_object(raw)
    except Exception:
        logger.warning("Guardian AI judgement failed; using history-only review", exc_info=True)
        return None

    valid_numbers = {int(c["github_pr_number"]) for c in candidates} | {int(p["github_pr_number"]) for p in promises}
    findings = []
    for item in parsed.get("findings") or []:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").lower()
        if kind not in {"conflict", "heads_up", "promise"}:
            continue
        try:
            number = int(item.get("pr_number")) if item.get("pr_number") is not None else None
        except (TypeError, ValueError):
            number = None
        if number is not None and number not in valid_numbers:
            continue  # drop hallucinated citations
        confidence = float(item.get("confidence") or 0.5)
        if kind == "conflict" and confidence < 0.7:
            kind = "heads_up"
        findings.append(
            {
                "kind": kind,
                "pr_number": number,
                "file": item.get("file") or None,
                "title": _clip(item.get("title"), 120),
                "detail": _clip(item.get("detail"), 400),
                "confidence": round(confidence, 2),
            }
        )
    verdict = "conflict" if any(f["kind"] == "conflict" for f in findings) else (
        "heads_up" if findings else "clear"
    )
    return {"verdict": verdict, "summary": _clip(parsed.get("summary"), 400), "findings": findings[:4]}


def _history_only_review(candidates: list[dict[str, Any]], promises: list[dict[str, Any]]) -> dict[str, Any]:
    findings = []
    for candidate in [c for c in candidates if c["overlap"]][:3]:
        findings.append(
            {
                "kind": "heads_up",
                "pr_number": int(candidate["github_pr_number"]),
                "file": candidate["overlap"][0],
                "title": f"Touches code shaped by #{candidate['github_pr_number']}",
                "detail": _clip(candidate.get("intent") or candidate.get("summary"), 300),
                "confidence": 0.5,
            }
        )
    for promise in promises[:2]:
        findings.append(
            {
                "kind": "promise",
                "pr_number": int(promise["github_pr_number"]),
                "file": None,
                "title": "May keep an open promise",
                "detail": _clip(promise.get("summary") or promise.get("quote"), 300),
                "confidence": float(promise.get("score") or 0.5),
            }
        )
    return {
        "verdict": "heads_up" if findings else "clear",
        "summary": "KAVI found related history for the files in this pull request." if findings else "",
        "findings": findings,
    }


def render_comment(
    review: dict[str, Any],
    candidates: list[dict[str, Any]],
    repo_full_name: str,
    impact: dict[str, Any] | None = None,
    reviewers: dict[str, Any] | None = None,
) -> str:
    lines = [COMMENT_MARKER, f"### KAVI Guardian · {VERDICT_LABELS[review['verdict']]}", ""]
    if review.get("summary"):
        lines += [review["summary"], ""]

    def _ref(number: int | None) -> str:
        return f"#{number}" if number else ""

    sections = [
        ("conflict", "**Possible conflicts**"),
        ("heads_up", "**Worth knowing**"),
        ("promise", "**This PR may keep a promise**"),
    ]
    for kind, heading in sections:
        items = [f for f in review["findings"] if f["kind"] == kind]
        if not items:
            continue
        lines.append(heading)
        for item in items:
            where = f" · `{item['file']}`" if item.get("file") else ""
            source = f" ({_ref(item.get('pr_number'))})" if item.get("pr_number") else ""
            lines.append(f"- **{item['title']}**{source} {item['detail']}{where}")
        lines.append("")

    likely = (impact or {}).get("likely_missing") or []
    likely_modules = (impact or {}).get("likely_missing_modules") or []
    if likely or likely_modules:
        lines.append("**Usually changes together**")
        for item in likely:
            examples = ", ".join(f"#{n}" for n in item["example_prs"])
            lines.append(
                f"- `{item['path']}`: changed alongside `{item['because_of'].split('/')[-1]}` in "
                f"{item['support']} of {item['of_prs']} past PRs ({examples}), but not in this one."
            )
        for item in likely_modules:
            lines.append(
                f"- `{item['module']}/`: changed with `{item['because_of']}/` in {item['support']} of {item['of_prs']} past PRs."
            )
        lines.append("")

    suggested = (reviewers or {}).get("reviewers") or []
    if suggested:
        lines.append("**Suggested reviewers**")
        for person in suggested:
            note = " (inactive lately)" if person.get("inactive") else ""
            refs = ", ".join(f"#{n}" for n in person["pr_numbers"][:3])
            lines.append(f"- `{person['login']}`{note}: {person['reason']} ({refs})")
        risk = (reviewers or {}).get("context_risk")
        if risk:
            lines.append(f"- {risk['message']}")
        lines.append("")

    radius = (impact or {}).get("blast_radius") or {}
    if radius.get("coupled_files"):
        lines.append(
            f"<sub>Blast radius: these files have historically changed together with {radius['coupled_files']} other file(s) "
            f"across {len(radius.get('modules') or [])} module(s).</sub>"
        )
        lines.append("")

    if candidates:
        lines.append(f"<details><summary>History KAVI checked ({len(candidates)} pull request{'s' if len(candidates) != 1 else ''})</summary>")
        lines.append("")
        lines.append("| PR | Recorded intent | Files in common |")
        lines.append("| --- | --- | --- |")
        for candidate in candidates:
            overlap = ", ".join(f"`{path.split('/')[-1]}`" for path in candidate["overlap"][:3]) or "related by meaning"
            intent = _clip(candidate.get("intent") or candidate.get("summary"), 140).replace("|", "\\|")
            lines.append(f"| #{candidate['github_pr_number']} {_clip(candidate.get('title'), 50).replace('|', '/')} | {intent} | {overlap} |")
        lines += ["", "</details>", ""]

    lines.append(f"<sub>Generated by KAVI from the pull-request history of `{repo_full_name}`. Open KAVI chat to dig deeper.</sub>")
    return "\n".join(lines)


def review_pull_request(db: Session, *, repo: dict[str, Any], pr: dict[str, Any]) -> dict[str, Any]:
    repo_id = str(repo["id"])
    candidates = gather_history(db, repo_id, pr)
    promises = matching_promises(db, repo_id, pr)
    review = _judge_with_ai(pr, candidates, promises) or _history_only_review(candidates, promises)
    paths = [str(f.get("filename") or "") for f in (pr.get("files") or []) if f.get("filename")]
    impact: dict[str, Any] | None = None
    reviewers: dict[str, Any] | None = None
    try:
        impact = predict_change_impact(db, repo_id, paths, exclude_pr_number=int(pr.get("pr_number") or 0) or None)
        reviewers = suggest_reviewers(db, repo_id, paths, pr.get("author"))
    except Exception:
        db.rollback()
        logger.warning("Change-impact analysis failed; continuing without it", exc_info=True)
    strong_gap = any(item["confidence"] >= 0.8 for item in (impact or {}).get("likely_missing") or [])
    if review["verdict"] == "clear" and strong_gap:
        review["verdict"] = "heads_up"
        review["summary"] = review.get("summary") or "Files that usually change together with these were left untouched."
    comment = render_comment(review, candidates, str(repo.get("full_name") or ""), impact, reviewers)

    try:
        params = {
            "repo_id": repo_id,
            "pr_number": int(pr.get("pr_number") or 0),
            "head_sha": str(pr.get("head_sha") or "unknown")[:80],
            "verdict": review["verdict"],
            "findings": json.dumps(review["findings"], default=str),
            "comment": comment,
            "impact": json.dumps(impact, default=str) if impact else None,
            "reviewers": json.dumps(reviewers, default=str) if reviewers else None,
        }
        try:
            db.execute(
                text(
                    """
                    INSERT INTO guardian_reviews (id, repo_id, pr_number, head_sha, verdict, findings, comment_markdown, impact, reviewers)
                    VALUES (gen_random_uuid(), :repo_id, :pr_number, :head_sha, :verdict, CAST(:findings AS jsonb), :comment,
                            CAST(:impact AS jsonb), CAST(:reviewers AS jsonb))
                    ON CONFLICT (repo_id, pr_number, head_sha)
                    DO UPDATE SET verdict = EXCLUDED.verdict, findings = EXCLUDED.findings,
                                  comment_markdown = EXCLUDED.comment_markdown, impact = EXCLUDED.impact,
                                  reviewers = EXCLUDED.reviewers, created_at = NOW()
                    """
                ),
                params,
            )
        except Exception:
            # Databases without migration 006 still store the core review.
            db.rollback()
            db.execute(
                text(
                    """
                    INSERT INTO guardian_reviews (id, repo_id, pr_number, head_sha, verdict, findings, comment_markdown)
                    VALUES (gen_random_uuid(), :repo_id, :pr_number, :head_sha, :verdict, CAST(:findings AS jsonb), :comment)
                    ON CONFLICT (repo_id, pr_number, head_sha)
                    DO UPDATE SET verdict = EXCLUDED.verdict, findings = EXCLUDED.findings,
                                  comment_markdown = EXCLUDED.comment_markdown, created_at = NOW()
                    """
                ),
                params,
            )
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("Unable to store guardian review", exc_info=True)

    return {
        "verdict": review["verdict"],
        "summary": review.get("summary"),
        "findings": review["findings"],
        "history_checked": [int(c["github_pr_number"]) for c in candidates],
        "impact": impact,
        "reviewers": reviewers,
        "comment_markdown": comment,
    }
