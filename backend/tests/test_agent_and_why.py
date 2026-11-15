import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.services import agent_service
from app.services.agent_service import (
    AgentUnavailable,
    RepoAgentTools,
    history_from_memory,
    run_agent,
    step_label,
)
from app.services.why_service import _merge_segments, _normalize_ranges, why_for_lines


def _chunk(*parts):
    return {"candidates": [{"content": {"role": "model", "parts": list(parts)}}]}


class FakeTools:
    def __init__(self):
        self.calls = []
        self.sources = {}

    def call(self, name, args):
        self.calls.append((name, args))
        return {"results": [{"pr_number": 7, "title": "Add retries"}]}


class AgentLoopTests(unittest.TestCase):
    def test_tool_call_then_streamed_answer(self):
        rounds = iter(
            [
                [_chunk({"functionCall": {"name": "search_memory", "args": {"query": "retries"}}, "thoughtSignature": "sig"})],
                [_chunk({"text": "Retries were added "}), _chunk({"text": "in [PR #7]."})],
            ]
        )
        captured_contents = []

        def fake_stream(contents, use_tools):
            captured_contents.append([dict(item) for item in contents])
            return iter(next(rounds))

        events = []
        tools = FakeTools()
        with patch.object(agent_service, "_stream_gemini", side_effect=fake_stream):
            result = run_agent("why retries?", tools=tools, history=[], memory_note=None, emit=lambda n, d: events.append((n, d)))

        self.assertEqual(result["answer"], "Retries were added in [PR #7].")
        self.assertEqual(tools.calls, [("search_memory", {"query": "retries"})])
        self.assertEqual([step["status"] for name, step in events if name == "step"], ["running", "done"])
        self.assertEqual("".join(d["text"] for n, d in events if n == "token"), "Retries were added in [PR #7].")
        # The model turn (with its thought signature) and the tool response are sent back.
        second_round = captured_contents[1]
        self.assertEqual(second_round[-2]["role"], "model")
        self.assertEqual(second_round[-2]["parts"][0]["thoughtSignature"], "sig")
        self.assertIn("functionResponse", second_round[-1]["parts"][0])

    def test_unavailable_before_output_raises_for_fallback(self):
        def failing(contents, use_tools):
            raise AgentUnavailable("Gemini HTTP 503")

        with patch.object(agent_service, "_stream_gemini", side_effect=failing):
            with self.assertRaises(AgentUnavailable):
                run_agent("hi", tools=FakeTools(), history=[], memory_note=None, emit=lambda n, d: None)

    def test_history_starts_with_user_and_merges_roles(self):
        history, note = history_from_memory(
            {
                "recent_messages": [
                    {"role": "assistant", "content": "Welcome"},
                    {"role": "user", "content": "What is auth?"},
                    {"role": "assistant", "content": "Firebase."},
                ],
                "memory_items": [{"kind": "preference", "value": "User prefers python examples."}],
            }
        )
        self.assertEqual(history[0]["role"], "user")
        self.assertEqual(len(history), 2)
        self.assertIn("python", note)

    def test_step_labels_are_human_readable(self):
        self.assertEqual(step_label("get_pull_request", {"number": 4}), "Opened PR #4")
        self.assertIn("app.py", step_label("why_lines", {"path": "app.py", "start_line": 1, "end_line": 9}))


class ToolErrorTests(unittest.TestCase):
    def _tools(self):
        return RepoAgentTools(MagicMock(), {"id": "r", "full_name": "o/r", "default_branch": "main"}, MagicMock())

    def test_internal_errors_are_not_leaked(self):
        tools = self._tools()
        with patch.object(RepoAgentTools, "search_memory", side_effect=RuntimeError("relation secret_table does not exist")):
            result = tools.call("search_memory", {"query": "x"})
        self.assertNotIn("secret_table", result["error"])

    def test_upstream_http_errors_are_reported(self):
        tools = self._tools()
        with patch.object(RepoAgentTools, "read_file", side_effect=HTTPException(status_code=404, detail="GitHub resource not found")):
            result = tools.call("read_file", {"path": "x.py"})
        self.assertEqual(result["error"], "GitHub resource not found")


class WhyLensTests(unittest.TestCase):
    def setUp(self):
        raw = [
            {"startingLine": 1, "endingLine": 4, "age": 3, "commit": {"oid": "a1", "abbreviatedOid": "a1", "messageHeadline": "init", "committedDate": "2026-01-01T00:00:00Z", "author": {"name": "A", "user": {"login": "alice"}}, "associatedPullRequests": {"nodes": [{"number": 3, "title": "Init", "url": "u3"}]}}},
            {"startingLine": 5, "endingLine": 9, "age": 2, "commit": {"oid": "b2", "abbreviatedOid": "b2", "messageHeadline": "more", "committedDate": "2026-01-02T00:00:00Z", "author": {"name": "A", "user": {"login": "alice"}}, "associatedPullRequests": {"nodes": [{"number": 3, "title": "Init", "url": "u3"}]}}},
            {"startingLine": 10, "endingLine": 12, "age": 1, "commit": {"oid": "c3", "abbreviatedOid": "c3", "messageHeadline": "hotfix", "committedDate": "2026-02-01T00:00:00Z", "author": {"name": "B", "user": None}, "associatedPullRequests": {"nodes": []}}},
        ]
        self.ranges = _normalize_ranges(raw)

    def test_adjacent_ranges_from_the_same_pr_are_merged(self):
        segments = _merge_segments(self.ranges)
        self.assertEqual([(s["start_line"], s["end_line"], s["pr_number"]) for s in segments], [(1, 9, 3), (10, 12, None)])

    def test_line_window_selects_overlapping_segments(self):
        file_why = {
            "path": "app.py",
            "segments": _merge_segments(self.ranges),
            "prs": [{"pr_number": 3, "title": "Init"}],
            "content": "\n".join(f"line {i}" for i in range(1, 13)),
        }
        narrowed = why_for_lines(file_why, 8, 11)
        self.assertEqual(len(narrowed["segments"]), 2)
        self.assertEqual([pr["pr_number"] for pr in narrowed["prs"]], [3])
        self.assertIn("    8  line 8", narrowed["excerpt"])


if __name__ == "__main__":
    unittest.main()
