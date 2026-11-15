-- KAVI 2.1: Guardian change-impact and reviewer suggestions, chat answer feedback.

ALTER TABLE guardian_reviews ADD COLUMN IF NOT EXISTS impact JSONB;
ALTER TABLE guardian_reviews ADD COLUMN IF NOT EXISTS reviewers JSONB;

CREATE TABLE IF NOT EXISTS chat_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (rating IN (-1, 1)),
    UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_feedback_repo ON chat_feedback(repo_id, created_at DESC);
