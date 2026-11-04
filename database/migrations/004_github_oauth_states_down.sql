DROP TABLE IF EXISTS github_oauth_states;
ALTER TABLE github_accounts DROP COLUMN IF EXISTS authorization_type;
