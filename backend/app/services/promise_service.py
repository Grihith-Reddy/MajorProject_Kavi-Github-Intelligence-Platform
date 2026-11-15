"""Promise Tracker: commitments made in pull-request discussions, and whether they were kept.

1. Extraction (per PR, during sync): a cheap phrase filter finds candidate sentences
   ("will fix in a follow-up", "temporary hack", "TODO later"...). When Gemini is
   available it confirms which are real commitments and summarises them; otherwise
   the filtered sentences are kept with a heuristic kind.
2. Resolution (per repository, after sync): each open promise is embedded and compared
   with pull requests merged *after* it was made. A strong match (optionally confirmed
   by the model) marks it kept, citing the PR that kept it.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.ai_service import AIService
from app.services.embedding_service import (
    LOCAL_MODEL,
    EmbeddingUnavailable,
    cosine,
    embed_texts,
    preferred_model,
)
from app.services.github_service import parse_github_datetime

logger = logging.getLogger(__name__)

_COMMITMENT_RE = re.compile(
    r"\b(follow[- ]?up|separate pr|another pr|next pr|future pr|later pr|in a later|will (?:fix|address|handle|clean|refactor|add|remove|revisit|update|move)"
    r"|i'?ll (?:fix|address|handle|clean|refactor|add|remove|revisit|update|move)|we'?ll (?:fix|address|handle|clean|refactor|add|revisit)"
    r"|todo|fixme|temporary|temp fix|hack(?:y)?|workaround|for now|tech(?:nical)? debt|revisit|address (?:this )?later|out of scope|punt)\b",
    re.IGNORECASE,
)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_KIND_RULES = [
    ("temporary", re.compile(r"\b(temporary|temp fix|hack|workaround|for now)\b", re.I)),
    ("todo", re.compile(r"\b(todo|fixme)\b", re.I)),
    ("tech_debt", re.compile(r"\b(tech(?:nical)? debt|refactor|clean ?up)\b", re.I)),
]
MAX_CANDIDATES_PER_PR = 12
KEPT_THRESHOLD = {"gemini": 0.74, LOCAL_MODEL: 0.42}


def _heuristic_kind(sentence: str) -> str:
    for kind, pattern in _KIND_RULES:
        if pattern.search(sentence):
            return kind
    return "follow_up"


def _signature(text_value: str) -> str:
    normalized = " ".join(re.sub(r"[^a-z0-9 ]", " ", text_value.lower()).split())
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:20]


def find_candidates(pr_detail: dict[str, Any], comments: list[dict[str, Any]], reviews: list[dict[str, Any]], commits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sources: list[tuple[str, str, Any, Any, Any]] = []
    sources.append(("body", pr_detail.get("body") or "", (pr_detail.get("user") or {}).get("login"), pr_detail.get("created_at"), pr_detail.get("html_url")))
    for comment in comments:
        if isinstance(comment, dict):
            sources.append(("comment", comment.get("body") or "", (comment.get("user") or {}).get("login"), comment.get("created_at"), comment.get("html_url")))
    for review in reviews:
        if isinstance(review, dict):
            sources.append(("review", review.get("body") or "", (review.get("user") or {}).get("login"), review.get("submitted_at"), review.get("html_url")))
    for commit in commits:
        if isinstance(commit, dict):
            info = commit.get("commit") or {}
            sources.append(("commit", info.get("message") or "", ((commit.get("author") or {}).get("login")) or (info.get("author") or {}).get("name"), (info.get("author") or {}).get("date"), commit.get("html_url")))

    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source, body, author, made_at, url in sources:
        if not body or str(author or "").endswith("[bot]"):
            continue
        # Drop quoted replies and code blocks; promises live in prose.
        prose = re.sub(r"```.*?```", " ", str(body), flags=re.S)
        prose = "\n".join(line for line in prose.splitlines() if not line.lstrip().startswith(">"))
        for sentence in _SENTENCE_SPLIT_RE.split(prose):
            sentence = " ".join(sentence.split()).strip(" -*")
            if not (12 <= len(sentence) <= 400) or not _COMMITMENT_RE.search(sentence):
                continue
            signature = _signature(sentence)
            if signature in seen:
                continue
            seen.add(signature)
            candidates.append(
                {
                    "quote": sentence,
                    "source": source,
                    "author_login": author,
                    "made_at": parse_github_datetime(made_at),
                    "source_url": url,
                    "signature": signature,
                    "kind": _heuristic_kind(sentence),
                    "summary": None,
                }
            )
            if len(candidates) >= MAX_CANDIDATES_PER_PR:
                return candidates
    return candidates


def _confirm_with_ai(ai: AIService, pr_title: str, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prompt = (
        "These sentences come from a GitHub pull request discussion. Decide which are genuine commitments to do "
        "future work (follow-ups, temporary code that must be replaced, deferred TODOs, acknowledged tech debt). "
        "Reject questions, jokes, descriptions of work already done in this PR, and generic statements.\n"
        "Return STRICT JSON: {\"promises\": [{\"index\": 0, \"kind\": \"follow_up|todo|temporary|tech_debt\", "
        "\"summary\": \"imperative, under 14 words\"}]}\n\n"
        f"PR TITLE: {pr_title}\n"
        f"SENTENCES:\n{json.dumps([{'index': i, 'text': c['quote']} for i, c in enumerate(candidates)])}"
    )
    raw = ai._call_gemini(prompt, temperature=0.0, max_output_tokens=2048, response_mime_type="application/json")
    parsed = ai._extract_json_object(raw)
    confirmed = []
    for item in parsed.get("promises") or []:
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        if 0 <= index < len(candidates):
            candidate = dict(candidates[index])
            kind = str(item.get("kind") or candidate["kind"])
            candidate["kind"] = kind if kind in {"follow_up", "todo", "temporary", "tech_debt"} else candidate["kind"]
            candidate["summary"] = str(item.get("summary") or "")[:160] or None
            confirmed.append(candidate)
    return confirmed


def extract_promises(
    db: Session,
    *,
    repo_id: str,
    pr_id: str,
    pr_detail: dict[str, Any],
    comments: list[dict[str, Any]],
    reviews: list[dict[str, Any]],
    commits: list[dict[str, Any]],
    ai: AIService,
) -> int:
    candidates = find_candidates(pr_detail, comments, reviews, commits)
    if not candidates:
        return 0
    promises = candidates
    if ai._can_use_gemini():
        try:
            promises = _confirm_with_ai(ai, str(pr_detail.get("title") or ""), candidates)
        except Exception:
            logger.warning("Promise confirmation failed; keeping phrase-matched candidates", exc_info=True)
    stmt = text(
        """
        INSERT INTO pr_promises (id, repo_id, pr_id, signature, author_login, quote, summary, kind, source, source_url, made_at)
        VALUES (gen_random_uuid(), :repo_id, :pr_id, :signature, :author_login, :quote, :summary, :kind, :source, :source_url, :made_at)
        ON CONFLICT (pr_id, signature)
        DO UPDATE SET summary = COALESCE(EXCLUDED.summary, pr_promises.summary), kind = EXCLUDED.kind, updated_at = NOW()
        """
    )
    for promise in promises:
        db.execute(stmt, {"repo_id": repo_id, "pr_id": pr_id, **{k: promise[k] for k in ("signature", "author_login", "quote", "summary", "kind", "source", "source_url", "made_at")}})
    return len(promises)


def _threshold(model: str) -> float:
    return KEPT_THRESHOLD[LOCAL_MODEL] if model == LOCAL_MODEL else KEPT_THRESHOLD["gemini"]


def resolve_promises(db: Session, repo_id: str, ai: AIService, *, max_ai_checks: int = 15) -> dict[str, int]:
    """Embed open promises and mark those a later PR appears to have kept."""
    model = preferred_model()
    pending = db.execute(
        text(
            """
            SELECT id, quote, summary FROM pr_promises
            WHERE repo_id = :repo_id AND (embedding IS NULL)
            LIMIT 300
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()
    if pending:
        try:
            _, vectors = embed_texts([p["summary"] or p["quote"] for p in pending], task_type="RETRIEVAL_QUERY", model=model)
            for row, vector in zip(pending, vectors):
                db.execute(
                    text("UPDATE pr_promises SET embedding = CAST(:v AS real[]) WHERE id = :id"),
                    {"v": vector, "id": str(row["id"])},
                )
            db.commit()
        except EmbeddingUnavailable as exc:
            logger.warning("Promise embedding paused: %s", exc)
            db.rollback()

    open_promises = db.execute(
        text(
            """
            SELECT p.id, p.quote, p.summary, p.embedding, p.made_at, p.pr_id
            FROM pr_promises p
            WHERE p.repo_id = :repo_id AND p.status = 'open' AND p.embedding IS NOT NULL
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()
    later_prs = db.execute(
        text(
            """
            SELECT pr.id AS pr_id, pr.github_pr_number, pr.title, pr.merged_at, k.summary, k.intent, k.embedding
            FROM pull_requests pr
            JOIN knowledge_entries k ON k.pr_id = pr.id
            WHERE pr.repo_id = :repo_id AND pr.merged_at IS NOT NULL
              AND k.embedding IS NOT NULL AND k.embedding_model = :model
            """
        ),
        {"repo_id": repo_id, "model": model},
    ).mappings().all()

    kept = 0
    ai_checks = 0
    threshold = _threshold(model)
    for promise in open_promises:
        vector = [float(v) for v in promise["embedding"]]
        made_at = promise["made_at"]
        best = None
        for pr in later_prs:
            if pr["pr_id"] == promise["pr_id"] or (made_at and pr["merged_at"] and pr["merged_at"] <= made_at):
                continue
            score = cosine(vector, [float(v) for v in pr["embedding"]])
            if best is None or score > best[0]:
                best = (score, pr)
        if not best or best[0] < threshold:
            continue
        score, pr = best
        confirmed, note = True, f"Similar to PR #{pr['github_pr_number']} (similarity {score:.2f})."
        if ai._can_use_gemini() and ai_checks < max_ai_checks:
            ai_checks += 1
            try:
                raw = ai._call_gemini(
                    "Does the later pull request fulfil the earlier promise? Return STRICT JSON "
                    "{\"kept\": true|false, \"reason\": \"one sentence\"}.\n"
                    f"PROMISE: {promise['summary'] or promise['quote']}\n"
                    f"LATER PR #{pr['github_pr_number']}: {pr['title']}\nSUMMARY: {pr['summary']}\nINTENT: {pr['intent']}",
                    temperature=0.0,
                    max_output_tokens=1024,
                    response_mime_type="application/json",
                )
                verdict = ai._extract_json_object(raw)
                confirmed = bool(verdict.get("kept"))
                note = str(verdict.get("reason") or note)[:300]
            except Exception:
                # Without a verdict, only accept clearly strong matches.
                confirmed = score >= threshold + 0.08
                logger.warning("Promise verification failed; requiring a stronger similarity match", exc_info=True)
        if not confirmed:
            continue
        db.execute(
            text(
                """
                UPDATE pr_promises
                SET status = 'kept', resolved_pr_id = :pr_id, resolution_note = :note,
                    resolution_confidence = :confidence, updated_at = NOW()
                WHERE id = :id AND status = 'open'
                """
            ),
            {"pr_id": str(pr["pr_id"]), "note": note, "confidence": round(min(score, 0.999), 3), "id": str(promise["id"])},
        )
        kept += 1
    db.commit()
    return {"embedded": len(pending), "newly_kept": kept}
