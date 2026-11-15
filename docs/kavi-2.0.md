# KAVI 2.0

KAVI 1.0 turned pull requests into a searchable knowledge base. KAVI 2.0 turns that knowledge base into an **active teammate**: it explains code line by line, warns when a change contradicts a past decision, tracks promises made in review, shows who holds the context for each part of the codebase, and measures how reliably it finds the right evidence.

Everything uses free services (Gemini API free tier, Neon, Render, Vercel, GitHub Actions). No model is trained.

```
              ┌───────────────────────── GitHub ─────────────────────────┐
              │  REST: PRs, commits, reviews, files     GraphQL: blame     │
              └───────────────┬───────────────────────────────┬──────────┘
                              │ incremental sync              │ Why-Lens
                              ▼                               ▼
  Guardian Action ──► FastAPI ── ingestion ──► PostgreSQL ◄── agent tools ◄── /chat/stream (SSE)
  (in user repo)        │        • Gemini summary           • knowledge + REAL[] embeddings
                        │        • participants             • promises, participants
  MCP server ──────────►│        • promises                 • guardian reviews, eval runs
  (editor agents)       │        • embeddings (Gemini)
                        └──► Gemini: summaries, embeddings, function calling, judgements
```

---

## 1. Incremental sync with live progress

**Before:** every sync re-listed every PR and fetched five resources per PR; the UI blocked on one long HTTP request.

**Now:**
- PRs are listed newest-updated first (`sort=updated&direction=desc`) and listing stops at the repository's cursor (`repositories.last_pr_updated_at`). A resync of an unchanged repository costs one request.
- PRs whose `updated_at` matches the stored row and that already have a knowledge entry are skipped before any sub-resource is fetched.
- If a PR fails, the cursor stops just before the oldest failure so the next sync retries it.
- Jobs run in the API process immediately (`INLINE_SYNC_WORKER`); the standalone worker and the GitHub Actions cron still work, and `FOR UPDATE SKIP LOCKED` prevents double processing.
- Progress (`phase`, `processed/total`, current PR) is written to `sync_jobs.progress` through a separate session and polled by the UI.

## 2. Hybrid semantic memory

- **Embeddings:** `gemini-embedding-001` (768 dimensions, free tier) via `batchEmbedContents`. Without an API key, a deterministic **feature-hashing embedder** (unigrams, bigrams, prefixes, camelCase splitting, signed hashing into 512 dimensions) keeps semantic search working offline.
- **Storage:** `REAL[]` columns with the producing model recorded. No pgvector is needed, so it runs on any PostgreSQL, including CI's stock image. Vectors are L2-normalised, so cosine similarity is a dot product. Per-repository vectors are cached for two minutes; query embeddings are memoised.
- **Fusion:** full-text (`ts_rank`), keyword/path matching and semantic rankings are combined with **Reciprocal Rank Fusion**, `score(d) = Σ 1 / (60 + rank_i(d))`. Weak semantic matches (cosine < 0.35) are dropped first. Explicit file-path questions give the keyword ranking a double vote.
- **Safety:** if migration 005 is missing or embeddings are unavailable, retrieval silently falls back to the 1.0 behaviour.

## 3. Agentic, streaming chat

`POST /api/chat/stream` (Server-Sent Events) runs a Gemini **function-calling** loop (at most six tool rounds) over KAVI's own tools:

| Tool | Purpose |
|---|---|
| `search_memory` | Hybrid retrieval over PR knowledge |
| `get_pull_request` | Intent, decisions, risks, files, people and dates for one PR |
| `read_file` / `find_files` | Live code from the default branch |
| `why_lines` | Why-Lens for a line range |
| `who_knows` | Expert finder from authors, reviewers and commenters |
| `repo_overview` | Statistics, contributors, hot files, technologies |
| `list_promises` | Promise ledger |

Events: `meta`, `step` (tool start/finish, shown as the reasoning trace), `note` (text spoken before a tool call), `token`, `done` (sources, trace), `error`, and `legacy` when the agent cannot start and the original `/chat/query` pipeline answers instead. Gemini thought signatures are passed back verbatim between rounds. Tool errors are reported to the model without internal details. Turns are persisted to the existing conversation tables, and the History panel reads them back.

## 4. Why-Lens

`GET /api/insights/repositories/{id}/why?path=` uses GitHub GraphQL `Commit.blame` to get line ranges → commit → first associated PR, merges adjacent ranges from the same PR, and joins the intent, decisions and risks KAVI recorded. Results are cached for 20 minutes in `blame_cache`. The UI bands the gutter by PR, shows a "who shaped this file" composition bar, and offers **Ask KAVI about these lines**, which hands the question to chat.

## 5. Guardian

A GitHub Action in the user's repository sends the PR title, description and patches to `POST /api/guardian/review` with a **repo-scoped Guardian token**. KAVI then:

1. gathers history: past PRs that touched the same files plus semantically related decisions (cosine ≥ 0.55), excluding the PR itself;
2. finds open promises the PR might keep;
3. asks Gemini for a JSON verdict (`clear | heads_up | conflict`) with findings. **Citations to PRs not in the gathered history are discarded**, and conflicts below 0.7 confidence are downgraded to heads-ups;
4. renders a Markdown comment (with a hidden marker so reruns update the same comment) and stores it in `guardian_reviews`.

Without Gemini it still posts the relevant history. The Action posts with its own `GITHUB_TOKEN`, so **KAVI's GitHub App never needs write access**, and it retries for about 2.5 minutes while free hosting wakes up.

**Setup:** Settings → Integrations → Guardian: create a token, add it as the `KAVI_GUARDIAN_TOKEN` secret, add a `KAVI_API_URL` variable, and commit the generated `.github/workflows/kavi-guardian.yml`.

## 6. Promise Tracker

- **Extraction (per PR):** a phrase filter finds sentences such as "follow-up", "temporary", "workaround", "TODO", "tech debt" or "I'll fix", ignoring quoted replies, code blocks and bots. Gemini confirms which are real commitments and writes an imperative summary; offline, filtered sentences are kept with a heuristic kind.
- **Resolution (per repository, after sync):** open promises are embedded and compared with PRs merged *after* the promise; a match above the threshold (0.74 Gemini / 0.42 local) is verified by Gemini and marked **kept**, citing the PR.
- Ledger statistics: open, kept, dismissed, oldest open, typical days to keep. Users can mark promises kept, dismissed or open.

## 7. Knowledge map and bus factor

- **Modules:** directories two levels deep, built from file mappings.
- **Context ownership:** author 3, reviewer 2, commenter 1 per PR touching the module.
- **Bus factor:** the smallest number of people covering more than half of a module's weight.
- **Risk:** `single_expert` when the bus factor is 1; `at_risk` when that person has been inactive for 90+ days, measured against the repository's own last activity so archived projects are not all flagged.
- **Co-change coupling:** `shared PRs / min(PRs per module)`; strong pairs are drawn as edges.

The UI renders a dependency-free force-directed layout.

## 8. Quality harness (evaluation)

`POST /api/insights/repositories/{id}/quality/run` builds a test set from the repository: for up to 30 sampled PRs (fixed seed), Gemini writes a newcomer-style question whose answer is in that PR, **paraphrased so it does not reuse title words**. Each question runs through `fulltext`, `lexical`, `semantic` and `hybrid` retrieval and is scored by the rank of the gold PR:

- **Recall@k** (k = 1, 3, 5): the share of questions whose gold PR appears in the top k.
- **MRR**: the mean of 1/rank (0 if not retrieved).

Without Gemini, template questions derived from the recorded intent are used and labelled as such (an easier test). Results are stored in `eval_runs` and shown on Insights → Quality. This is the basis for reporting retrieval improvements.

## 9. MCP server

`mcp/kavi_mcp.py` exposes `ask_kavi`, `why_does_this_exist`, `search_decisions`, `get_pull_request`, `who_knows`, `open_promises` and `list_repositories` to any MCP client. It is compatible with MCP Python SDK 1.x and 2.x.

```bash
pip install -r mcp/requirements.txt
claude mcp add kavi -e KAVI_API_URL=https://your-api -e KAVI_TOKEN=kavi_mcp_... -- python path/to/kavi/mcp/kavi_mcp.py
```

Create the editor token in Settings → Integrations. `KAVI_REPO=owner/name` sets a default repository.

## 10. Tokens and security

- Personal tokens (`kavi_gd_…`, `kavi_mcp_…`) are shown once and stored as SHA-256 hashes. Guardian tokens are bound to one repository, and every request re-checks that the owner still has access.
- Tokens are revocable and track their last use.
- The GitHub App remains read-only (Contents, Pull requests, Issues).

## Database

`database/migrations/005_kavi_intelligence.sql` is additive: `pr_participants`, `pr_promises`, `blame_cache`, `kavi_tokens`, `guardian_reviews`, `eval_runs`, plus `knowledge_entries.embedding`, `embedding_model`, `repositories.last_pr_updated_at` and `sync_jobs.progress` / `full_resync`. A down migration is provided.

## Tests

`backend/tests` covers incremental listing, embeddings and fusion, the agent loop (with mocked Gemini streams, including thought signatures), Why-Lens segment merging, promise extraction, bus factor, and PostgreSQL integration tests (run when `TEST_DATABASE_URL` points to a `*_test` database, as in CI) for tokens, Guardian, MCP endpoints, promise resolution, the knowledge map and the evaluation harness.

## Suggested demo flow

1. Sync a repository and watch the live progress capsule; resync to show that it is incremental.
2. Ask in chat: *"Why do we retry webhooks, and who knows the most about it?"* Show the reasoning trace and the citation chips.
3. Click a file chip to open **Why-Lens**, select a block of lines, then use *Ask KAVI about these lines*.
4. Open a PR that reverts a past decision in a repository with Guardian installed, and show the comment.
5. **Insights → Promises** (a kept promise with its PR), **Knowledge map** (an at-risk module), **Quality** (hybrid vs full-text).
6. In Claude Code, ask `why_does_this_exist` about a file through the MCP server.
