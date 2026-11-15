DROP TABLE IF EXISTS eval_runs;
DROP TABLE IF EXISTS guardian_reviews;
DROP TABLE IF EXISTS kavi_tokens;
DROP TABLE IF EXISTS blame_cache;
DROP TABLE IF EXISTS pr_promises;
DROP TABLE IF EXISTS pr_participants;

ALTER TABLE knowledge_entries DROP COLUMN IF EXISTS embedding_model;
ALTER TABLE knowledge_entries DROP COLUMN IF EXISTS embedding;
ALTER TABLE sync_jobs DROP COLUMN IF EXISTS full_resync;
ALTER TABLE sync_jobs DROP COLUMN IF EXISTS progress;
ALTER TABLE repositories DROP COLUMN IF EXISTS last_pr_updated_at;
