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

**A Developer Experience platform that ingests GitHub pull requests,  
extracts engineering intent, and serves it back as a searchable knowledge base.**

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
│       └── 004_github_oauth_states.sql
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

Start the API and the ingestion worker in **two separate terminals**:

```bash
# terminal 1
uvicorn app.main:app --reload --port 8000

# terminal 2
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
| [`docs/deployment.md`](docs/deployment.md) | Free hobby/demo deployment guide (Render + Neon + Vercel + scheduled GitHub Actions worker) |
| [`docs/public-launch.md`](docs/public-launch.md) | Launch checklist and go-to-market notes |

---

<div align="center">

*Knowledge lives in your pull requests. KAVI just remembers it.*

</div>
