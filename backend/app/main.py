import logging

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy import text

from app.api import auth, chat, github, guardian, ingestion, insights, knowledge, mcp
from app.core.database import SessionLocal
from app.core.middleware import (
    RateLimitMiddleware,
    RequestContextMiddleware,
    RequestSizeLimitMiddleware,
    UnhandledErrorMiddleware,
)
from app.core.settings import settings


logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
settings.validate_runtime()

app = FastAPI(
    title="KAVI API",
    version="0.2.0",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

# Innermost first: unexpected errors are caught inside CORS and the request-id middleware.
app.add_middleware(UnhandledErrorMiddleware)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(RequestSizeLimitMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins(),
    allow_origin_regex=None if settings.is_production else r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)

app.include_router(auth.router, prefix=settings.API_V1_PREFIX)
app.include_router(github.router, prefix=settings.API_V1_PREFIX)
app.include_router(ingestion.router, prefix=settings.API_V1_PREFIX)
app.include_router(knowledge.router, prefix=settings.API_V1_PREFIX)
app.include_router(chat.router, prefix=settings.API_V1_PREFIX)
app.include_router(insights.router, prefix=settings.API_V1_PREFIX)
app.include_router(guardian.router, prefix=settings.API_V1_PREFIX)
app.include_router(mcp.router, prefix=settings.API_V1_PREFIX)


@app.get("/")
def root():
    return {"status": "ok", "service": "kavi-api"}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready():
    db = SessionLocal()
    try:
        schema_state = db.execute(
            text(
                """
                SELECT
                    to_regclass('public.users') IS NOT NULL AS users,
                    to_regclass('public.github_accounts') IS NOT NULL AS github_accounts,
                    to_regclass('public.repositories') IS NOT NULL AS repositories,
                    to_regclass('public.repository_access') IS NOT NULL AS repository_access,
                    to_regclass('public.knowledge_entries') IS NOT NULL AS knowledge_entries,
                    to_regclass('public.sync_jobs') IS NOT NULL AS sync_jobs,
                    to_regclass('public.chat_conversations') IS NOT NULL AS chat_conversations,
                    to_regclass('public.chat_messages') IS NOT NULL AS chat_messages,
                    to_regclass('public.chat_memory_items') IS NOT NULL AS chat_memory_items,
                    to_regclass('public.github_oauth_states') IS NOT NULL AS github_oauth_states,
                    to_regclass('public.pr_promises') IS NOT NULL AS pr_promises,
                    to_regclass('public.kavi_tokens') IS NOT NULL AS kavi_tokens,
                    to_regclass('public.eval_runs') IS NOT NULL AS eval_runs,
                    to_regclass('public.chat_feedback') IS NOT NULL AS chat_feedback
                """
            )
        ).mappings().one()
        if not all(schema_state.values()):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database schema is not ready; apply all versioned migrations.",
            )
        return {"status": "ready"}
    finally:
        db.close()
