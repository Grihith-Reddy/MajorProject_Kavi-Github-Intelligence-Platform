-- KAVI 2.0: incremental sync, semantic memory, Why-Lens, Guardian, Promise Tracker,
-- personal access tokens (MCP / Guardian) and retrieval evaluation.
-- Embeddings are stored as REAL[] so the migration works on any PostgreSQL 14+
-- (no pgvector extension required). Similarity is computed per repository in the API.

ALTER TABLE repositories ADD COLUMN IF NOT EXISTS last_pr_updated_at TIMESTAMPTZ;

ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS progress JSONB;
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS full_resync BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS embedding REAL[];
ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS embedding_model TEXT;

CREATE TABLE IF NOT EXISTS pr_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    pr_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    login TEXT NOT NULL,
    role TEXT NOT NULL,
    interactions INTEGER NOT NULL DEFAULT 1,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (role IN ('author', 'reviewer', 'commenter')),
    UNIQUE (pr_id, login, role)
);

CREATE TABLE IF NOT EXISTS pr_promises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    pr_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    signature TEXT NOT NULL,
    author_login TEXT,
    quote TEXT NOT NULL,
    summary TEXT,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT,
    made_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'open',
    resolved_pr_id UUID REFERENCES pull_requests(id) ON DELETE SET NULL,
    resolution_note TEXT,
    resolution_confidence NUMERIC(4, 3),
    embedding REAL[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (kind IN ('follow_up', 'todo', 'temporary', 'tech_debt')),
    CHECK (source IN ('body', 'comment', 'review', 'commit')),
    CHECK (status IN ('open', 'kept', 'dismissed')),
    UNIQUE (pr_id, signature)
);

CREATE TABLE IF NOT EXISTS blame_cache (
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    ref TEXT NOT NULL,
    payload JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (repo_id, file_path, ref)
);

CREATE TABLE IF NOT EXISTS kavi_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    label TEXT,
    token_prefix TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (scope IN ('mcp', 'guardian'))
);

CREATE TABLE IF NOT EXISTS guardian_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    pr_number INTEGER NOT NULL,
    head_sha TEXT NOT NULL,
    verdict TEXT NOT NULL,
    findings JSONB NOT NULL DEFAULT '[]'::jsonb,
    comment_markdown TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (verdict IN ('clear', 'heads_up', 'conflict')),
    UNIQUE (repo_id, pr_number, head_sha)
);

CREATE TABLE IF NOT EXISTS eval_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'running',
    metrics JSONB,
    cases JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_pr_participants_repo_login ON pr_participants(repo_id, login);
CREATE INDEX IF NOT EXISTS idx_pr_participants_pr ON pr_participants(pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_promises_repo_status ON pr_promises(repo_id, status, made_at DESC);
CREATE INDEX IF NOT EXISTS idx_kavi_tokens_user ON kavi_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_guardian_reviews_repo ON guardian_reviews(repo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_runs_repo ON eval_runs(repo_id, created_at DESC);
