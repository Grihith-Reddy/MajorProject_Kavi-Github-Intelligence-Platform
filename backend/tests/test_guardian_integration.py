"""Integration test for tokens + Guardian against a real PostgreSQL test database.

Runs only when TEST_DATABASE_URL points at a *_test database (CI provides one).
Everything happens inside one transaction that is rolled back at the end.
"""

import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.main import app

MIGRATIONS = [
    "001_init.sql",
    "002_access_control_and_sync_jobs.sql",
    "003_chat_memory.sql",
    "004_github_oauth_states.sql",
    "005_kavi_intelligence.sql",
]


class GuardianIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = os.getenv("TEST_DATABASE_URL")
        if not url:
            raise unittest.SkipTest("TEST_DATABASE_URL must point to a dedicated test database")
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
        cls.engine = create_engine(url)

    def setUp(self):
        self.connection = self.engine.connect()
        self.outer = self.connection.begin()
        if not self.connection.execute(text("SELECT current_database()")).scalar().endswith("_test"):
            self.fail("Refusing to run outside a *_test database")
        migration_dir = Path(__file__).resolve().parents[2] / "database" / "migrations"
        for name in MIGRATIONS:
            self.connection.exec_driver_sql((migration_dir / name).read_text(encoding="utf-8-sig"))
        self.session = Session(bind=self.connection, join_transaction_mode="create_savepoint")
        app.dependency_overrides[get_db] = lambda: self.session
        self.client = TestClient(app)
        self._seed()

    def tearDown(self):
        app.dependency_overrides.clear()
        self.session.close()
        self.outer.rollback()
        self.connection.close()

    def _seed(self):
        s = self.session
        self.user_id = s.execute(text("INSERT INTO users (auth0_sub, email) VALUES ('uid-1', 'a@example.com') RETURNING id")).scalar()
        account_id = s.execute(
            text(
                """
                INSERT INTO github_accounts (user_id, github_user_id, username, access_token_encrypted, authorization_type)
                VALUES (:u, 1, 'octo', 'x', 'github_app') RETURNING id
                """
            ),
            {"u": self.user_id},
        ).scalar()
        self.repo_id = str(
            s.execute(
                text(
                    """
                    INSERT INTO repositories (github_repo_id, owner, name, full_name, default_branch)
                    VALUES (10, 'org', 'shop', 'org/shop', 'main') RETURNING id
                    """
                )
            ).scalar()
        )
        s.execute(
            text("INSERT INTO repository_access (repository_id, github_account_id) VALUES (:r, :a)"),
            {"r": self.repo_id, "a": account_id},
        )
        pr_id = s.execute(
            text(
                """
                INSERT INTO pull_requests (repo_id, github_pr_id, github_pr_number, title, state, merged_at, author_login, url)
                VALUES (:r, 100, 42, 'Make webhook handling idempotent', 'closed', NOW() - INTERVAL '30 days', 'alice', 'https://github.com/org/shop/pull/42')
                RETURNING id
                """
            ),
            {"r": self.repo_id},
        ).scalar()
        entry_id = s.execute(
            text(
                """
                INSERT INTO knowledge_entries (repo_id, pr_id, summary, intent, decisions, risks, tags)
                VALUES (:r, :p, 'Stores event ids before applying webhooks.', 'Providers retry webhooks, so handling must be idempotent.',
                        CAST(:d AS jsonb), CAST('[]' AS jsonb), ARRAY['payments'])
                RETURNING id
                """
            ),
            {"r": self.repo_id, "p": pr_id, "d": json.dumps(["Use the provider event id as the idempotency key"])},
        ).scalar()
        s.execute(
            text(
                """
                INSERT INTO file_mappings (repo_id, knowledge_entry_id, file_path, start_line, end_line, confidence)
                VALUES (:r, :k, 'app/webhooks.py', 10, 40, 0.6)
                """
            ),
            {"r": self.repo_id, "k": entry_id},
        )
        s.commit()

    def _create_guardian_token(self) -> str:
        from app.core.tokens import create_token

        return create_token(self.session, user_id=str(self.user_id), scope="guardian", repo_id=self.repo_id, label="ci")["token"]

    def test_guardian_reviews_with_history_and_stores_result(self):
        token = self._create_guardian_token()
        payload = {
            "pr_number": 77,
            "head_sha": "abc123",
            "title": "Process webhooks directly",
            "body": "Removes the ledger lookup to speed things up.",
            "files": [{"filename": "app/webhooks.py", "status": "modified", "patch": "@@ -10,5 +10,2 @@\n-    if ledger.seen(event.id):\n-        return ok()"}],
        }
        with patch("app.services.guardian_service.AIService._can_use_gemini", return_value=False):
            response = self.client.post("/api/guardian/review", json=payload, headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["verdict"], "heads_up")
        self.assertEqual(body["history_checked"], [42])
        self.assertIn("<!-- kavi-guardian -->", body["comment_markdown"])
        self.assertIn("#42", body["comment_markdown"])
        stored = self.session.execute(text("SELECT verdict FROM guardian_reviews WHERE pr_number = 77")).scalar()
        self.assertEqual(stored, "heads_up")

    def test_guardian_rejects_missing_wrong_scope_and_revoked_tokens(self):
        from app.core.tokens import create_token, revoke_token

        payload = {"pr_number": 1, "title": "x", "files": []}
        self.assertEqual(self.client.post("/api/guardian/review", json=payload).status_code, 401)
        mcp = create_token(self.session, user_id=str(self.user_id), scope="mcp", repo_id=None, label=None)
        self.assertEqual(
            self.client.post("/api/guardian/review", json=payload, headers={"Authorization": f"Bearer {mcp['token']}"}).status_code,
            401,
        )
        guardian = create_token(self.session, user_id=str(self.user_id), scope="guardian", repo_id=self.repo_id, label=None)
        revoke_token(self.session, user_id=str(self.user_id), token_id=str(guardian["id"]))
        self.assertEqual(
            self.client.post("/api/guardian/review", json=payload, headers={"Authorization": f"Bearer {guardian['token']}"}).status_code,
            401,
        )

    def test_tokens_are_stored_hashed(self):
        token = self._create_guardian_token()
        stored = self.session.execute(text("SELECT token_hash, token_prefix FROM kavi_tokens")).mappings().first()
        self.assertNotEqual(stored["token_hash"], token)
        self.assertTrue(token.startswith(stored["token_prefix"]))


if __name__ == "__main__":
    unittest.main()
