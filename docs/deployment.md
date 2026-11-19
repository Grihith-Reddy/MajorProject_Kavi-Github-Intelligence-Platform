# Deployment guide

This is the exact route KAVI's live deployment took (November 2026). Every service is on a free plan.

| Part | Service | Live address |
|---|---|---|
| Website | Vercel (Hobby) | https://kavi-memory.vercel.app |
| API | Render (Free web service, Singapore) | https://kavi-api-5af0.onrender.com |
| Database | Neon (Free, AWS Singapore) | private connection string |
| Sign-in | Firebase Authentication | Google + email/password |
| GitHub access | GitHub App "Kavi Memory" | read-only |
| Keep-awake monitor | UptimeRobot (Free) | pings `/health/live` |

**How changes go live:** anything merged into `main` deploys automatically. Vercel rebuilds the website and Render rebuilds the API. Work on a branch, open a pull request, wait for the CI checks, then merge.

Keep all secret values in the providers' settings screens. Never commit them, and never paste them into issues or chat.

---

## 1. Database: Neon

1. Create a Neon account and a project named `kavi`. Choose the region closest to you, and use the same region for Render (KAVI uses **AWS Asia Pacific (Singapore)**). Keep the database name `neondb`.
2. Open **SQL Editor** (branch `main`, database `neondb`). Paste the whole of `database/schema.sql` and run it. It creates all 20 tables and matches migrations 001–006 exactly.
3. Check it: `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';` should return `20`.
4. **Dashboard → Connect.** Turn **Connection pooling off** (the API keeps its own pool) and copy the connection string. It ends with `sslmode=require`. This is `DATABASE_URL`.

Upgrading an existing database instead of starting fresh? Run only the numbered files in `database/migrations/` that it does not have yet, in order. Never run `schema.sql` on a database that already has tables.

## 2. Two production secrets

Generate them on your own computer. They print only to your terminal.

```bash
backend/.venv/Scripts/python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

```bash
backend/.venv/Scripts/python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
```

The first is `TOKEN_ENCRYPTION_KEY`, the second `GITHUB_STATE_SECRET`. Use new values for production, not the ones in your local `.env`.

> **Never change `TOKEN_ENCRYPTION_KEY` once people have connected GitHub.** Stored GitHub tokens are encrypted with it; a new key makes every connection unreadable, and everyone must reconnect.

## 3. API: Render

`render.yaml` describes the service (free plan, Singapore, Python 3.11, start command with `--proxy-headers`).

1. Sign up with GitHub. **New → Blueprint**, connect the repository (install Render's GitHub app on that repository only), branch `main`.
2. Render asks for the settings marked `sync: false`:

| Setting | Value |
|---|---|
| `FRONTEND_URL` | the website address from step 4, for example `https://kavi-memory.vercel.app`. A placeholder like `https://kavi-placeholder.vercel.app` works until then. No trailing slash. |
| `DATABASE_URL` | the Neon connection string |
| `FIREBASE_PROJECT_ID` | your Firebase project id |
| `FIREBASE_CREDENTIALS_JSON` | the full contents of the Firebase service-account JSON file |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | from the GitHub App (step 6) |
| `GITHUB_OAUTH_REDIRECT_URI` | `https://<your-render-address>/api/github/callback` |
| `GITHUB_STATE_SECRET`, `TOKEN_ENCRYPTION_KEY` | from step 2 |
| `AI_API_KEY` | your Gemini API key |

3. Deploy and wait for **"Your service is live"**. Then open `https://<your-render-address>/health/ready`; it should return `{"status":"ready"}`.

On startup the API refuses to run with unsafe settings: it requires HTTPS addresses, real secrets of at least 32 bytes and a valid encryption key. The log names the exact setting it rejected.

## 4. Website: Vercel

1. Sign up (Hobby) with GitHub. **Add New → Project**, install Vercel's GitHub app on the repository only, then **Import**.
2. **Root Directory: `frontend`** (Vite is detected automatically).
3. Environment variables:

| Key | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://<your-render-address>/api` |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID` | from the Firebase web app config |

4. Deploy. Then give the project a short address. In the project's **Domains** settings (or **Ctrl + K → Add Domain**), add a free name such as `kavi-memory.vercel.app` for **Production**.
5. Use that production address everywhere, not the long per-deployment links: those are protected by a Vercel login.

`VITE_*` values are baked in at build time; after changing one, redeploy.

## 5. Point the API at the website

In Render → **Environment**, set `FRONTEND_URL` to the website's production address and click **Save, rebuild and deploy**. The API only accepts browser requests from that origin (CORS).

## 6. GitHub App

KAVI needs a **GitHub App**. An OAuth App would only see public repositories, because KAVI asks for no OAuth scopes.

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Name (unique on GitHub), **Homepage URL** = the website address, **Callback URL** = `https://<your-render-address>/api/github/callback`. You can add `http://localhost:8000/api/github/callback` as a second callback for local work.
3. **Expire user authorization tokens: off.** KAVI rejects expiring tokens. Leave "Request user authorization during installation" and "Device Flow" off, and untick **Webhook → Active**.
4. Repository permissions, all **Read-only**: Contents, Issues, Pull requests (Metadata is automatic). Everything else: No access.
5. **Where can this GitHub App be installed: Any account** (so others can connect their repos).
6. Copy the **Client ID** (starts with `Iv`, not the numeric App ID) and **Generate a new client secret**. Put both into Render.
7. **Install App** on your account, choosing all or selected repositories. KAVI can only see repositories where the app is installed.

## 7. Firebase

Firebase console → **Authentication → Settings → Authorized domains → Add domain**, and add the website's domain (for example `kavi-memory.vercel.app`). Without it, Google sign-in on the live site fails with "unauthorized domain".

## 8. Keep the API awake: UptimeRobot

Render's free plan sleeps after 15 minutes without traffic, and the next visitor waits 30–60 seconds while it wakes. To avoid that:

1. Create a free UptimeRobot account. **New monitor → HTTP(s)**.
2. URL: `https://<your-render-address>/health/live`, interval **5 minutes**, keep your email as an alert contact.

Ping **`/health/live`, not `/health/ready`.** `/health/ready` queries the database every time, which keeps Neon awake around the clock and uses up its free compute hours. Running one Render service all month uses about 744 of the 750 free hours, so keep it the only free Render service.

## 9. Check the live site

1. Open the website, sign in, and connect GitHub (you are sent to GitHub to authorise the app, then back to **Repositories**).
2. Sync a small repository and wait for **Synced**.
3. Ask a question in Chat, then open Why-Lens and Insights.

| Symptom | Fix |
|---|---|
| "unauthorized domain" on sign-in | add the website domain in Firebase (step 7) |
| GitHub: "redirect_uri is not associated" | the GitHub App callback must exactly match `GITHUB_OAUTH_REDIRECT_URI` |
| "did not return an access token" | wrong `GITHUB_CLIENT_SECRET`; generate a new one |
| no repositories listed | install the GitHub App on them (step 6.7) |
| "Can't reach KAVI right now" | the API is waking up or redeploying; wait a minute |
| browser requests blocked (CORS) | `FRONTEND_URL` must equal the website origin exactly, with no trailing slash |

## Things learned during the first deploy

- **CI and Render install the newest Python packages on Python 3.11.** A local Python 3.10 environment gets older versions (for example SQLAlchemy 2.0 instead of 2.1). When you change backend dependencies, test against a fresh install of the latest versions.
- **SQLAlchemy 2.1 defaults plain `postgresql://` URLs to psycopg 3.** `backend/app/core/database.py` pins the bundled psycopg2 driver, so Neon's URL works as copied.
- **Vercel's npm does not install optional peer packages.** The frontend relies only on Vite's built-in CSS minifier.
- **The repository is private, so GitHub Actions minutes are limited.** Syncs run inside the API (`INLINE_SYNC_WORKER=true`), and `.github/workflows/ingestion-worker.yml` is manual only (Actions tab → **Ingestion worker (manual)** → **Run workflow**). It needs `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY` and `AI_API_KEY` as repository secrets if you ever use it.

## Rolling back

- **API:** Render → **Events** → previous deploy → **Rollback**.
- **Website:** Vercel → **Deployments** → previous deployment → **⋯ → Promote to Production**.
- **Database:** before any schema change, create a Neon branch (an instant copy) as a restore point.
