ALTER TABLE github_accounts
    ADD COLUMN IF NOT EXISTS authorization_type TEXT NOT NULL DEFAULT 'legacy_oauth';

CREATE TABLE IF NOT EXISTS github_oauth_states (
    state_id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_verifier_encrypted TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_oauth_states_expires_at
    ON github_oauth_states(expires_at);
