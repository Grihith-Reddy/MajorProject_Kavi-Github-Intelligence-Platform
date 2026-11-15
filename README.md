<div align="center">

```
██╗  ██╗ █████╗ ██╗   ██╗██╗
██║ ██╔╝██╔══██╗██║   ██║██║
█████╔╝ ███████║██║   ██║██║
██╔═██╗ ██╔══██║╚██╗ ██╔╝██║
██║  ██╗██║  ██║ ╚████╔╝ ██║
╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝
```

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
![Status](https://img.shields.io/badge/status-active-22c55e?style=flat-square)

</div>

---

## What is KAVI?

> *Six months ago your team made a critical architecture decision. It's buried in a PR description nobody remembers writing. KAVI finds it in 12ms.*

KAVI ingests GitHub pull requests, uses AI to summarize engineering intent, and stores the results in a searchable PostgreSQL knowledge base. Chat retrieves repository and conversation context and uses AI to answer questions; code-specific answers can fetch current file contents from GitHub. Answers are grounded in available evidence, but can still be incomplete when relevant repository data is unavailable.

---

## What's new in KAVI 2.0

| Feature | What it does |
|---|---|
| **Agentic, streaming chat** | Gemini function-calling over KAVI's own tools (memory search, PRs, live code, blame, experts, promises). Answers stream with a visible reasoning trace and cite `[PR #12]` / `path:10-24` as clickable chips. |
| **Hybrid semantic memory** | Free Gemini embeddings fused with PostgreSQL full-text and keyword search (Reciprocal Rank Fusion). Works without pgvector; falls back to a local embedder offline. |
| **Why-Lens** | Every line of a file mapped through GitHub blame to the PR that introduced it and the intent KAVI recorded. |
| **Guardian** | A GitHub Action that reviews new PRs against remembered decisions and comments when a change contradicts one. KAVI's GitHub App stays read-only. |
| **Promise Tracker** | Finds commitments in reviews ("follow-up", "temporary hack", TODOs) and detects when a later PR keeps them. |
| **Knowledge map** | Context ownership per module, bus factor, at-risk modules and co-change coupling. |
| **Quality harness** | Measures retrieval with AI-written questions: Recall@k and MRR for every strategy. |
| **MCP server** | Lets Claude Code, Cursor and other MCP clients ask KAVI why code exists. |
| **Incremental sync** | Only new or updated PRs are analysed; live progress in the UI. |

Everything runs on free tiers (Gemini API free tier, Neon, Render, Vercel, GitHub Actions). See [`docs/kavi-2.0.md`](docs/kavi-2.0.md) for how each feature works.

---

## How data flows

```
GitHub PRs  ──→  Ingestion Worker  ──→  AI Summarizer
                                              │
                                              ↓
React Frontend  ←──  FastAPI  ←──  PostgreSQL (knowledge store)
```

> Ingestion is queued for background processing. Chat retrieves indexed context and may call the AI provider, so its response time depends on database, GitHub, and AI-provider availability.

---

## Core Principles

| # | Principle | What it means |
|---|-----------|---------------|
| 1 | **PRs are the unit of intent** | Not commits, not files — the PR is where decisions live |
| 2 | **AI for summaries and answers** | PR summaries are stored; chat can use AI with retrieved repository evidence |
| 3 | **Evidence-grounded retrieval** | Answers use indexed PR data and selected live repository context; missing evidence is surfaced rather than invented where supported |
| 4 | **Repo-scoped access control** | Knowledge is gated to the GitHub account that ingested it |
| 5 | **Durable sync jobs** | Worker-driven ingestion survives restarts |

---

## Monorepo Structure

```
kavi/
├── frontend/          # React · TypeScript · Firebase auth
│   ├── src/
│   └── .env.example
├── backend/           # FastAPI · Python 3.11 · Uvicorn
│   ├── app/
│   │   └── workers/
│   │       └── ingestion_worker.py
│   ├── requirements.txt
│   └── .env.example
├── database/          # PostgreSQL schemas + migrations
│   ├── schema.sql
│   └── migrations/
│       └── 005_kavi_intelligence.sql
├── mcp/               # MCP server for editor agents (optional)
├── docs/
└── README.md
```

---

## Prerequisites

- **Node.js** 20.19+ or 22.12+
- **Python** 3.11+
- **PostgreSQL** 14+

---

## Setup

### 1 — Database

Create a database named `kavi`, then apply the versioned migrations in order:

```sql
\i database/migrations/001_init.sql
\i database/migrations/002_access_control_and_sync_jobs.sql
\i database/migrations/003_chat_memory.sql
\i database/migrations/004_github_oauth_states.sql
\i database/migrations/005_kavi_intelligence.sql
```

`database/schema.sql` is the consolidated schema for fresh bootstrap environments. Do not apply it in addition to the versioned migrations on an existing database.

---

### 2 — Backend

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

Copy the env template and generate a Fernet key:

```bash
cp .env.example .env
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# paste the output into .env as TOKEN_ENCRYPTION_KEY
```

Start the API:

```bash
uvicorn app.main:app --reload --port 8000
```

Syncs start immediately inside the API process (`INLINE_SYNC_WORKER=true`, the default). A standalone worker is still supported and safely shares the queue:

```bash
python -m app.workers.ingestion_worker
```

---

### 3 — Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

---

## Documentation

| Doc | What's inside |
|-----|---------------|
| [`docs/architecture.md`](docs/architecture.md) | System design, data model, component boundaries |
| [`docs/api-contracts.md`](docs/api-contracts.md) | All REST endpoints with request/response shapes |
| [`docs/workflows.md`](docs/workflows.md) | Ingestion flow, sync jobs, chat query lifecycle |
| [`docs/kavi-2.0.md`](docs/kavi-2.0.md) | KAVI 2.0 features, algorithms, Guardian and MCP setup, evaluation method |
| [`docs/deployment.md`](docs/deployment.md) | Free hobby/demo deployment guide (Render + Neon + Vercel + scheduled GitHub Actions worker) |
| [`docs/public-launch.md`](docs/public-launch.md) | Launch checklist and go-to-market notes |

---

<div align="center">

*Knowledge lives in your pull requests. KAVI just remembers it.*

</div>
