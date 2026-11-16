"""Personal access tokens for machine clients (Guardian GitHub Action, MCP server).

Tokens are shown once, stored only as SHA-256 hashes, scoped ('guardian' tokens are
also bound to one repository) and revocable.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.access import is_uuid
from app.core.database import get_db

TOKEN_PREFIXES = {"guardian": "kavi_gd_", "mcp": "kavi_mcp_"}
_bearer = HTTPBearer(auto_error=False)


@dataclass
class TokenPrincipal:
    token_id: str
    user_id: str
    auth0_sub: str
    scope: str
    repo_id: str | None


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_token(db: Session, *, user_id: str, scope: str, repo_id: str | None, label: str | None) -> dict[str, Any]:
    if scope not in TOKEN_PREFIXES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown token scope")
    raw = TOKEN_PREFIXES[scope] + secrets.token_urlsafe(32)
    row = db.execute(
        text(
            """
            INSERT INTO kavi_tokens (id, user_id, repo_id, scope, label, token_prefix, token_hash)
            VALUES (gen_random_uuid(), :user_id, :repo_id, :scope, :label, :prefix, :hash)
            RETURNING id, scope, repo_id, label, token_prefix, created_at
            """
        ),
        {
            "user_id": user_id,
            "repo_id": repo_id,
            "scope": scope,
            "label": (label or "").strip()[:80] or None,
            "prefix": raw[: len(TOKEN_PREFIXES[scope]) + 4],
            "hash": hash_token(raw),
        },
    ).mappings().one()
    db.commit()
    return {**dict(row), "token": raw}


def list_tokens(db: Session, *, user_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT t.id, t.scope, t.repo_id, r.full_name AS repo_full_name, t.label, t.token_prefix,
                   t.last_used_at, t.created_at
            FROM kavi_tokens t
            LEFT JOIN repositories r ON r.id = t.repo_id
            WHERE t.user_id = :user_id AND t.revoked_at IS NULL
            ORDER BY t.created_at DESC
            """
        ),
        {"user_id": user_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def revoke_token(db: Session, *, user_id: str, token_id: str) -> bool:
    if not is_uuid(token_id):
        return False
    result = db.execute(
        text(
            """
            UPDATE kavi_tokens SET revoked_at = NOW()
            WHERE id = CAST(:token_id AS uuid) AND user_id = :user_id AND revoked_at IS NULL
            """
        ),
        {"token_id": token_id, "user_id": user_id},
    )
    db.commit()
    return bool(result.rowcount)


def _resolve(db: Session, raw: str) -> TokenPrincipal | None:
    if not raw.startswith("kavi_"):
        return None
    row = db.execute(
        text(
            """
            SELECT t.id, t.user_id, t.scope, t.repo_id, u.auth0_sub
            FROM kavi_tokens t
            JOIN users u ON u.id = t.user_id
            WHERE t.token_hash = :hash AND t.revoked_at IS NULL
            """
        ),
        {"hash": hash_token(raw)},
    ).mappings().first()
    if not row:
        return None
    db.execute(text("UPDATE kavi_tokens SET last_used_at = NOW() WHERE id = :id"), {"id": row["id"]})
    db.commit()
    return TokenPrincipal(
        token_id=str(row["id"]),
        user_id=str(row["user_id"]),
        auth0_sub=str(row["auth0_sub"]),
        scope=str(row["scope"]),
        repo_id=str(row["repo_id"]) if row["repo_id"] else None,
    )


def require_token(scope: str):
    def _dependency(
        credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
        db: Session = Depends(get_db),
    ) -> TokenPrincipal:
        if not credentials:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing KAVI token")
        principal = _resolve(db, credentials.credentials)
        if principal is None or principal.scope != scope:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or revoked KAVI token")
        return principal

    return _dependency
