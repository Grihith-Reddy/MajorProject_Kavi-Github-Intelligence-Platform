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
    "006_impact_and_feedback.sql",
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

    def test_promise_is_marked_kept_by_a_later_pr(self):
        from app.services import embedding_service, promise_service
        from app.services.ai_service import AIService
        from app.services.embedding_service import LOCAL_MODEL, local_embedding

        s = self.session
        early_pr = s.execute(text("SELECT id FROM pull_requests WHERE github_pr_number = 42")).scalar()
        s.execute(
            text(
                """
                INSERT INTO pr_promises (repo_id, pr_id, signature, quote, kind, source, made_at)
                VALUES (:r, :p, 'sig1', 'I will add a retention policy for the webhook ledger table in a follow-up', 'follow_up', 'comment', NOW() - INTERVAL '29 days')
                """
            ),
            {"r": self.repo_id, "p": early_pr},
        )
        later_pr = s.execute(
            text(
                """
                INSERT INTO pull_requests (repo_id, github_pr_id, github_pr_number, title, state, merged_at)
                VALUES (:r, 101, 51, 'Add retention policy for webhook ledger', 'closed', NOW() - INTERVAL '5 days') RETURNING id
                """
            ),
            {"r": self.repo_id},
        ).scalar()
        summary = "Adds a retention policy that deletes webhook ledger rows older than 90 days."
        s.execute(
            text(
                """
                INSERT INTO knowledge_entries (repo_id, pr_id, summary, intent, embedding, embedding_model)
                VALUES (:r, :p, :s, 'Keep the webhook ledger table small with a retention policy.', CAST(:e AS real[]), :m)
                """
            ),
            {
                "r": self.repo_id,
                "p": later_pr,
                "s": summary,
                "e": local_embedding("PR #51: Add retention policy for webhook ledger\n" + summary),
                "m": LOCAL_MODEL,
            },
        )
        s.commit()

        from unittest.mock import patch as _patch

        with _patch.object(promise_service, "preferred_model", return_value=LOCAL_MODEL), _patch.object(
            embedding_service, "preferred_model", return_value=LOCAL_MODEL
        ), _patch.object(AIService, "_can_use_gemini", return_value=False):
            result = promise_service.resolve_promises(s, self.repo_id, AIService())

        self.assertEqual(result["newly_kept"], 1)
        row = s.execute(
            text(
                "SELECT p.status, pr.github_pr_number FROM pr_promises p JOIN pull_requests pr ON pr.id = p.resolved_pr_id WHERE p.signature = 'sig1'"
            )
        ).mappings().one()
        self.assertEqual((row["status"], row["github_pr_number"]), ("kept", 51))

    def test_mcp_endpoints_resolve_repo_by_name_and_search_memory(self):
        from app.core.tokens import create_token

        token = create_token(self.session, user_id=str(self.user_id), scope="mcp", repo_id=None, label="editor")["token"]
        headers = {"Authorization": f"Bearer {token}"}
        repos = self.client.get("/api/mcp/repositories", headers=headers)
        self.assertEqual(repos.status_code, 200, repos.text)
        self.assertEqual([r["full_name"] for r in repos.json()["repositories"]], ["org/shop"])

        search = self.client.get("/api/mcp/search", params={"repo": "ORG/shop", "q": "idempotent webhooks"}, headers=headers)
        self.assertEqual(search.status_code, 200, search.text)
        self.assertEqual(search.json()["results"][0]["pr_number"], 42)

        pr = self.client.get("/api/mcp/pull-request", params={"repo": "org/shop", "number": 42}, headers=headers)
        self.assertEqual(pr.json()["decisions"], ["Use the provider event id as the idempotency key"])

        missing = self.client.get("/api/mcp/search", params={"repo": "org/other", "q": "x"}, headers=headers)
        self.assertEqual(missing.status_code, 404)
        guardian = self._create_guardian_token()
        self.assertEqual(self.client.get("/api/mcp/repositories", headers={"Authorization": f"Bearer {guardian}"}).status_code, 401)

    def _seed_more_prs(self):
        from app.services.embedding_service import LOCAL_MODEL, local_embedding

        topics = [
            ("Add Redis session cache", "Cache user sessions in Redis to cut database load on every request.", "app/cache/session.py", "bob"),
            ("Switch auth to Firebase", "Replace hand-rolled JWT auth with Firebase to get revocation and MFA.", "app/auth/firebase.py", "alice"),
            ("Paginate order history", "Order history pages timed out for large accounts, so results are paginated.", "app/orders/history.py", "alice"),
            ("Rate limit login attempts", "Brute-force attempts on login are throttled per IP to protect accounts.", "app/auth/limits.py", "alice"),
            ("Move images to CDN", "Product images are served from a CDN to speed up the storefront.", "web/static/images.ts", "carol"),
        ]
        for index, (title, intent, path, author) in enumerate(topics, start=60):
            pr_id = self.session.execute(
                text(
                    """
                    INSERT INTO pull_requests (repo_id, github_pr_id, github_pr_number, title, state, merged_at, author_login)
                    VALUES (:r, :gid, :n, :t, 'closed', NOW() - make_interval(days => :d), :a) RETURNING id
                    """
                ),
                {"r": self.repo_id, "gid": 1000 + index, "n": index, "t": title, "d": 70 - index, "a": author},
            ).scalar()
            entry_id = self.session.execute(
                text(
                    """
                    INSERT INTO knowledge_entries (repo_id, pr_id, summary, intent, embedding, embedding_model)
                    VALUES (:r, :p, :s, :i, CAST(:e AS real[]), :m) RETURNING id
                    """
                ),
                {"r": self.repo_id, "p": pr_id, "s": f"{title}. {intent}", "i": intent, "e": local_embedding(f"{title}\n{intent}"), "m": LOCAL_MODEL},
            ).scalar()
            self.session.execute(
                text(
                    "INSERT INTO file_mappings (repo_id, knowledge_entry_id, file_path, start_line, end_line) VALUES (:r, :k, :f, 1, 20)"
                ),
                {"r": self.repo_id, "k": entry_id, "f": path},
            )
            self.session.execute(
                text("INSERT INTO pr_participants (repo_id, pr_id, login, role) VALUES (:r, :p, :a, 'author')"),
                {"r": self.repo_id, "p": pr_id, "a": author},
            )
        self.session.commit()

    def test_knowledge_map_reports_modules_and_single_experts(self):
        from app.services.map_service import build_knowledge_map

        self._seed_more_prs()
        result = build_knowledge_map(self.session, self.repo_id)
        modules = {m["id"]: m for m in result["modules"]}
        self.assertIn("app/auth", modules)
        self.assertEqual(modules["app/auth"]["pr_count"], 2)
        self.assertEqual(modules["app/auth"]["bus_factor"], 1)
        self.assertEqual(modules["app/auth"]["contributors"][0]["login"], "alice")
        self.assertIn(modules["app/auth"]["risk"], {"single_expert", "at_risk"})
        self.assertEqual(result["summary"]["module_count"], len(result["modules"]))

    def test_evaluation_run_scores_every_strategy(self):
        from unittest.mock import patch as _patch

        from app.services import embedding_service
        from app.services.ai_service import AIService
        from app.services.embedding_service import LOCAL_MODEL
        from app.services.eval_service import run_evaluation

        self._seed_more_prs()
        run_id = str(self.session.execute(text("INSERT INTO eval_runs (repo_id) VALUES (:r) RETURNING id"), {"r": self.repo_id}).scalar())
        self.session.commit()
        with _patch.object(AIService, "_can_use_gemini", return_value=False), _patch.object(
            embedding_service, "preferred_model", return_value=LOCAL_MODEL
        ):
            run_evaluation(self.session, self.repo_id, run_id)
        row = self.session.execute(text("SELECT status, metrics, error FROM eval_runs WHERE id = :id"), {"id": run_id}).mappings().one()
        self.assertEqual(row["status"], "completed", row["error"])
        metrics = row["metrics"]
        self.assertEqual(metrics["question_source"], "template")
        self.assertEqual(set(metrics["strategies"]), {"fulltext", "lexical", "semantic", "hybrid"})
        self.assertGreater(metrics["strategies"]["hybrid"]["recall@5"], 0.5)

    def _seed_co_changes(self):
        for index, (author, reviewer) in enumerate([("alice", "bob"), ("alice", "carol"), ("bob", "alice")], start=200):
            pr_id = self.session.execute(
                text(
                    """
                    INSERT INTO pull_requests (repo_id, github_pr_id, github_pr_number, title, state, merged_at, author_login)
                    VALUES (:r, :g, :n, :t, 'closed', NOW() - make_interval(days => :d), :a) RETURNING id
                    """
                ),
                {"r": self.repo_id, "g": 5000 + index, "n": index, "t": f"Session change {index}", "d": 210 - index, "a": author},
            ).scalar()
            entry_id = self.session.execute(
                text("INSERT INTO knowledge_entries (repo_id, pr_id, summary, intent) VALUES (:r, :p, 'Session work', 'Session work') RETURNING id"),
                {"r": self.repo_id, "p": pr_id},
            ).scalar()
            for path in ("app/auth/session.py", "db/migrations/sessions.sql"):
                self.session.execute(
                    text("INSERT INTO file_mappings (repo_id, knowledge_entry_id, file_path, start_line, end_line) VALUES (:r, :k, :f, 1, 9)"),
                    {"r": self.repo_id, "k": entry_id, "f": path},
                )
            for login, role in ((author, "author"), (reviewer, "reviewer")):
                self.session.execute(
                    text("INSERT INTO pr_participants (repo_id, pr_id, login, role, last_seen_at) VALUES (:r, :p, :l, :role, NOW() - INTERVAL '3 days')"),
                    {"r": self.repo_id, "p": pr_id, "l": login, "role": role},
                )
        self.session.commit()

    def test_impact_prediction_and_reviewer_suggestions(self):
        from app.services.impact_service import predict_change_impact, suggest_reviewers

        self._seed_co_changes()
        impact = predict_change_impact(self.session, self.repo_id, ["app/auth/session.py"])
        self.assertEqual(impact["likely_missing"][0]["path"], "db/migrations/sessions.sql")
        self.assertEqual(impact["likely_missing"][0]["support"], 3)
        self.assertEqual(impact["likely_missing"][0]["confidence"], 1.0)

        reviewers = suggest_reviewers(self.session, self.repo_id, ["app/auth/session.py"], author="alice")
        logins = [r["login"] for r in reviewers["reviewers"]]
        self.assertNotIn("alice", logins)
        self.assertEqual(logins[0], "bob")

    def test_guardian_comment_includes_co_change_and_reviewers(self):
        self._seed_co_changes()
        token = self._create_guardian_token()
        payload = {
            "pr_number": 300,
            "head_sha": "feedface",
            "title": "Extend session lifetime",
            "author": "carol",
            "files": [{"filename": "app/auth/session.py", "status": "modified", "patch": "@@ -1 +1 @@\n-TTL = 3600\n+TTL = 7200"}],
        }
        with patch("app.services.guardian_service.AIService._can_use_gemini", return_value=False):
            body = self.client.post("/api/guardian/review", json=payload, headers={"Authorization": f"Bearer {token}"}).json()
        self.assertEqual(body["verdict"], "heads_up")
        self.assertIn("Usually changes together", body["comment_markdown"])
        self.assertIn("db/migrations/sessions.sql", body["comment_markdown"])
        self.assertIn("Suggested reviewers", body["comment_markdown"])
        stored = self.session.execute(text("SELECT impact, reviewers FROM guardian_reviews WHERE pr_number = 300")).mappings().one()
        self.assertEqual(stored["impact"]["likely_missing"][0]["path"], "db/migrations/sessions.sql")
        self.assertTrue(stored["reviewers"]["reviewers"])

    def test_guardian_sync_queues_incremental_sync(self):
        from app.core import settings as settings_module

        token = self._create_guardian_token()
        with patch.object(settings_module.settings, "INLINE_SYNC_WORKER", False):
            response = self.client.post("/api/guardian/sync", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(response.status_code, 200, response.text)
        job = self.session.execute(
            text("SELECT repo_full_name, status FROM sync_jobs WHERE id = CAST(:id AS uuid)"), {"id": response.json()["job_id"]}
        ).mappings().one()
        self.assertEqual((job["repo_full_name"], job["status"]), ("org/shop", "queued"))
        self.assertEqual(self.client.post("/api/guardian/sync").status_code, 401)

    def test_tokens_are_stored_hashed(self):
        token = self._create_guardian_token()
        stored = self.session.execute(text("SELECT token_hash, token_prefix FROM kavi_tokens")).mappings().first()
        self.assertNotEqual(stored["token_hash"], token)
        self.assertTrue(token.startswith(stored["token_prefix"]))


if __name__ == "__main__":
    unittest.main()
