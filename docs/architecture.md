# KAVI Architecture

## Overview
KAVI is a Developer Experience platform that captures the intent behind code changes. It ingests pull requests from GitHub, distills the WHY into structured knowledge entries, and serves evidence-grounded answers with persistent multi-turn memory.

## System Components
- Frontend (React + Vite + Tailwind): GitHub-inspired UI with repository management, chat, file detail views, and timelines.
- Backend (FastAPI): JWT-protected REST APIs for auth verification, GitHub App user authorization, ingestion, knowledge queries, and chat.
- Database (PostgreSQL): Relational store for users, GitHub accounts, repositories, pull requests, commits, knowledge entries, file mappings, and chat memory (conversations/messages/memory items).
- AI Summarization + Chat Reasoning (Gemini): Summarizes PR intent during ingestion and generates structured chat answers grounded in repository + memory context.

## Data Flow
1. User authenticates via Firebase Authentication and receives an ID token.
2. Frontend sends the Firebase token on every API request.
3. User authorizes the GitHub App with PKCE and read-only repository permissions. The one-time state and encrypted PKCE verifier are stored server-side; the returned token is encrypted at rest.
4. Repository sync ingests PRs, commits, and discussions.
5. AI summarizes each PR once and stores the structured output.
6. Chat queries combine repository retrieval, conversation history, and long-term memory, then return grounded answers with references.

## Ingestion Pipeline
- Pull Requests are the primary unit of intent.
- Commits, comments, and reviews are grouped under each PR.
- For each PR, KAVI:
  - Fetches metadata and discussions.
  - Generates a summary using Gemini (single call per PR).
  - Stores knowledge entries and file mappings.
- File mappings store approximate line ranges derived from diff hunks (no full code).

## Security Model
- Token validation uses Firebase Admin SDK.
- GitHub tokens are encrypted at rest using Fernet.
- Repository knowledge remains repo-scoped; chat memory is user-scoped per repository/conversation.
- Real-time chat includes AI generation, but repository claims are constrained to retrieved evidence.

## Scalability & Extensibility
- Modular services allow expansion to IDE plugins, private repos, and knowledge graphs.
- Ingestion can be moved to background workers without changing API contracts.
- Full-text search can evolve into vector search or hybrid retrieval.
