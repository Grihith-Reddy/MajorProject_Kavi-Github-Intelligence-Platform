import unittest

from app.services.promise_service import _heuristic_kind, _signature, find_candidates


class PromiseCandidateTests(unittest.TestCase):
    def test_finds_commitments_across_sources_and_skips_noise(self):
        pr = {"body": "Adds caching.\n\nThis is a temporary workaround until the CDN migration.", "user": {"login": "alice"}, "created_at": "2026-01-02T00:00:00Z"}
        comments = [
            {"body": "Looks good! I'll add retention for the ledger in a follow-up PR.", "user": {"login": "bob"}, "created_at": "2026-01-03T00:00:00Z"},
            {"body": "> will fix later\nquoted text should be ignored", "user": {"login": "carol"}},
            {"body": "TODO: rotate keys", "user": {"login": "dependabot[bot]"}},
        ]
        reviews = [{"body": "```\n# TODO inside code\n```\nApproved.", "user": {"login": "dan"}}]
        commits = [{"commit": {"message": "fix: guard null payload\n\nTODO: remove once the provider fixes their SDK", "author": {"name": "Eve", "date": "2026-01-04T00:00:00Z"}}}]

        candidates = find_candidates(pr, comments, reviews, commits)
        quotes = [c["quote"] for c in candidates]

        self.assertIn("This is a temporary workaround until the CDN migration.", quotes)
        self.assertTrue(any("follow-up" in q for q in quotes))
        self.assertTrue(any("remove once the provider" in q for q in quotes))
        self.assertFalse(any("quoted text" in q or "will fix later" in q for q in quotes))
        self.assertFalse(any("rotate keys" in q for q in quotes))  # bot comment
        self.assertFalse(any("inside code" in q for q in quotes))  # code block

    def test_kind_and_signature(self):
        self.assertEqual(_heuristic_kind("Temporary hack for now"), "temporary")
        self.assertEqual(_heuristic_kind("TODO: add tests"), "todo")
        self.assertEqual(_heuristic_kind("We'll address this tech debt"), "tech_debt")
        self.assertEqual(_heuristic_kind("Will handle in a follow-up"), "follow_up")
        self.assertEqual(_signature("Will fix, later!"), _signature("will fix later"))


if __name__ == "__main__":
    unittest.main()
