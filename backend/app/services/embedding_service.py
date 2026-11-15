"""Text embeddings for KAVI's semantic memory.

Uses the Gemini embedding API (free tier) when an API key is configured. Without a
key, a deterministic local feature-hashing embedder keeps semantic retrieval working
offline (lexical-semantic rather than truly semantic, but consistent and free).

Vectors are L2-normalised and stored as REAL[]; cosine similarity is a dot product.
Every stored vector records the model that produced it, and queries only compare
against vectors from the same model.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
import threading
import time
from typing import Any, Iterable, Sequence

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.resilience import ai_circuit_breaker
from app.core.settings import settings


logger = logging.getLogger(__name__)

LOCAL_MODEL = "local-hash-v1"
LOCAL_DIMENSIONS = 512
_GEMINI_BATCH_SIZE = 64
_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9]+|\d+")
_CAMEL_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_STOP_WORDS = {
    "the", "and", "for", "with", "this", "that", "from", "into", "are", "was", "were", "has",
    "have", "had", "but", "not", "you", "your", "our", "its", "his", "her", "they", "them",
    "will", "can", "all", "any", "out", "use", "using", "used", "add", "adds", "added", "pr",
}


class EmbeddingUnavailable(Exception):
    pass


def preferred_model() -> str:
    if settings.AI_PROVIDER.lower() == "gemini" and settings.AI_API_KEY:
        return settings.EMBEDDING_MODEL
    return LOCAL_MODEL


def _normalize(vector: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm <= 0:
        return [0.0 for _ in vector]
    return [float(value) / norm for value in vector]


def _tokens(text_value: str) -> list[str]:
    pieces: list[str] = []
    for raw in _TOKEN_RE.findall(text_value or ""):
        for part in _CAMEL_RE.split(raw):
            lowered = part.lower()
            if len(lowered) >= 2 and lowered not in _STOP_WORDS:
                pieces.append(lowered)
    return pieces


def local_embedding(text_value: str, dimensions: int = LOCAL_DIMENSIONS) -> list[float]:
    """Signed feature hashing over unigrams, bigrams and 4-char prefixes."""
    vector = [0.0] * dimensions
    tokens = _tokens(text_value)
    features: list[tuple[str, float]] = []
    for token in tokens:
        features.append((token, 1.0))
        if len(token) > 5:
            features.append((f"pre:{token[:4]}", 0.5))
    for left, right in zip(tokens, tokens[1:]):
        features.append((f"{left} {right}", 0.7))
    for feature, weight in features:
        digest = hashlib.md5(feature.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "little") % dimensions
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[index] += sign * weight
    return _normalize(vector)


def _gemini_batch(texts: list[str], task_type: str, model: str) -> list[list[float]]:
    ai_circuit_breaker.before_request()
    body = {
        "requests": [
            {
                "model": f"models/{model}",
                "content": {"parts": [{"text": item[:8000]}]},
                "taskType": task_type,
                "outputDimensionality": settings.EMBEDDING_DIMENSIONS,
            }
            for item in texts
        ]
    }
    last_error: str | None = None
    for attempt in range(settings.OUTBOUND_RETRY_ATTEMPTS):
        try:
            response = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents",
                headers={"x-goog-api-key": settings.AI_API_KEY or ""},
                json=body,
                timeout=settings.REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            ai_circuit_breaker.record_failure()
            last_error = type(exc).__name__
            time.sleep(min(2 ** attempt, 8))
            continue

        if response.status_code in {429, 500, 502, 503, 504}:
            ai_circuit_breaker.record_failure()
            last_error = f"HTTP {response.status_code}"
            time.sleep(min(2 ** (attempt + 1), 10))
            continue
        if response.status_code >= 400:
            raise EmbeddingUnavailable(f"Gemini embedding error (HTTP {response.status_code})")

        ai_circuit_breaker.record_success()
        embeddings = (response.json() or {}).get("embeddings") or []
        vectors = [_normalize(item.get("values") or []) for item in embeddings if isinstance(item, dict)]
        if len(vectors) != len(texts) or any(not vector for vector in vectors):
            raise EmbeddingUnavailable("Gemini embedding response was incomplete")
        return vectors
    raise EmbeddingUnavailable(f"Gemini embeddings unavailable ({last_error})")


def embed_texts(texts: list[str], *, task_type: str = "RETRIEVAL_DOCUMENT", model: str | None = None) -> tuple[str, list[list[float]]]:
    """Embed texts with the requested (or preferred) model.

    Raises EmbeddingUnavailable when a remote model is requested but cannot be
    reached; callers decide whether to degrade. The local model never fails.
    """
    chosen = model or preferred_model()
    if not texts:
        return chosen, []
    if chosen == LOCAL_MODEL:
        return chosen, [local_embedding(item) for item in texts]
    vectors: list[list[float]] = []
    for offset in range(0, len(texts), _GEMINI_BATCH_SIZE):
        vectors.extend(_gemini_batch(texts[offset : offset + _GEMINI_BATCH_SIZE], task_type, chosen))
    return chosen, vectors


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return float(sum(x * y for x, y in zip(a, b)))


def entry_embedding_text(row: dict[str, Any]) -> str:
    parts: list[str] = []
    if row.get("github_pr_number"):
        parts.append(f"PR #{row['github_pr_number']}: {row.get('pr_title') or ''}")
    for key in ("summary", "intent"):
        if row.get(key):
            parts.append(str(row[key]))
    for key in ("decisions", "risks"):
        value = row.get(key)
        if isinstance(value, list) and value:
            parts.append(f"{key.title()}: " + "; ".join(str(item) for item in value[:12]))
    tags = row.get("tags")
    if isinstance(tags, list) and tags:
        parts.append("Tags: " + ", ".join(str(tag) for tag in tags[:12]))
    files = row.get("file_paths")
    if isinstance(files, list) and files:
        parts.append("Files: " + ", ".join(str(path) for path in files[:20]))
    return "\n".join(parts)[:7000]


# ── Per-repository vector cache ─────────────────────────────────────────────

_cache_lock = threading.Lock()
_vector_cache: dict[tuple[str, str], dict[str, Any]] = {}
_CACHE_TTL_SECONDS = 120
_query_cache: dict[tuple[str, str], list[float]] = {}


def invalidate_repo_vectors(repo_id: str) -> None:
    with _cache_lock:
        for key in [key for key in _vector_cache if key[0] == str(repo_id)]:
            _vector_cache.pop(key, None)


def _load_repo_vectors(db: Session, repo_id: str, model: str) -> list[tuple[str, list[float]]]:
    key = (str(repo_id), model)
    now = time.time()
    with _cache_lock:
        cached = _vector_cache.get(key)
        if cached and now - cached["loaded_at"] < _CACHE_TTL_SECONDS:
            return cached["vectors"]
    rows = db.execute(
        text(
            """
            SELECT id, embedding
            FROM knowledge_entries
            WHERE repo_id = :repo_id
              AND embedding IS NOT NULL
              AND embedding_model = :model
            """
        ),
        {"repo_id": str(repo_id), "model": model},
    ).mappings().all()
    vectors = [(str(row["id"]), [float(v) for v in row["embedding"]]) for row in rows if row["embedding"]]
    with _cache_lock:
        _vector_cache[key] = {"loaded_at": now, "vectors": vectors}
    return vectors


def repo_embedding_model(db: Session, repo_id: str) -> str | None:
    row = db.execute(
        text(
            """
            SELECT embedding_model, COUNT(*) AS n
            FROM knowledge_entries
            WHERE repo_id = :repo_id AND embedding IS NOT NULL
            GROUP BY embedding_model
            ORDER BY n DESC
            LIMIT 1
            """
        ),
        {"repo_id": str(repo_id)},
    ).mappings().first()
    return str(row["embedding_model"]) if row and row["embedding_model"] else None


def semantic_search(db: Session, repo_id: str, query: str, limit: int = 12) -> list[tuple[str, float]]:
    """Return (entry_id, cosine) pairs ranked by similarity. Empty when unavailable."""
    if not query.strip():
        return []
    try:
        model = repo_embedding_model(db, repo_id)
    except Exception:
        # e.g. migration 005 not applied yet: semantic retrieval is simply off.
        db.rollback()
        logger.warning("Semantic search unavailable for repo %s", repo_id, exc_info=True)
        return []
    if not model:
        return []
    cache_key = (model, query.strip()[:2000])
    cached_vector = _query_cache.get(cache_key)
    try:
        if cached_vector is not None:
            vectors = [cached_vector]
        else:
            _, vectors = embed_texts([query], task_type="RETRIEVAL_QUERY", model=model)
            if len(_query_cache) >= 512:
                _query_cache.pop(next(iter(_query_cache)))
            _query_cache[cache_key] = vectors[0]
    except EmbeddingUnavailable as exc:
        logger.warning("Semantic search skipped: %s", exc)
        return []
    except Exception:
        logger.warning("Semantic search skipped due to an unexpected error", exc_info=True)
        return []
    query_vector = vectors[0]
    try:
        stored = _load_repo_vectors(db, repo_id, model)
    except Exception:
        db.rollback()
        logger.warning("Unable to load stored vectors for repo %s", repo_id, exc_info=True)
        return []
    scored = [(entry_id, cosine(query_vector, vector)) for entry_id, vector in stored]
    scored.sort(key=lambda item: item[1], reverse=True)
    return scored[: max(1, limit)]


def backfill_repo_embeddings(db: Session, repo_id: str, *, max_entries: int = 1000) -> dict[str, Any]:
    """Embed knowledge entries that have no vector (or one from a different model)."""
    model = preferred_model()
    rows = db.execute(
        text(
            """
            SELECT k.id, k.summary, k.intent, k.decisions, k.risks, k.tags,
                   pr.github_pr_number, pr.title AS pr_title,
                   ARRAY(
                       SELECT DISTINCT fm.file_path FROM file_mappings fm
                       WHERE fm.knowledge_entry_id = k.id
                       LIMIT 20
                   ) AS file_paths
            FROM knowledge_entries k
            LEFT JOIN pull_requests pr ON pr.id = k.pr_id
            WHERE k.repo_id = :repo_id
              AND (k.embedding IS NULL OR k.embedding_model IS DISTINCT FROM :model)
            ORDER BY COALESCE(pr.merged_at, pr.updated_at, k.updated_at) DESC
            LIMIT :limit
            """
        ),
        {"repo_id": str(repo_id), "model": model, "limit": max_entries},
    ).mappings().all()
    if not rows:
        return {"model": model, "embedded": 0}

    embedded = 0
    batch_size = _GEMINI_BATCH_SIZE
    for offset in range(0, len(rows), batch_size):
        batch = [dict(row) for row in rows[offset : offset + batch_size]]
        texts_to_embed = [entry_embedding_text(row) for row in batch]
        try:
            _, vectors = embed_texts(texts_to_embed, model=model)
        except EmbeddingUnavailable as exc:
            # Leave the rest for the next sync instead of mixing models in one repository.
            logger.warning("Embedding backfill paused for repo %s: %s", repo_id, exc)
            break
        for row, vector in zip(batch, vectors):
            db.execute(
                text(
                    """
                    UPDATE knowledge_entries
                    SET embedding = CAST(:embedding AS real[]), embedding_model = :model
                    WHERE id = :id
                    """
                ),
                {"embedding": vector, "model": model, "id": str(row["id"])},
            )
            embedded += 1
        db.commit()
    invalidate_repo_vectors(repo_id)
    return {"model": model, "embedded": embedded}


def reciprocal_rank_fusion(rankings: Iterable[Sequence[str]], k: int = 60) -> list[tuple[str, float]]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, item_id in enumerate(ranking):
            scores[item_id] = scores.get(item_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores.items(), key=lambda item: item[1], reverse=True)
