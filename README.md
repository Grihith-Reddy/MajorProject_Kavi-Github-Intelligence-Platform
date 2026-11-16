<div align="center">

<img src="frontend/public/favicon.svg" width="72" height="72" alt="KAVI logo" />

### KAVI remembers *why* your code exists.

**An engineering memory for GitHub repositories: it remembers why code exists,  
explains it line by line, warns when a change contradicts a past decision,  
and keeps track of the promises made in code review.**

<br/>

![Node](https://img.shields.io/badge/Node.js-20.19%2B%20%7C%2022.12%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688?style=flat-square&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-frontend-61DAFB?style=flat-square&logo=react&logoColor=black)
![Cost](https://img.shields.io/badge/cost-free%20tiers%20only-22c55e?style=flat-square)

</div>

---

## What is KAVI?

> *Six months ago your team made a critical architecture decision. It's buried in a PR description nobody remembers writing. KAVI finds it.*

KAVI reads a repository's pull requests, asks AI to summarize the intent behind each one, and keeps the results in a searchable PostgreSQL memory. You can then ask questions in chat, open any file to see which PR shaped each line, and get warned when a new PR contradicts an earlier decision.

Answers are grounded in the evidence KAVI has indexed. When the evidence is missing, KAVI says so instead of guessing.

---

## Features

| Feature | What it does |
|---|---|
| **Agentic, streaming chat** | Gemini function-calling over KAVI's own tools (memory search, PRs, live code, blame, experts, promises). Answers stream with a visible reasoning trace and cite `[PR #12]` / `path:10-24` as clickable chips. Rate answers with thumbs up/down. |
| **Hybrid semantic memory** | Free Gemini embeddings fused with PostgreSQL full-text and keyword search (Reciprocal Rank Fusion). Works without pgvector; falls back to a local embedder offline. |
| **Why-Lens** | Every line of a file mapped through GitHub blame to the PR that introduced it, with a file-history slider to step back in time. |
| **Guardian** | A GitHub Action that reviews new PRs against remembered decisions, estimates change impact and suggests reviewers. KAVI's GitHub App stays read-only. |
| **Promise Tracker** | Finds commitments in reviews ("follow-up", "temporary hack", TODOs) and detects when a later PR keeps them. |
| **Knowledge map** | Context ownership per module, bus factor, at-risk modules and co-change coupling. |
| **Quality harness** | Measures retrieval with AI-written questions: Recall@k and MRR for every strategy. |
| **MCP server** | Lets Claude Code, Cursor and other MCP clients ask KAVI why code exists. |
| **Incremental sync** | Only new or updated PRs are analysed, with live progress in the UI. |

Everything runs on free tiers (Gemini API free tier, Neon, Render, Vercel, GitHub Actions). See [`docs/kavi-2.0.md`](docs/kavi-2.0.md) for how each feature works.

### Interface

- **Light and dark themes** that follow the device by default; switch them from the header or Settings.
- **Animated landing page**: a WebGL cloudscape with a parallax hill, a scroll-assembled "Remember why" section and a tear-away footer. All motion respects *reduce motion*.
- **Phone layout**: a compact bottom dock, a header menu for everything else, and a full-width chat composer.
- **Error handling**: a friendly crash page with *Try again*, a "Lost in the clouds" 404 page, an offline bar, and plain-language error messages. Server errors carry a short reference id instead of internal details.

---

## How data flows

```
GitHub PRs  ──→  Ingestion worker  ──→  AI summarizer + embeddings
                                              │
                                              ↓
React frontend  ←──  FastAPI  ←──  PostgreSQL (knowledge store)
                        ↑
          Guardian Action · MCP clients (token auth)
```

Syncs are queued and processed in the background. Chat retrieves indexed context and may call the AI provider, so response time depends on the database, GitHub and the AI provider.

---

## Core principles

| # | Principle | What it means |
|---|-----------|---------------|
| 1 | **PRs are the unit of intent** | Not commits, not files: the PR is where decisions live |
| 2 | **Evidence-grounded answers** | Answers use indexed PR data and live repository context; missing evidence is surfaced, not invented |
| 3 | **Read-only on GitHub** | The GitHub App only reads Contents, Pull requests and Issues |
| 4 | **Repo-scoped access control** | Knowledge is visible only to accounts that can access the repository |
| 5 | **Durable sync jobs** | Worker-driven ingestion survives restarts |

---

## Repository layout

```
kavi/
├── frontend/              React 18 · TypeScript · Vite · Firebase auth
│   └── src/
│       ├── app/           routes and the error boundary
│       ├── components/    shared UI (nav, dock, status pages, logo)
│       ├── features/      chat, insights, landing, theme, integrations…
│       ├── pages/         one file per route
│       ├── services/      API client and network events
│       └── styles/        design tokens (kavi-system.css)
├── backend/               FastAPI · Python 3.11
│   ├── app/
│   │   ├── api/           REST routers
│   │   ├── core/          settings, security, middleware
│   │   ├── services/      GitHub, AI, retrieval, Guardian…
│   │   └── workers/       ingestion worker
│   └── tests/
├── database/
│   ├── schema.sql         consolidated schema for a brand-new database
│   └── migrations/        001–006, each with a _down script
├── mcp/                   MCP server for editor agents (optional)
├── design/                logo and landing-art sources
├── docs/                  architecture, API, deployment, setup guides
└── render.yaml            Render blueprint for the API
```

---

## Getting started

You need **Node.js** 20.19+ or 22.12+, **Python** 3.11+ and **PostgreSQL** 14+. Firebase and GitHub App setup is walked through in [`docs/environment-setup.md`](docs/environment-setup.md).

### 1. Database

Create a database named `kavi`, then apply the migrations in order:

```bash
psql -v ON_ERROR_STOP=1 -d kavi \
  -f database/migrations/001_init.sql \
  -f database/migrations/002_access_control_and_sync_jobs.sql \
  -f database/migrations/003_chat_memory.sql \
  -f database/migrations/004_github_oauth_states.sql \
  -f database/migrations/005_kavi_intelligence.sql \
  -f database/migrations/006_impact_and_feedback.sql
```

For a brand-new database you can run `database/schema.sql` once instead. Never apply both to the same database.

### 2. Backend

```bash
cd backend
python -m venv .venv
. .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# paste the output into .env as TOKEN_ENCRYPTION_KEY
uvicorn app.main:app --reload --port 8000
```

Syncs start inside the API process (`INLINE_SYNC_WORKER=true`, the default). A standalone worker can share the queue safely:

```bash
python -m app.workers.ingestion_worker
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:5173.

### 4. Checks

```bash
cd frontend && npm run lint && npm run build
```

```bash
cd backend && python -m pytest -q
```

Database integration tests run when `TEST_DATABASE_URL` points to a database whose name ends in `_test`.

---

## Security

- Firebase ID tokens on every API call; Guardian and MCP use separate, revocable, hashed personal tokens.
- GitHub tokens are encrypted at rest (Fernet). The GitHub App is read-only and uses PKCE.
- Per-user rate limits (stricter for AI-heavy routes), request size limits, strict security headers and CSP.
- Unexpected server errors are logged with a request id and returned as a generic message, never as internal text.
- Repository ids from the address bar are validated before they reach an API path; login redirects only go to same-site paths.

Found a vulnerability? Please open a private security advisory on GitHub rather than a public issue.

---

## Working together

1. Pull the latest work: `git pull`.
2. Create a branch for each change: `git switch -c feature/short-name`.
3. Run the checks above before pushing.
4. Push the branch and open a pull request into `main`. Merging into `main` deploys the API to Render, so review before merging.

Never commit `.env` files, service-account JSON or tokens.

---

## Documentation

| Doc | What's inside |
|-----|---------------|
| [`docs/environment-setup.md`](docs/environment-setup.md) | Firebase, GitHub App and `.env` setup for local development |
| [`docs/architecture.md`](docs/architecture.md) | System design, data model, component boundaries |
| [`docs/api-contracts.md`](docs/api-contracts.md) | REST endpoints with request and response shapes |
| [`docs/workflows.md`](docs/workflows.md) | Ingestion flow, sync jobs, chat query lifecycle |
| [`docs/kavi-2.0.md`](docs/kavi-2.0.md) | KAVI 2.0 features, algorithms, Guardian and MCP setup, evaluation |
| [`docs/deployment.md`](docs/deployment.md) | Free deployment guide (Render + Neon + Vercel + scheduled GitHub Actions worker) |
| [`docs/public-launch.md`](docs/public-launch.md) | Launch checklist and operations runbook |

---

<div align="center">

*Knowledge lives in your pull requests. KAVI just remembers it.*

</div>
