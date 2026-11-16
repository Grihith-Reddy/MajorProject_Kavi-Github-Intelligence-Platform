# Local environment setup

This guide fills in the two `.env` files KAVI needs for local development:

- **Frontend** (`frontend/.env`): `VITE_API_BASE_URL` and the `VITE_FIREBASE_*` values.
- **Backend** (`backend/.env`): database, Firebase service account, GitHub App, secrets and AI key.

Every service used here has a free tier. Never commit either `.env` file or any service-account JSON.

## 1. Create the Firebase web app

1. Open the Firebase Console, choose your project, then **Project settings**.
2. Under **Your apps**, create (or reuse) a **Web** app.
3. Copy its config into `frontend/.env`:

   | Firebase field | Frontend variable |
   |---|---|
   | `apiKey` | `VITE_FIREBASE_API_KEY` |
   | `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN` |
   | `projectId` | `VITE_FIREBASE_PROJECT_ID` |
   | `appId` | `VITE_FIREBASE_APP_ID` |
   | `messagingSenderId` | `VITE_FIREBASE_MESSAGING_SENDER_ID` |

4. In **Authentication → Sign-in method**, enable **Google**, and **Email/Password** if you want email sign-in on the login page.

## 2. Create the Firebase service account (backend)

1. **Project settings → Service accounts → Generate new private key**.
2. Save the JSON outside version control, for example `backend/secrets/firebase-service-account.json` (the `secrets/` folder is git-ignored).
3. In `backend/.env`:

   ```env
   FIREBASE_PROJECT_ID=<your_project_id>
   FIREBASE_CREDENTIALS_PATH=./secrets/firebase-service-account.json
   ```

Alternatives: put the whole JSON on one line in `FIREBASE_CREDENTIALS_JSON`, or set `GOOGLE_APPLICATION_CREDENTIALS` outside the app.

## 3. Create a least-privilege GitHub App

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**. Allow installation on any account if other people will connect their own repositories.
2. URLs:
   - Homepage URL: `http://localhost:5173`
   - User authorization callback URL: `http://localhost:8000/api/github/callback`
3. Repository permissions, all **Read-only**:
   - **Contents**: repository trees and files
   - **Pull requests**: pull requests, commits, reviews and changed files
   - **Issues**: pull-request conversation comments

   Metadata is granted automatically. Do not grant write or administration permissions.
4. Keep **expiring user authorization tokens** disabled.
5. Copy the **Client ID** and a new **Client secret** into `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

## 4. Generate secrets

```bash
# GITHUB_STATE_SECRET
python -c "import secrets; print(secrets.token_urlsafe(48))"

# TOKEN_ENCRYPTION_KEY
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Get a free Gemini API key from Google AI Studio for `AI_API_KEY`.

## 5. Backend `.env`

Start from `backend/.env.example`. The values that matter for local work:

```env
ENV=development
DATABASE_URL=postgresql+psycopg2://postgres:kavi@localhost:5432/kavi
FRONTEND_URL=http://localhost:5173

FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CREDENTIALS_PATH=./secrets/firebase-service-account.json

GITHUB_CLIENT_ID=your_github_app_client_id
GITHUB_CLIENT_SECRET=your_github_app_client_secret
GITHUB_OAUTH_REDIRECT_URI=http://localhost:8000/api/github/callback
GITHUB_STATE_SECRET=your_generated_random_secret

TOKEN_ENCRYPTION_KEY=your_generated_fernet_key

AI_PROVIDER=gemini
AI_MODEL=gemini-2.5-flash
AI_API_KEY=your_gemini_key
```

Optional tuning (defaults are in `.env.example`):

| Variable | Purpose |
|---|---|
| `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | Semantic memory embeddings; a local embedder is used without an AI key |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | General per-user request limit |
| `RATE_LIMIT_EXPENSIVE_PER_MINUTE` | Limit for AI-heavy routes such as chat and quality runs |
| `MAX_REQUEST_BODY_BYTES` | Largest accepted request body |
| `INLINE_SYNC_WORKER` | Run queued syncs inside the API process (default `true`) |
| `DB_POOL_*`, `OUTBOUND_*`, `SYNC_*` | Connection pool, retry and worker timing |

## 6. Frontend `.env`

```env
VITE_API_BASE_URL=http://localhost:8000/api
VITE_FIREBASE_API_KEY=your_firebase_web_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=your_firebase_app_id
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
```

## 7. Run it

1. Apply the database migrations (see the README).
2. Start the backend:

   ```bash
   cd backend
   .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
   ```

3. Start the frontend:

   ```bash
   cd frontend
   npm run dev
   ```

4. Open http://localhost:5173, sign in, then connect GitHub.

## Troubleshooting

| Symptom | Cause |
|---|---|
| 401 "Missing bearer token" | The request was sent without a Firebase ID token; sign in again. |
| 503 "Firebase authentication is not configured" | The backend's Firebase service-account variables are missing or invalid. |
| "Can't reach KAVI right now" banner | The API is not running, or `VITE_API_BASE_URL` points to the wrong address. |
| Login popup blocked | Allow popups for `localhost` in the browser. |
| `/health/ready` returns 503 | The database is down or a migration (up to 006) has not been applied. |
