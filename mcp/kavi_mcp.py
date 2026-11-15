"""KAVI MCP server: KAVI's engineering memory for any MCP client.

Gives editor agents (Claude Code, Cursor, Windsurf, VS Code agents...) tools to ask why
code exists, search past decisions, find who knows a topic and check open promises.

Setup (free):
    pip install -r mcp/requirements.txt
    # create an editor token in KAVI → Settings → Integrations, then:
    claude mcp add kavi -e KAVI_API_URL=https://your-kavi-api -e KAVI_TOKEN=kavi_mcp_... \
        -- python path/to/kavi/mcp/kavi_mcp.py

Optional: KAVI_REPO=owner/name sets a default repository for every tool.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

try:  # MCP Python SDK 2.x
    from mcp.server.mcpserver import MCPServer as _Server
except ImportError:  # MCP Python SDK 1.x
    from mcp.server.fastmcp import FastMCP as _Server

API_URL = os.environ.get("KAVI_API_URL", "http://localhost:8000").rstrip("/")
TOKEN = os.environ.get("KAVI_TOKEN", "")
DEFAULT_REPO = os.environ.get("KAVI_REPO", "")

mcp = _Server("kavi")


def _repo(repo: str | None) -> str:
    chosen = (repo or DEFAULT_REPO).strip()
    if not chosen:
        raise ValueError("Pass repo='owner/name' (or set KAVI_REPO). Call list_repositories to see synced ones.")
    return chosen


async def _call(method: str, path: str, *, params: dict[str, Any] | None = None, json: dict[str, Any] | None = None) -> Any:
    if not TOKEN:
        raise RuntimeError("KAVI_TOKEN is not set. Create an editor token in KAVI → Settings → Integrations.")
    # Free hosting may be asleep: allow a generous timeout for the first request.
    async with httpx.AsyncClient(base_url=f"{API_URL}/api/mcp", timeout=httpx.Timeout(120.0, connect=60.0)) as client:
        response = await client.request(method, path, params=params, json=json, headers={"Authorization": f"Bearer {TOKEN}"})
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail")
        except Exception:
            detail = response.text[:200]
        raise RuntimeError(f"KAVI error {response.status_code}: {detail}")
    return response.json()


@mcp.tool()
async def list_repositories() -> list[dict[str, Any]]:
    """List repositories synced in KAVI that this token can read."""
    data = await _call("GET", "/repositories")
    return [
        {"repo": row["full_name"], "pull_requests": row.get("pr_count"), "synced_at": row.get("synced_at")}
        for row in data.get("repositories", [])
    ]


@mcp.tool()
async def ask_kavi(question: str, repo: str | None = None) -> dict[str, Any]:
    """Ask KAVI a question about a repository's history and intent.

    KAVI researches with its own tools (PR memory, live code, blame) and answers with
    citations like [PR #123]. Use it for "why", "when", "who decided" and "what changed" questions.
    """
    return await _call("POST", "/ask", json={"repo": _repo(repo), "question": question})


@mcp.tool()
async def why_does_this_exist(path: str, start_line: int, end_line: int | None = None, repo: str | None = None) -> dict[str, Any]:
    """Explain why specific lines exist: maps them via git blame to the pull requests that
    introduced them and the intent, decisions and risks KAVI recorded for those PRs.
    Call this before changing code you did not write."""
    return await _call("GET", "/why", params={"repo": _repo(repo), "path": path, "start_line": start_line, "end_line": end_line or start_line})


@mcp.tool()
async def search_decisions(query: str, repo: str | None = None) -> dict[str, Any]:
    """Semantic + keyword search over past pull requests: summaries, intent and touched files."""
    return await _call("GET", "/search", params={"repo": _repo(repo), "q": query})


@mcp.tool()
async def get_pull_request(number: int, repo: str | None = None) -> dict[str, Any]:
    """Everything KAVI remembers about one pull request: intent, decisions, risks, files and people."""
    return await _call("GET", "/pull-request", params={"repo": _repo(repo), "number": number})


@mcp.tool()
async def who_knows(topic: str, repo: str | None = None) -> dict[str, Any]:
    """Find the people with the most context on a topic (authors, reviewers, discussants)."""
    return await _call("GET", "/experts", params={"repo": _repo(repo), "topic": topic})


@mcp.tool()
async def open_promises(repo: str | None = None, status: str = "open") -> dict[str, Any]:
    """Commitments made in PR discussions (follow-ups, temporary hacks, TODOs) and whether they were kept.
    status: open, kept or all."""
    return await _call("GET", "/promises", params={"repo": _repo(repo), "status": status})


if __name__ == "__main__":
    mcp.run()
