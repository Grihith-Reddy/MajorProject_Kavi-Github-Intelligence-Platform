"""KAVI's repository agent.

A tool-using chat loop on top of Gemini function calling. Instead of guessing what a
question needs with heuristics, the model decides which evidence to gather (search
memory, open a PR, read a file, run Why-Lens blame, find experts...) and streams a
grounded Markdown answer. Every tool call is surfaced to the UI as a reasoning step.
"""

from __future__ import annotations

import fnmatch
import json
import logging
from collections import defaultdict
from typing import Any, Callable, Iterator

import requests
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.access import require_github_account, require_user_id
from app.core.resilience import ai_circuit_breaker
from app.core.security import UserContext, decrypt_token
from app.core.settings import settings
from app.services.ai_service import AIService
from app.services.github_service import GitHubService


logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 6
Emit = Callable[[str, dict[str, Any]], None]


class AgentUnavailable(Exception):
    """Raised when the model cannot be reached before any output was produced."""


SYSTEM_PROMPT = """You are KAVI, an engineering teammate who remembers why a codebase is the way it is.
You answer questions about ONE GitHub repository using tools that read KAVI's memory of its
pull requests (summaries, intent, decisions, risks), the live code, and line-level blame.

How to work:
- For any claim about this repository, gather evidence with tools first. Prefer search_memory for
  "why/when/what changed" questions, why_lines for "why does this code exist", read_file for
  "how does X work", who_knows for "who should I ask", repo_overview for big-picture questions.
- Use as few tool calls as needed (usually 1-3). Do not call the same tool with the same arguments twice.
- General programming questions that are not about this repository can be answered directly.

How to answer:
- Answer the question directly in the first sentence. Be concise and specific; no filler, no
  generic caveats.
- Use GitHub-flavoured Markdown. Use short headings or bullet lists only when they help.
- Cite evidence inline: pull requests as [PR #123], files as `path/to/file.py:10-24`.
- Put code in fenced blocks with a language tag. Only quote code you actually read via a tool.
- Never invent PR numbers, file paths, people or dates. If the evidence is missing, say exactly
  what is missing and what would answer it.
- Do not narrate your tool usage ("I searched...") - the interface already shows those steps.
- If a tool fails, say briefly what you could not check. Never guess function, class or file names.
"""


def _schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "OBJECT", "properties": properties}
    if required:
        schema["required"] = required
    return schema


TOOL_DECLARATIONS: list[dict[str, Any]] = [
    {
        "name": "search_memory",
        "description": "Semantic + keyword search over KAVI's memory of this repository's pull requests. Returns the most relevant PRs with summary, intent and touched files.",
        "parameters": _schema({"query": {"type": "STRING", "description": "What to look for, in natural language."}}, ["query"]),
    },
    {
        "name": "get_pull_request",
        "description": "Full recorded knowledge for one pull request: summary, intent, decisions, risks, tags, files, people and dates.",
        "parameters": _schema({"number": {"type": "INTEGER", "description": "Pull request number."}}, ["number"]),
    },
    {
        "name": "read_file",
        "description": "Read the current contents of a file on the default branch, with line numbers.",
        "parameters": _schema(
            {
                "path": {"type": "STRING", "description": "Repository-relative file path."},
                "start_line": {"type": "INTEGER", "description": "First line (1-based). Optional."},
                "end_line": {"type": "INTEGER", "description": "Last line. Optional."},
            },
            ["path"],
        ),
    },
    {
        "name": "find_files",
        "description": "Find file paths in the repository by name fragment or glob (e.g. 'auth', '*.sql', 'src/**/router*').",
        "parameters": _schema({"pattern": {"type": "STRING"}}, ["pattern"]),
    },
    {
        "name": "why_lines",
        "description": "Why-Lens: explain why specific lines exist by mapping them (via git blame) to the pull requests that introduced them and the intent KAVI recorded.",
        "parameters": _schema(
            {
                "path": {"type": "STRING"},
                "start_line": {"type": "INTEGER"},
                "end_line": {"type": "INTEGER"},
            },
            ["path", "start_line", "end_line"],
        ),
    },
    {
        "name": "who_knows",
        "description": "Find the people with the most context on a topic, based on who authored, reviewed and discussed the relevant pull requests.",
        "parameters": _schema({"topic": {"type": "STRING"}}, ["topic"]),
    },
    {
        "name": "repo_overview",
        "description": "Big-picture statistics: PR counts, contributors, most-changed files and directories, tags, technologies and monthly activity.",
        "parameters": _schema({}),
    },
    {
        "name": "list_promises",
        "description": "Promise Tracker: commitments made in PR discussions ('will fix in a follow-up', 'temporary hack', TODOs) and whether a later PR kept them.",
        "parameters": _schema({"status": {"type": "STRING", "description": "open, kept, or all. Defaults to open."}}),
    },
]


def _clip(value: Any, limit: int) -> str:
    text_value = " ".join(str(value or "").split())
    return text_value if len(text_value) <= limit else text_value[: limit - 1] + "…"


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


class RepoAgentTools:
    def __init__(self, db: Session, repo_meta: dict[str, Any], current_user: UserContext, as_of: str | None = None):
        self.db = db
        self.repo_meta = repo_meta
        self.repo_id = str(repo_meta["id"])
        self.full_name = str(repo_meta["full_name"])
        self.default_branch = str(repo_meta.get("default_branch") or "main")
        self.current_user = current_user
        self._github: GitHubService | None = None
        self._tree: list[str] | None = None
        self.sources: dict[str, dict[str, Any]] = {}
        # Time-Travel: YYYY-MM-DD. Memory, code and blame are limited to that date.
        self.as_of = as_of
        self._ref: str | None = None

    # ── shared helpers ──────────────────────────────────────────────────────

    @property
    def github(self) -> GitHubService:
        if self._github is None:
            user_id = require_user_id(self.db, self.current_user.sub)
            account = require_github_account(self.db, user_id)
            self._github = GitHubService(decrypt_token(account["access_token_encrypted"]))
        return self._github

    @property
    def ref(self) -> str:
        """Branch for live answers, or the commit that was current on the Time-Travel date."""
        if self._ref is None:
            self._ref = self.default_branch
            if self.as_of:
                sha = self.github.commit_at(self.full_name, self.default_branch, f"{self.as_of}T23:59:59Z")
                if sha:
                    self._ref = sha
        return self._ref

    def _after_as_of(self, value: Any) -> bool:
        if not self.as_of or value is None:
            return False
        stamp = value.isoformat() if hasattr(value, 'isoformat') else str(value)
        return stamp[:10] > self.as_of

    def tree(self) -> list[str]:
        if self._tree is None:
            rows = self.github.list_repository_tree(self.full_name, branch=self.ref, max_entries=10000)
            self._tree = [str(item.get("path") or "") for item in rows if item.get("path")]
        return self._tree

    def _add_pr_source(self, row: dict[str, Any], files: list[dict[str, Any]] | None = None) -> None:
        number = row.get("github_pr_number") or row.get("pr_number")
        if not number:
            return
        key = f"pr::{number}"
        existing = self.sources.get(key, {})
        self.sources[key] = {
            "entry_id": str(row.get("entry_id") or row.get("id") or existing.get("entry_id") or key),
            "pr_number": int(number),
            "pr_title": row.get("pr_title") or row.get("title") or existing.get("pr_title"),
            "pr_url": row.get("pr_url") or row.get("url") or existing.get("pr_url"),
            "summary": row.get("summary") or existing.get("summary") or "",
            "intent": row.get("intent") or existing.get("intent") or "",
            "files": files if files is not None else existing.get("files", []),
            "rank": float(row.get("rank") or existing.get("rank") or 0),
        }

    def _add_file_source(self, path: str, start_line: int, end_line: int) -> None:
        key = f"live-file::{path}"
        self.sources[key] = {
            "entry_id": key,
            "pr_number": None,
            "pr_title": f"Live file: {path}",
            "pr_url": None,
            "summary": "",
            "intent": f"Current code on {self.default_branch}",
            "files": [{"file_path": path, "start_line": start_line, "end_line": end_line, "confidence": 1.0}],
            "rank": 1000.0,
        }

    def _files_for_entries(self, entry_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        if not entry_ids:
            return {}
        rows = self.db.execute(
            text(
                """
                SELECT knowledge_entry_id, file_path, start_line, end_line
                FROM file_mappings
                WHERE knowledge_entry_id = ANY(CAST(:ids AS uuid[]))
                ORDER BY file_path
                """
            ),
            {"ids": entry_ids},
        ).mappings().all()
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            grouped[str(row["knowledge_entry_id"])].append(
                {"file_path": row["file_path"], "start_line": row["start_line"], "end_line": row["end_line"]}
            )
        return grouped

    # ── tools ───────────────────────────────────────────────────────────────

    def search_memory(self, query: str) -> dict[str, Any]:
        from app.api.chat import ChatQuery, _fetch_candidate_entries  # local import avoids a cycle

        payload = ChatQuery(repo_id=self.repo_id, query=str(query or "")[:500] or "overview", limit=6, as_of=self.as_of)
        rows = _fetch_candidate_entries(self.db, payload, strategy="hybrid")[:6]
        files_by_entry = self._files_for_entries([str(row["id"]) for row in rows])
        results = []
        for row in rows:
            files = files_by_entry.get(str(row["id"]), [])[:8]
            self._add_pr_source(dict(row), files)
            results.append(
                {
                    "pr_number": row.get("github_pr_number"),
                    "title": row.get("pr_title"),
                    "merged_at": _iso(row.get("pr_merged_at")),
                    "summary": _clip(row.get("summary"), 600),
                    "intent": _clip(row.get("intent"), 300),
                    "files": [f["file_path"] for f in files[:6]],
                }
            )
        return {"results": results, "note": None if results else "No indexed pull requests matched."}

    def get_pull_request(self, number: int) -> dict[str, Any]:
        row = self.db.execute(
            text(
                """
                SELECT k.id AS entry_id, k.summary, k.intent, k.decisions, k.risks, k.tags,
                       pr.github_pr_number, pr.title, pr.url, pr.state, pr.author_login,
                       pr.created_at, pr.merged_at, pr.base_branch, pr.head_branch, pr.body
                FROM pull_requests pr
                LEFT JOIN knowledge_entries k ON k.pr_id = pr.id
                WHERE pr.repo_id = :repo_id AND pr.github_pr_number = :number
                """
            ),
            {"repo_id": self.repo_id, "number": int(number)},
        ).mappings().first()
        if not row:
            return {"error": f"PR #{number} is not in KAVI's memory for this repository."}
        if self._after_as_of(row["merged_at"] or row["created_at"]):
            return {"note": f"As of {self.as_of}, PR #{number} did not exist yet (it is dated {_iso(row['merged_at'] or row['created_at'])})."}
        files = self._files_for_entries([str(row["entry_id"])]).get(str(row["entry_id"]), []) if row["entry_id"] else []
        people = self.db.execute(
            text(
                """
                SELECT pp.login, pp.role
                FROM pr_participants pp
                JOIN pull_requests pr ON pr.id = pp.pr_id
                WHERE pr.repo_id = :repo_id AND pr.github_pr_number = :number
                ORDER BY pp.role, pp.interactions DESC
                """
            ),
            {"repo_id": self.repo_id, "number": int(number)},
        ).mappings().all()
        self._add_pr_source(dict(row), files[:12])
        return {
            "pr_number": row["github_pr_number"],
            "title": row["title"],
            "url": row["url"],
            "state": row["state"],
            "author": row["author_login"],
            "created_at": _iso(row["created_at"]),
            "merged_at": _iso(row["merged_at"]),
            "branches": f"{row['head_branch']} → {row['base_branch']}",
            "summary": row["summary"],
            "intent": row["intent"],
            "decisions": row["decisions"] or [],
            "risks": row["risks"] or [],
            "tags": list(row["tags"] or []) if isinstance(row["tags"], (list, tuple)) else row["tags"],
            "description_excerpt": _clip(row["body"], 1200),
            "files": [{"path": f["file_path"], "lines": f"{f['start_line']}-{f['end_line']}"} for f in files[:25]],
            "people": [{"login": p["login"], "role": p["role"]} for p in people],
        }

    def read_file(self, path: str, start_line: int | None = None, end_line: int | None = None) -> dict[str, Any]:
        normalized = str(path or "").strip().lstrip("/")
        content = self.github.get_file_content(self.full_name, normalized, ref=self.ref, max_chars=120_000)
        if not content:
            matches = [p for p in self.tree() if p.endswith("/" + normalized) or p.endswith(normalized)][:5]
            return {"error": f"Could not read {normalized}.", "did_you_mean": matches}
        lines = content.splitlines()
        start = max(1, int(start_line or 1))
        end = min(len(lines), int(end_line or (start + 199)))
        end = min(end, start + 249)
        self._add_file_source(normalized, start, end)
        numbered = "\n".join(f"{index + 1:>5}  {lines[index]}" for index in range(start - 1, end))
        result = {"path": normalized, "total_lines": len(lines), "start_line": start, "end_line": end, "content": numbered}
        if self.as_of:
            result["as_of_commit"] = self.ref[:12]
        return result

    def find_files(self, pattern: str) -> dict[str, Any]:
        raw = str(pattern or "").strip()
        if not raw:
            return {"matches": []}
        lowered = raw.lower()
        if any(ch in raw for ch in "*?["):
            matches = [p for p in self.tree() if fnmatch.fnmatch(p.lower(), lowered) or fnmatch.fnmatch(p.lower().split("/")[-1], lowered)]
        else:
            matches = [p for p in self.tree() if lowered in p.lower()]
        matches.sort(key=lambda p: (lowered not in p.lower().split("/")[-1], len(p)))
        return {"matches": matches[:60], "total": len(matches)}

    def why_lines(self, path: str, start_line: int, end_line: int) -> dict[str, Any]:
        from app.services.why_service import get_file_why, why_for_lines

        file_why = get_file_why(self.db, repo_meta=self.repo_meta, github=self.github, path=path, ref=self.ref)
        narrowed = why_for_lines(file_why, start_line, end_line)
        self._add_file_source(narrowed["path"], narrowed["start_line"], narrowed["end_line"])
        for pr in narrowed["prs"]:
            self._add_pr_source({**pr, "github_pr_number": pr.get("pr_number")})
        return {
            "path": narrowed["path"],
            "lines": f"{narrowed['start_line']}-{narrowed['end_line']}",
            "code": narrowed["excerpt"],
            "blame": [
                {
                    "lines": f"{s['start_line']}-{s['end_line']}",
                    "pr_number": s.get("pr_number"),
                    "commit": s.get("commit_short"),
                    "commit_message": s.get("commit_headline"),
                    "author": s.get("author_login") or s.get("author_name"),
                    "date": s.get("committed_at"),
                }
                for s in narrowed["segments"][:20]
            ],
            "pull_requests": [
                {
                    "pr_number": pr.get("pr_number"),
                    "title": pr.get("title"),
                    "intent": pr.get("intent"),
                    "summary": _clip(pr.get("summary"), 500),
                    "decisions": (pr.get("decisions") or [])[:6],
                    "indexed_by_kavi": pr.get("indexed", False),
                }
                for pr in narrowed["prs"][:6]
            ],
        }

    def who_knows(self, topic: str) -> dict[str, Any]:
        from app.api.chat import ChatQuery, _fetch_candidate_entries

        payload = ChatQuery(repo_id=self.repo_id, query=str(topic or "")[:300] or "code", limit=10, as_of=self.as_of)
        rows = _fetch_candidate_entries(self.db, payload, strategy="hybrid")[:10]
        entry_ids = [str(row["id"]) for row in rows]
        if not entry_ids:
            return {"people": [], "note": "No pull requests matched this topic."}
        participants = self.db.execute(
            text(
                """
                SELECT pp.login, pp.role, pp.interactions, pp.last_seen_at, pr.github_pr_number
                FROM pr_participants pp
                JOIN pull_requests pr ON pr.id = pp.pr_id
                JOIN knowledge_entries k ON k.pr_id = pr.id
                WHERE k.id = ANY(CAST(:ids AS uuid[]))
                """
            ),
            {"ids": entry_ids},
        ).mappings().all()
        rank_weight = {entry_id: 1.0 / (index + 1) for index, entry_id in enumerate(entry_ids)}
        number_to_entry = {row.get("github_pr_number"): str(row["id"]) for row in rows}
        role_weight = {"author": 3.0, "reviewer": 2.0, "commenter": 1.0}
        people: dict[str, dict[str, Any]] = {}
        for row in participants:
            login = row["login"]
            weight = role_weight.get(row["role"], 1.0) * rank_weight.get(number_to_entry.get(row["github_pr_number"]), 0.2)
            person = people.setdefault(login, {"login": login, "score": 0.0, "roles": set(), "prs": set(), "last_seen_at": None})
            person["score"] += weight
            person["roles"].add(row["role"])
            person["prs"].add(row["github_pr_number"])
            if row["last_seen_at"] and (person["last_seen_at"] is None or row["last_seen_at"] > person["last_seen_at"]):
                person["last_seen_at"] = row["last_seen_at"]
        if not people:
            # Repositories synced before participant tracking: fall back to PR authors.
            authors = self.db.execute(
                text(
                    """
                    SELECT pr.author_login AS login, COUNT(*) AS n, MAX(pr.updated_at) AS last_seen_at,
                           ARRAY_AGG(pr.github_pr_number) AS prs
                    FROM pull_requests pr JOIN knowledge_entries k ON k.pr_id = pr.id
                    WHERE k.id = ANY(CAST(:ids AS uuid[])) AND pr.author_login IS NOT NULL
                    GROUP BY pr.author_login ORDER BY n DESC LIMIT 5
                    """
                ),
                {"ids": entry_ids},
            ).mappings().all()
            return {
                "people": [
                    {"login": a["login"], "roles": ["author"], "pr_numbers": list(a["prs"])[:8], "last_active": _iso(a["last_seen_at"])}
                    for a in authors
                ]
            }
        ranked = sorted(people.values(), key=lambda p: p["score"], reverse=True)[:5]
        return {
            "people": [
                {
                    "login": p["login"],
                    "roles": sorted(p["roles"]),
                    "pr_numbers": sorted(n for n in p["prs"] if n)[:8],
                    "last_active": _iso(p["last_seen_at"]),
                }
                for p in ranked
            ]
        }

    def repo_overview(self) -> dict[str, Any]:
        from app.api.chat import _build_repo_overview_context

        context = _build_repo_overview_context(
            self.db, self.repo_id, self.current_user, self.repo_meta, include_live_inventory=False
        )
        return {
            "repository": context.get("repository"),
            "stats": context.get("stats"),
            "recent_prs": [
                {"pr_number": pr.get("github_pr_number"), "title": pr.get("title"), "author": pr.get("author_login"), "merged_at": _iso(pr.get("merged_at"))}
                for pr in (context.get("recent_prs") or [])[:10]
            ],
            "top_directories": (context.get("top_directories") or [])[:12],
            "top_files": [f.get("file_path") for f in (context.get("top_files") or [])[:15]],
            "top_tags": [t.get("tag") for t in (context.get("top_tags") or [])[:15]],
            "technologies": [t.get("name") for t in (context.get("technologies") or [])][:12],
            "contributors": [{"login": c.get("author_login"), "prs": c.get("pr_count")} for c in (context.get("contributors") or [])[:8]],
            "monthly_activity": (context.get("monthly_activity") or [])[-12:],
        }

    def list_promises(self, status: str | None = None) -> dict[str, Any]:
        wanted = str(status or "open").lower()
        clauses = "" if wanted == "all" else "AND p.status = :status"
        if self.as_of:
            # Status as it stood on the date: kept only if the keeping PR had merged by then.
            clauses = "AND p.made_at <= CAST(:as_of AS timestamptz)"
        rows = self.db.execute(
            text(
                f"""
                SELECT p.quote, p.summary, p.kind, p.status, p.author_login, p.made_at,
                       pr.github_pr_number, rp.github_pr_number AS resolved_by, rp.merged_at AS resolved_at
                FROM pr_promises p
                JOIN pull_requests pr ON pr.id = p.pr_id
                LEFT JOIN pull_requests rp ON rp.id = p.resolved_pr_id
                WHERE p.repo_id = :repo_id {clauses}
                ORDER BY p.made_at ASC NULLS LAST
                LIMIT 25
                """
            ),
            {"repo_id": self.repo_id, "status": wanted, "as_of": f"{self.as_of}T23:59:59+00:00" if self.as_of else None},
        ).mappings().all()
        if self.as_of:
            rows = [
                {**dict(row), "status": "kept" if row["resolved_by"] and row["status"] == "kept" and not self._after_as_of(row.get("resolved_at")) else "open"}
                for row in rows
                if row["status"] != "dismissed"
            ]
            if wanted in {"open", "kept"}:
                rows = [row for row in rows if row["status"] == wanted]
        return {
            "promises": [
                {
                    "promise": row["summary"] or _clip(row["quote"], 200),
                    "kind": row["kind"],
                    "status": row["status"],
                    "made_in_pr": row["github_pr_number"],
                    "kept_by_pr": row["resolved_by"],
                    "by": row["author_login"],
                    "made_at": _iso(row["made_at"]),
                }
                for row in rows
            ]
        }

    # ── dispatch ────────────────────────────────────────────────────────────

    def call(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        handlers: dict[str, Callable[..., dict[str, Any]]] = {
            "search_memory": lambda a: self.search_memory(a.get("query", "")),
            "get_pull_request": lambda a: self.get_pull_request(int(a.get("number") or 0)),
            "read_file": lambda a: self.read_file(a.get("path", ""), a.get("start_line"), a.get("end_line")),
            "find_files": lambda a: self.find_files(a.get("pattern", "")),
            "why_lines": lambda a: self.why_lines(a.get("path", ""), int(a.get("start_line") or 1), int(a.get("end_line") or a.get("start_line") or 1)),
            "who_knows": lambda a: self.who_knows(a.get("topic", "")),
            "repo_overview": lambda a: self.repo_overview(),
            "list_promises": lambda a: self.list_promises(a.get("status")),
        }
        handler = handlers.get(name)
        if handler is None:
            return {"error": f"Unknown tool {name}"}
        try:
            return handler(args or {})
        except HTTPException as exc:  # GitHub/upstream errors carry safe, user-facing details
            self.db.rollback()
            logger.warning("Agent tool %s failed: %s", name, exc.detail)
            return {"error": _clip(exc.detail, 200)}
        except Exception:  # never leak internals (SQL, stack traces) to the model or UI
            self.db.rollback()
            logger.warning("Agent tool %s failed", name, exc_info=True)
            return {"error": f"The {name} tool is temporarily unavailable."}


def step_label(name: str, args: dict[str, Any]) -> str:
    labels = {
        "search_memory": lambda a: f"Searched memory for “{_clip(a.get('query'), 60)}”",
        "get_pull_request": lambda a: f"Opened PR #{a.get('number')}",
        "read_file": lambda a: f"Read {a.get('path')}" + (f" · L{a.get('start_line')}–{a.get('end_line')}" if a.get("start_line") else ""),
        "find_files": lambda a: f"Looked for files matching “{_clip(a.get('pattern'), 40)}”",
        "why_lines": lambda a: f"Traced why {a.get('path')} L{a.get('start_line')}–{a.get('end_line')} exists",
        "who_knows": lambda a: f"Found who knows “{_clip(a.get('topic'), 40)}”",
        "repo_overview": lambda a: "Reviewed the repository overview",
        "list_promises": lambda a: "Checked the promise ledger",
    }
    return labels.get(name, lambda a: name)(args or {})


def step_summary(name: str, result: dict[str, Any]) -> str:
    if result.get("error"):
        return _clip(result["error"], 120)
    if name == "search_memory":
        numbers = [f"#{r['pr_number']}" for r in result.get("results", []) if r.get("pr_number")]
        return f"{len(numbers)} pull request{'s' if len(numbers) != 1 else ''}" + (f" · {', '.join(numbers[:5])}" if numbers else "")
    if name == "read_file":
        return f"{result.get('end_line', 0) - result.get('start_line', 0) + 1} lines of {result.get('total_lines')}"
    if name == "find_files":
        return f"{result.get('total', 0)} matches"
    if name == "why_lines":
        numbers = [f"#{p['pr_number']}" for p in result.get("pull_requests", []) if p.get("pr_number")]
        return ", ".join(numbers) if numbers else "Direct commits, no PR"
    if name == "who_knows":
        return ", ".join(p["login"] for p in result.get("people", [])[:3]) or "No one found"
    if name == "get_pull_request":
        return _clip(result.get("title"), 80)
    if name == "list_promises":
        return f"{len(result.get('promises', []))} promises"
    return "Done"


# ── Gemini streaming ────────────────────────────────────────────────────────


def _model_name() -> str:
    return AIService._resolved_model_name or AIService()._normalize_model_name(settings.AI_MODEL)


def _stream_gemini(contents: list[dict[str, Any]], *, use_tools: bool) -> Iterator[dict[str, Any]]:
    ai_circuit_breaker.before_request()
    body: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 4096},
    }
    if use_tools:
        body["tools"] = [{"functionDeclarations": TOOL_DECLARATIONS}]

    model = _model_name()
    response = None
    for attempt in range(2):
        try:
            response = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent",
                params={"alt": "sse"},
                headers={"x-goog-api-key": settings.AI_API_KEY or ""},
                json=body,
                stream=True,
                timeout=(10, 120),
            )
        except requests.RequestException as exc:
            ai_circuit_breaker.record_failure()
            raise AgentUnavailable(type(exc).__name__) from exc
        if response.status_code == 404 and attempt == 0:
            discovered = AIService()._discover_supported_model()
            if discovered and discovered != model:
                model = discovered
                continue
        break

    assert response is not None
    if response.status_code >= 400:
        if response.status_code in {429, 500, 502, 503, 504}:
            ai_circuit_breaker.record_failure()
        raise AgentUnavailable(f"Gemini HTTP {response.status_code}")

    ai_circuit_breaker.record_success()
    AIService._resolved_model_name = model
    with response:
        for raw_line in response.iter_lines(decode_unicode=True):
            if not raw_line or not raw_line.startswith("data:"):
                continue
            payload = raw_line[5:].strip()
            if not payload:
                continue
            try:
                yield json.loads(payload)
            except json.JSONDecodeError:
                continue


def run_agent(
    query: str,
    *,
    tools: RepoAgentTools,
    history: list[dict[str, Any]],
    memory_note: str | None,
    emit: Emit,
) -> dict[str, Any]:
    """Run the tool loop, emitting ``token``, ``step`` and ``note`` events. Returns the final answer."""
    user_text = query.strip()
    if getattr(tools, "as_of", None):
        user_text = (
            f"[TIME-TRAVEL: answer as the repository was at the end of {tools.as_of}. Your tools only return history up to that date and code at the commit current then. Speak about that point in time.]\n\n{user_text}"
        )
    if memory_note:
        user_text = f"{user_text}\n\n[Context KAVI remembers about this user and conversation]\n{memory_note}"
    contents = _merge_consecutive([*history, {"role": "user", "parts": [{"text": user_text}]}])
    trace: list[dict[str, Any]] = []
    produced_output = False
    answer = ""

    for round_index in range(MAX_TOOL_ROUNDS + 1):
        use_tools = round_index < MAX_TOOL_ROUNDS
        round_parts: list[dict[str, Any]] = []
        round_text = ""
        calls: list[dict[str, Any]] = []
        try:
            for chunk in _stream_gemini(contents, use_tools=use_tools):
                candidates = chunk.get("candidates") or []
                if not candidates:
                    continue
                parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
                for part in parts:
                    if not isinstance(part, dict) or part.get("thought"):
                        continue
                    round_parts.append(part)
                    if part.get("functionCall"):
                        calls.append(part["functionCall"])
                    elif part.get("text"):
                        round_text += part["text"]
                        produced_output = True
                        emit("token", {"text": part["text"]})
        except AgentUnavailable:
            if not produced_output and not trace:
                raise
            emit("error", {"message": "The AI provider stopped responding. Showing what was gathered so far."})
            break

        if not calls:
            answer = round_text
            break

        if round_text.strip():
            # Text spoken before a tool call is a working note, not the answer.
            emit("note", {"text": round_text})
        contents.append({"role": "model", "parts": round_parts})
        responses = []
        for call in calls:
            name = str(call.get("name") or "")
            args = call.get("args") if isinstance(call.get("args"), dict) else {}
            step = {"id": f"s{len(trace) + 1}", "tool": name, "label": step_label(name, args), "status": "running"}
            emit("step", step)
            result = tools.call(name, args)
            step = {**step, "status": "error" if result.get("error") else "done", "summary": step_summary(name, result)}
            trace.append(step)
            emit("step", step)
            responses.append({"functionResponse": {"name": name, "response": {"result": result}}})
        contents.append({"role": "user", "parts": responses})

    return {"answer": answer.strip(), "trace": trace}


def _merge_consecutive(contents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for item in contents:
        if merged and merged[-1]["role"] == item["role"]:
            merged[-1] = {"role": item["role"], "parts": [*merged[-1]["parts"], *item["parts"]]}
        else:
            merged.append(item)
    return merged


def history_from_memory(memory_context: dict[str, Any] | None, max_messages: int = 8) -> tuple[list[dict[str, Any]], str | None]:
    """Turn persisted conversation memory into Gemini chat history plus a short memory note."""
    if not memory_context:
        return [], None
    history: list[dict[str, Any]] = []
    for message in (memory_context.get("recent_messages") or [])[-max_messages:]:
        role = str(message.get("role") or "")
        content = str(message.get("content") or "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        history.append({"role": "user" if role == "user" else "model", "parts": [{"text": content[:2000]}]})
    # Gemini requires the history to start with a user turn.
    while history and history[0]["role"] != "user":
        history.pop(0)

    notes = []
    for item in (memory_context.get("memory_items") or [])[:10]:
        if item.get("kind") in {"preference", "active_task"}:
            notes.append(f"- {item.get('value')}")
    return history, ("\n".join(notes) if notes else None)
