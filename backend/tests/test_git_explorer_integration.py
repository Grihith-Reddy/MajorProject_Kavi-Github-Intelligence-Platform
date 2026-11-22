"""The Git Explorer endpoint returns pull requests with commits, people, files and promises.

Runs only when TEST_DATABASE_URL points at a *_test database; everything is rolled back.
"""

import unittest

from sqlalchemy import text

from app.core.security import UserContext, get_current_user
from app.main import app
from tests import test_guardian_integration as base  # module import: keeps pytest from collecting its tests twice


class GitExplorerIntegrationTests(unittest.TestCase):
    # Same isolated database setup and seed data (user uid-1 with access to org/shop, PR #42).
    setUpClass = classmethod(base.GuardianIntegrationTests.setUpClass.__func__)
    setUp = base.GuardianIntegrationTests.setUp
    tearDown = base.GuardianIntegrationTests.tearDown
    _seed = base.GuardianIntegrationTests._seed

    def _as(self, sub):
        app.dependency_overrides[get_current_user] = lambda: UserContext(sub=sub, email="a@example.com")

    def test_returns_pull_requests_with_commits_and_people(self):
        s = self.session
        pr_id = s.execute(
            text("SELECT id FROM pull_requests WHERE repo_id = :r AND github_pr_number = 42"), {"r": self.repo_id}
        ).scalar()
        s.execute(
            text("UPDATE pull_requests SET base_branch = 'main', head_branch = 'fix/webhooks' WHERE id = :p"), {"p": pr_id}
        )
        s.execute(
            text(
                """
                INSERT INTO commits (repo_id, pr_id, github_sha, message, author_name, committed_at)
                VALUES (:r, :p, 'abc1234def', E'Store event ids\\n\\nLonger body', 'Alice', NOW() - INTERVAL '31 days'),
                       (:r, NULL, 'fff0000aaa', 'Direct push to main', 'Bob', NOW() - INTERVAL '2 days')
                """
            ),
            {"r": self.repo_id, "p": pr_id},
        )
        s.execute(
            text("INSERT INTO pr_participants (repo_id, pr_id, login, role, interactions) VALUES (:r, :p, 'bob', 'reviewer', 3)"),
            {"r": self.repo_id, "p": pr_id},
        )
        s.commit()

        self._as("uid-1")
        response = self.client.get(f"/api/knowledge/repositories/{self.repo_id}/git-explorer")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["repository"]["default_branch"], "main")

        pr = next(item for item in body["pull_requests"] if item["github_pr_number"] == 42)
        self.assertEqual(pr["head_branch"], "fix/webhooks")
        self.assertEqual(pr["commit_count"], 1)
        self.assertIsNotNone(pr["first_commit_at"])
        self.assertIn({"login": "bob", "role": "reviewer", "interactions": 3}, pr["participants"])
        self.assertEqual(pr["intent"], "Providers retry webhooks, so handling must be idempotent.")
        self.assertIsInstance(pr["files"], list)

        messages = {commit["github_sha"]: commit for commit in body["commits"]}
        self.assertEqual(messages["abc1234def"]["message"], "Store event ids")  # first line only
        self.assertEqual(messages["abc1234def"]["github_pr_number"], 42)
        self.assertIsNone(messages["fff0000aaa"]["github_pr_number"])

    def test_requires_repository_access(self):
        self._as("uid-stranger")
        response = self.client.get(f"/api/knowledge/repositories/{self.repo_id}/git-explorer")
        self.assertIn(response.status_code, (403, 404))
