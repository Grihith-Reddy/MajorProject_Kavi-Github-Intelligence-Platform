# Public Launch Runbook

## Deployment topology
- Run the FastAPI API service and the ingestion worker as separate processes.
- Keep PostgreSQL on managed storage with automated backups enabled.
- Terminate TLS at the edge and expose only the frontend origin configured in `FRONTEND_URL`.

## Required launch gates
- Apply the versioned database migrations in order: `001_init.sql`, `002_access_control_and_sync_jobs.sql`, `003_chat_memory.sql`, `004_github_oauth_states.sql`, `005_kavi_intelligence.sql`, and `006_impact_and_feedback.sql`. Do not apply the consolidated `database/schema.sql` as well.
- Set real values for `GITHUB_STATE_SECRET` and `TOKEN_ENCRYPTION_KEY`.
- Confirm `GET /health/live` and `GET /health/ready` both return success in the deployed environment.
- Require the CI backend tests, PostgreSQL migration/rollback test, frontend lint, and production build to pass on every push.
- Run the load test in `docs/load-test.js` against staging before each public release.
- Configure rate limiting at the edge/API gateway before exposing the API publicly; the in-process limiter does not share state across service instances.

## Auth and data isolation
- Repository access is enforced through `repository_access`, not just user existence.
- Knowledge, chat, and repository status endpoints reject repo IDs that are not mapped to the caller's connected GitHub account.
- Sync operations grant access explicitly during repository ingestion instead of mutating shared repo ownership.

## SLOs
- Auth verification success rate: `>= 99.9%` over 30 days.
- Repository listing p95 latency: `< 800 ms` excluding GitHub outages.
- Knowledge endpoints p95 latency: `< 350 ms`.
- Chat endpoint p95 latency: `< 5 s` with indexed context available.
- Sync queue pickup delay p95: `< 30 s`.

## Load test pass criteria
- Sustain at least `50` concurrent read users for 15 minutes with no 5xx burst above `0.5%`.
- Keep chat p95 below `5 s`.
- Keep knowledge list p95 below `350 ms`.
- Keep CPU below `70%` and database connections below `80%` of pool capacity.

## Alerts and observability
- Alert on any 5-minute window with `5xx > 1%`.
- Alert on repeated `429` spikes from the app or GitHub upstream.
- Alert when sync jobs remain queued for more than 5 minutes.
- Store JSON audit logs for auth verification, GitHub connection, repo sync, repo status, knowledge access, and chat queries.

## Backup and recovery
- Enable managed daily PostgreSQL backups and point-in-time recovery; set retention to meet the service's recovery objectives.
- Before applying a migration, create a named snapshot or custom-format `pg_dump` backup and verify that the backup completed.
- Test restore to a separate staging database at least once per month. Do not test restoration by overwriting production.
- For an application rollback, redeploy the last known-good immutable API and frontend releases, then verify both health endpoints and a read-only smoke test.
- For a database rollback, stop API and worker writes, restore the pre-migration snapshot into a new database, verify it in staging, then point the prior application release at that restored database. Keep the original database untouched until service is verified.
- The `*_down.sql` scripts are destructive and remove schema objects and their data. Use them only for disposable/test databases or when data loss is explicitly accepted; a production recovery should use the verified snapshot.
- Keep the database backup outside the repository and restrict access to it because it contains user and repository data.

## Privacy and retention
- GitHub authorization uses a GitHub App user access token with read-only Contents, Pull requests, and Issues permissions. Revoke any previously granted classic OAuth App authorization after migration; old tokens retain their original grant until revoked.
- Access tokens are encrypted at rest with Fernet.
- Define and publish user-facing Terms of Service, Privacy Policy, a retention window for indexed PR/chat data, and an account/repository disconnect and deletion flow.
- These documents still require legal review before public launch.

## Release procedure
- Deploy to staging first.
- Run backend tests, frontend build, and staging load test.
- Start the API, then the ingestion worker, then promote frontend.
- Watch `/health/ready`, error rate, queue depth, and auth failures for the first 30 minutes.
- Roll back immediately on auth leakage, queue stalls, or sustained 5xx errors.
