import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.services.github_service import GitHubService, parse_github_datetime
from app.services.ingestion_service import _needs_processing


def _pr(number: int, updated_at: str) -> dict:
    return {"number": number, "updated_at": updated_at, "title": f"PR {number}"}


class ParseGitHubDatetimeTests(unittest.TestCase):
    def test_parses_zulu_timestamps_as_utc(self):
        parsed = parse_github_datetime("2026-03-01T10:00:00Z")
        self.assertEqual(parsed, datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc))

    def test_invalid_values_return_none(self):
        self.assertIsNone(parse_github_datetime(""))
        self.assertIsNone(parse_github_datetime("not-a-date"))
        self.assertIsNone(parse_github_datetime(None))


class IncrementalListingTests(unittest.TestCase):
    def test_stops_paging_once_cursor_is_reached(self):
        service = GitHubService("token")
        page_one = [_pr(9, "2026-03-05T00:00:00Z"), _pr(8, "2026-03-04T00:00:00Z"), _pr(7, "2026-03-01T00:00:00Z")]
        with patch.object(service, "_request", return_value=page_one) as request:
            result = service.list_pull_requests_updated_since(
                "org/repo",
                since=datetime(2026, 3, 2, tzinfo=timezone.utc),
                per_page=3,
            )
        self.assertEqual([pr["number"] for pr in result], [9, 8])
        self.assertEqual(request.call_count, 1)
        params = request.call_args.kwargs["params"]
        self.assertEqual(params["sort"], "updated")
        self.assertEqual(params["direction"], "desc")

    def test_without_cursor_collects_all_pages(self):
        service = GitHubService("token")
        pages = [
            [_pr(4, "2026-03-04T00:00:00Z"), _pr(3, "2026-03-03T00:00:00Z")],
            [_pr(2, "2026-03-02T00:00:00Z")],
        ]
        with patch.object(service, "_request", side_effect=pages) as request:
            result = service.list_pull_requests_updated_since("org/repo", since=None, per_page=2)
        self.assertEqual([pr["number"] for pr in result], [4, 3, 2])
        self.assertEqual(request.call_count, 2)


class NeedsProcessingTests(unittest.TestCase):
    def setUp(self):
        self.existing = {
            5: {"updated_at": parse_github_datetime("2026-03-01T00:00:00Z"), "has_entry": True},
            6: {"updated_at": parse_github_datetime("2026-03-01T00:00:00Z"), "has_entry": False},
        }

    def test_unchanged_pr_with_knowledge_is_skipped(self):
        self.assertFalse(_needs_processing(_pr(5, "2026-03-01T00:00:00Z"), self.existing))

    def test_updated_pr_is_processed(self):
        self.assertTrue(_needs_processing(_pr(5, "2026-03-02T00:00:00Z"), self.existing))

    def test_pr_without_knowledge_entry_is_processed(self):
        self.assertTrue(_needs_processing(_pr(6, "2026-03-01T00:00:00Z"), self.existing))

    def test_new_pr_is_processed(self):
        self.assertTrue(_needs_processing(_pr(7, "2026-03-01T00:00:00Z"), self.existing))


if __name__ == "__main__":
    unittest.main()
