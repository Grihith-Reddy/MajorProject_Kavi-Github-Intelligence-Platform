# Free Hobby Deployment Guide

This guide describes a $0, hobby/demo topology. It is not a production availability or durability guarantee:

- **Frontend:** Vercel Hobby static hosting (personal, non-commercial use only).
- **API:** Render Free web service; it can spin down when idle and consumes the workspace's shared free instance hours.
- **Database:** Neon Free PostgreSQL; current plan limits include 1 GB per project and 100 CU-hours per project. Check the current plan before relying on it.
- **Ingestion worker:** runs inside the API (`INLINE_SYNC_WORKER=true`). A manual GitHub Actions workflow is kept as a fallback.

The Render free PostgreSQL database is intentionally not used: it expires 30 days after creation and is deleted after its upgrade grace period. Render free services also are not intended for production workloads. Free-plan limits can change; confirm them before deployment.

## 1. Prepare accounts and repository

1. Push the reviewed code to the repository's default branch.
2. Create accounts for GitHub, Render, Neon, Vercel, and Firebase. Create a Gemini API key if AI summaries and chat are required.
3. Keep all credentials in the providers' secret/environment-variable forms. Never paste secrets into source files, commits, issues, or chat.
4. Generate secrets locally (these commands print values only to your terminal):
   ```powershell
   backend\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
   Use the first value for `TOKEN_ENCRYPTION_KEY` and the second for `GITHUB_STATE_SECRET`. Configure the same `TOKEN_ENCRYPTION_KEY` for the Render API and GitHub Actions worker; losing or changing it invalidates stored encrypted GitHub tokens. Never paste either value into chat or commit it.

## 2. Create the empty PostgreSQL database in Neon

1. Create a Neon project and database. Copy its PostgreSQL connection string from the Neon dashboard; keep the SSL setting enabled.
2. No existing users or application data need to be migrated. This step initializes the empty database schema so the application can start. Prefer the versioned schema migrations, in order:
   - `database/migrations/001_init.sql`
   - `database/migrations/002_access_control_and_sync_jobs.sql`
   - `database/migrations/003_chat_memory.sql`
   - `database/migrations/004_github_oauth_states.sql`
   - `database/migrations/005_kavi_intelligence.sql`
   - `database/migrations/006_impact_and_feedback.sql`
3. From the repository root in PowerShell, set the Neon URL in the current terminal (do not save it in a file or commit it), then run all five files in one go:
   ```powershell
   $env:DATABASE_URL = "<paste the Neon connection string here>"
   psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 `
     -f .\database\migrations\001_init.sql `
     -f .\database\migrations\002_access_control_and_sync_jobs.sql `
     -f .\database\migrations\003_chat_memory.sql `
     -f .\database\migrations\004_github_oauth_states.sql `
     -f .\database\migrations\005_kavi_intelligence.sql `
     -f .\database\migrations\006_impact_and_feedback.sql
   ```
   Upgrading an existing database? Run only the migrations it does not have yet: `005_kavi_intelligence.sql` for a KAVI 1.x database, then `006_impact_and_feedback.sql`. Both are additive (new tables and nullable columns) and safe to apply before deploying the new code. Apply them **before** merging into `main`, because `main` deploys automatically.

   A successful run returns to the PowerShell prompt with no SQL error. `ON_ERROR_STOP` makes `psql` stop at the first failed script. If `psql` is not installed, open each migration file in the Neon SQL Editor, paste and run the complete file in order, waiting for success before running the next.
4. For a brand-new database you can alternatively run `database/schema.sql` once instead of the migration files. **Do not run both approaches** on the same database.
5. Keep the connection string for the Render and GitHub Actions secret settings. The free plan has bounded storage, compute, and recovery history; export data periodically if it matters.

## 3. Configure Firebase Google sign-in

1. In Firebase Console, create/select a project and enable **Google** under Authentication providers.
2. Add the planned Vercel production hostname to Firebase Authentication's **Authorized domains**. Do not include a scheme or path.
3. Create a Firebase Web App and note its web configuration values for the frontend.
4. Create a server-side Firebase service account credential for the backend. Store its JSON securely; do not commit it.

## 4. Configure a least-privilege GitHub App

1. Create a GitHub App and set its **User authorization callback URL** to the eventual API URL:
   `https://<render-api-domain>/api/github/callback`
   Render assigns the API URL when the web service is created. If it is not known yet, use the local callback temporarily and replace it with the exact Render URL before testing GitHub connection.
2. Grant only these **repository permissions**, all **Read-only**:
   - **Contents**: read repository trees and file contents.
   - **Pull requests**: read pull requests, commits, reviews, and changed files.
   - **Issues**: read pull-request conversation comments.
   Repository metadata is granted automatically. Do not grant write or administration permissions.
3. Configure the app for the intended account ownership and install it only on repositories that should be available to KAVI. Keep GitHub App user-access-token expiration disabled unless token refresh is implemented and tested.
4. Save the GitHub App **Client ID** (not App ID) as `GITHUB_CLIENT_ID` and its client secret as `GITHUB_CLIENT_SECRET` in Render.
5. Make sure the empty Neon database is initialized through migration 006 (or the consolidated `database/schema.sql`) before deploying this backend. Existing OAuth connections are marked legacy and blocked until the user reconnects. Old OAuth App grants may still exist at GitHub: revoke them from GitHub account settings after cutover, then reconnect using the new GitHub App.

## 5. Deploy the API on Render

1. Create a Render Web Service from the repository using the root `render.yaml` Blueprint.
2. Set the required environment variables in Render:
   - `DATABASE_URL`: Neon PostgreSQL connection string.
   - `FRONTEND_URL`: exact Vercel production origin, for example `https://<project>.vercel.app` (no trailing slash).
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CREDENTIALS_JSON` (or configure a secure credentials file and `FIREBASE_CREDENTIALS_PATH`)
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `GITHUB_OAUTH_REDIRECT_URI`: `https://<render-api-domain>/api/github/callback`
   - `GITHUB_STATE_SECRET`: generated random secret, at least 32 bytes.
   - `TOKEN_ENCRYPTION_KEY`: valid Fernet key.
   - `AI_API_KEY`: Gemini API key, if AI features are enabled.
   - Optional: `RATE_LIMIT_REQUESTS_PER_MINUTE` (default 120) and `RATE_LIMIT_EXPENSIVE_PER_MINUTE` (default 12, applies to chat, sync and quality runs).

   The blueprint's start command is `uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'`. The proxy flags let rate limits see each visitor's real address behind Render's proxy. If the service was created before this flag was added, update **Settings → Start Command** in Render to match.
3. Wait for the API deployment. The API's initial `/health/ready` check must return success only after migrations are applied. Render's free instance may sleep while idle; the first request can be delayed.
4. Record the Render service's HTTPS URL. The blueprint health check uses `/health/live`; use `/health/ready` to verify the database schema.

## 6. Deploy the frontend on Vercel

1. Import the repository in Vercel and set **Root Directory** to `frontend`.
2. Use `npm ci` as the install command, `npm run build` as the build command, and `dist` as the output directory.
3. Set these Vercel environment variables:
   - `VITE_API_BASE_URL=https://<render-api-domain>/api`
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
4. Deploy and note the production URL. Confirm that `frontend/vercel.json` SPA fallback supports refreshing nested routes.
5. If the production URL differs from the value used for `FRONTEND_URL`, update Render's `FRONTEND_URL` to the exact origin and redeploy the API.
6. Add the exact production hostname to Firebase's authorized domains and verify the callback URL in the GitHub App settings.

## 7. Optional: the manual ingestion worker

In the GitHub repository's **Settings → Secrets and variables → Actions**, add:

- `DATABASE_URL`: the same Neon connection string used by Render.
- `TOKEN_ENCRYPTION_KEY`: exactly the same Fernet key used by Render.
- `AI_API_KEY`: Gemini API key used for repository summaries.

Syncs normally run inside the API. `.github/workflows/ingestion-worker.yml` is manual only (Actions tab → **Ingestion worker (manual)** → **Run workflow**) and processes one queued sync job per run. It is deliberately not scheduled: private repositories get a limited number of free Actions minutes each month.

## 8. Add UptimeRobot monitoring (optional)

1. Create a free UptimeRobot account and add an **HTTP(s)** monitor.
2. Set the friendly name to `KAVI API health`.
3. Set the URL to `https://<render-api-domain>/health/ready`, choose a 5-minute interval, and save it. This endpoint checks that the API can reach PostgreSQL and that required tables exist.
4. Configure an alert contact and wait for the first successful check. If it reports a failure, open the Render service logs and verify `/health/ready` directly.

UptimeRobot is monitoring, not an uptime guarantee. Its periodic requests may keep an idle free web service active and consume Render's free instance hours; Render can still sleep or throttle the service, and free-plan terms can change. Do not rely on repeated pings as a substitute for an always-on paid service.

## 9. Verify the deployment

1. Open `https://<render-api-domain>/health/live`; expect HTTP 200.
2. Open `https://<render-api-domain>/health/ready`; expect HTTP 200 and `{"status":"ready"}`. A 503 means the database is unavailable or a required migration is missing.
3. Open the Vercel production URL; sign in with Google.
4. Connect GitHub, verify the intended account, and select a repository.
5. Trigger a repository sync and confirm the repository shows indexed pull requests. If a sync stays queued, run **Ingestion worker (manual)** once from the Actions tab.
6. Ask KAVI a question about the selected repository, including an exact file-content question, and verify that the answer is grounded in the connected repository.
7. Check Render logs, Actions logs, and Neon usage after the smoke test. Never include secret values in logs or support reports.

## Free-plan references

- [Render free services and limitations](https://render.com/docs/free)
- [Neon plans and limits](https://neon.com/docs/introduction/plans)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
