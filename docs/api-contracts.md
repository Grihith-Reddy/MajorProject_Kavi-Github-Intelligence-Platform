# KAVI API Contracts

Base URL: `/api`

## Auth
### GET `/auth/verify`
Validates Firebase ID token and upserts user.
- Auth: `Authorization: Bearer <token>`
- Response:
```json
{ "status": "ok", "user": { "id": "uuid", "auth0_sub": "firebase-uid", "email": "..." } }
```

### GET `/auth/me`
Returns the current user.
- Auth: Required

## GitHub App authorization
### GET `/github/status`
Returns whether the authenticated user has connected GitHub.
- Auth: Required
- Response:
```json
{ "connected": true, "account": { "id": "uuid", "username": "octocat", "updated_at": "..." } }
```
or
```json
{ "connected": false, "account": null, "reauthorization_required": false }
```
Legacy OAuth connections return:
```json
{ "connected": false, "account": null, "reauthorization_required": true }
```

### GET `/github/connect-url`
Returns the GitHub App user-authorization URL. The callback uses one-time state and PKCE.
- Auth: Required
- Response:
```json
{ "url": "https://github.com/login/oauth/authorize?..." }
```

### GET `/github/callback`
GitHub App user-authorization callback handler.
- Query: `code`, `state`, `redirect` (optional, default true)
- Response: Redirects to frontend `/repositories` when `redirect=true`.
- JSON Response (when `redirect=false`):
```json
{ "status": "connected", "github_account_id": "uuid" }
```

### GET `/github/repositories`
Lists accessible repositories with sync status.
- Auth: Required
- Response:
```json
{ "repositories": [ { "id": 1, "full_name": "org/repo", "synced_at": "..." } ] }
```

## Ingestion
### POST `/ingestion/repositories/sync`
Triggers repository ingestion.
- Auth: Required
- Query: `wait=true|false`
- Body:
```json
{ "repo_full_name": "org/repo" }
```
- Response (wait=true):
```json
{ "status": "completed", "repo_id": "uuid", "synced_prs": 12, "errors": [] }
```

### GET `/ingestion/repositories/{repo_id}/status`
Returns sync metadata for a repository.

## Knowledge
### GET `/knowledge/repositories/{repo_id}/entries`
Lists knowledge entries for a repository.

### GET `/knowledge/entries/{entry_id}`
Returns a single knowledge entry and file mappings.

### GET `/knowledge/repositories/{repo_id}/timeline`
Returns PR timeline data.

### GET `/knowledge/repositories/{repo_id}/files`
Lists distinct files tracked in knowledge entries.

### GET `/knowledge/files`
Query params: `repo_id`, `path`.
Returns file detail and related PRs.

## Chat
### POST `/chat/query`
Searches knowledge entries and returns grounded response.
- Body:
```json
{
  "repo_id": "uuid",
  "query": "Why does auth middleware exist?",
  "limit": 5,
  "mode": "default",
  "conversation_id": "optional-conversation-uuid"
}
```
- Response:
```json
{
  "answer": "...",
  "answer_structured": {},
  "sources": [ { "entry_id": "...", "files": [] } ],
  "conversation_id": "uuid",
  "conversation": {
    "id": "uuid",
    "repo_id": "uuid",
    "title": "Conversation title",
    "status": "active",
    "message_count": 42,
    "last_message_at": "2026-04-27T10:18:00Z"
  },
  "memory_applied": true
}
```

### GET `/chat/conversations?repo_id={repo_id}`
Lists persisted chat conversations for the authenticated user and repository.

### GET `/chat/conversations/{conversation_id}`
Returns conversation metadata and ordered messages.

## KAVI 2.0 endpoints

All endpoints below require a Firebase bearer token unless noted.

### Ingestion
- `POST /ingestion/repositories/sync` body now accepts `full_resync` (default `false`). With `wait=false` the response includes `job_id` and the job starts immediately.
- `GET /ingestion/jobs/{job_id}`: job status with `progress` (`phase`, `processed`, `total`, `current_pr`, `current_title`) and `result_summary`.

### Chat
- `POST /chat/stream`: same body as `/chat/query`; responds with Server-Sent Events `meta`, `step`, `note`, `token`, `legacy`, `done`, `error`.

### Insights
- `GET /insights/repositories/{repo_id}/tree`: live file list of the default branch.
- `GET /insights/repositories/{repo_id}/why?path=`: Why-Lens blame segments, PR intent and file content.
- `GET /insights/repositories/{repo_id}/promises` and `POST /insights/promises/{id}/status` (`open|kept|dismissed`).
- `GET /insights/repositories/{repo_id}/knowledge-map`: modules, bus factor, risk, coupling edges.
- `POST /insights/repositories/{repo_id}/quality/run` and `GET /insights/repositories/{repo_id}/quality`: evaluation runs.
- `GET /insights/tokens`, `POST /insights/tokens` (`scope: guardian|mcp`, `repo_id` for guardian), `POST /insights/tokens/{id}/revoke`.

### Guardian
- `POST /guardian/review` (**Guardian token**): `{pr_number, head_sha, title, body, files: [{filename, status, patch}]}` → `{verdict, summary, findings, history_checked, comment_markdown}`.
- `GET /guardian/repositories/{repo_id}/reviews`: review history.
- `GET /guardian/workflow`: the GitHub Actions workflow file.

### MCP (**editor token**)
- `GET /mcp/repositories`, `POST /mcp/ask`, `GET /mcp/why`, `GET /mcp/search`, `GET /mcp/experts`, `GET /mcp/promises`, `GET /mcp/pull-request`. `repo` accepts a UUID or `owner/name`.
