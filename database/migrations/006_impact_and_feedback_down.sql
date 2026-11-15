DROP TABLE IF EXISTS chat_feedback;
ALTER TABLE guardian_reviews DROP COLUMN IF EXISTS reviewers;
ALTER TABLE guardian_reviews DROP COLUMN IF EXISTS impact;
