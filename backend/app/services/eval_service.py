"""Retrieval evaluation harness.

Builds a test set from the repository itself: for a sample of indexed pull requests,
Gemini writes the kind of question a teammate would ask whose answer lives in that PR,
paraphrased so it does not reuse the PR title. Each question is then run through every
retrieval strategy and scored by where the gold PR ranks:

    Recall@k  - share of questions whose gold PR is in the top k results
    MRR       - mean of 1/rank (0 when not retrieved)

Without an AI provider, questions fall back to the PR's recorded intent ("template"
questions), which is an easier test and is labelled as such.
"""

from __future__ import annotations

import json
import logging
import random
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.ai_service import AIService

logger = logging.getLogger(__name__)

STRATEGIES = ("fulltext", "lexical", "semantic", "hybrid")
K_VALUES = (1, 3, 5)
MAX_QUESTIONS = 30
MIN_ENTRIES = 5


def _sample_entries(db: Session, repo_id: str, limit: int) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT k.id, k.summary, k.intent, k.decisions, pr.github_pr_number, pr.title
            FROM knowledge_entries k
            JOIN pull_requests pr ON pr.id = k.pr_id
            WHERE k.repo_id = :repo_id
              AND length(coalesce(k.intent, '') || coalesce(k.summary, '')) > 60
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()
    rows = [dict(row) for row in rows]
    random.Random(42).shuffle(rows)  # deterministic sample so runs are comparable
    return rows[:limit]


def _generate_questions(ai: AIService, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    for offset in range(0, len(entries), 10):
        batch = entries[offset : offset + 10]
        prompt = (
            "For each pull request below, write ONE question a developer new to this codebase might ask whose answer "
            "is found in that pull request. Ask about the why, the decision or the behaviour. Paraphrase: do not copy "
            "distinctive words from the title, and never mention PR numbers.\n"
            'Return STRICT JSON: {"questions": [{"id": "<id>", "question": "..."}]}\n\n'
            + json.dumps(
                [
                    {"id": str(e["id"]), "title": e["title"], "intent": e["intent"], "summary": (e["summary"] or "")[:600]}
                    for e in batch
                ]
            )
        )
        try:
            raw = ai._call_gemini(prompt, temperature=0.4, max_output_tokens=1500, response_mime_type="application/json")
            parsed = ai._extract_json_object(raw)
        except Exception:
            logger.warning("Question generation batch failed", exc_info=True)
            continue
        known = {str(e["id"]): e for e in batch}
        for item in parsed.get("questions") or []:
            entry = known.get(str(item.get("id")))
            question = str(item.get("question") or "").strip()
            if entry and len(question) > 10:
                questions.append({"entry_id": str(entry["id"]), "pr_number": entry["github_pr_number"], "question": question[:300], "source": "generated"})
    return questions


def _template_questions(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "entry_id": str(e["id"]),
            "pr_number": e["github_pr_number"],
            "question": f"Why {str(e['intent'] or e['summary']).strip().rstrip('.')[:200].lower()}?",
            "source": "template",
        }
        for e in entries
    ]


def run_evaluation(db: Session, repo_id: str, run_id: str) -> None:
    from app.api.chat import ChatQuery, _fetch_candidate_entries  # local import avoids a cycle

    started = time.time()
    try:
        entries = _sample_entries(db, repo_id, MAX_QUESTIONS)
        if len(entries) < MIN_ENTRIES:
            raise ValueError(f"Need at least {MIN_ENTRIES} indexed pull requests to evaluate retrieval.")
        ai = AIService()
        questions = _generate_questions(ai, entries) if ai._can_use_gemini() else []
        if len(questions) < MIN_ENTRIES:
            questions = _template_questions(entries)

        cases = []
        hits = {strategy: {k: 0 for k in K_VALUES} for strategy in STRATEGIES}
        reciprocal = {strategy: 0.0 for strategy in STRATEGIES}
        for case in questions:
            ranks: dict[str, int | None] = {}
            for strategy in STRATEGIES:
                payload = ChatQuery(repo_id=repo_id, query=case["question"], limit=10)
                rows = _fetch_candidate_entries(db, payload, strategy=strategy)[:10]
                ids = [str(row["id"]) for row in rows]
                rank = ids.index(case["entry_id"]) + 1 if case["entry_id"] in ids else None
                ranks[strategy] = rank
                if rank:
                    reciprocal[strategy] += 1.0 / rank
                    for k in K_VALUES:
                        if rank <= k:
                            hits[strategy][k] += 1
            cases.append({**case, "ranks": ranks})

        total = max(1, len(cases))
        metrics = {
            "question_count": len(cases),
            "question_source": cases[0]["source"] if cases else None,
            "duration_seconds": round(time.time() - started, 1),
            "strategies": {
                strategy: {
                    **{f"recall@{k}": round(hits[strategy][k] / total, 3) for k in K_VALUES},
                    "mrr": round(reciprocal[strategy] / total, 3),
                }
                for strategy in STRATEGIES
            },
        }
        db.execute(
            text(
                """
                UPDATE eval_runs
                SET status = 'completed', metrics = CAST(:metrics AS jsonb), cases = CAST(:cases AS jsonb), finished_at = NOW()
                WHERE id = :id
                """
            ),
            {"id": run_id, "metrics": json.dumps(metrics), "cases": json.dumps(cases, default=str)},
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Evaluation run %s failed", run_id, exc_info=True)
        db.execute(
            text("UPDATE eval_runs SET status = 'failed', error = :error, finished_at = NOW() WHERE id = :id"),
            {"id": run_id, "error": str(exc)[:500]},
        )
        db.commit()
