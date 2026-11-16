"""Clearing chats removes only the caller's conversations in one repository.

Runs only when TEST_DATABASE_URL points at a *_test database; everything is rolled back.
"""

import unittest

from sqlalchemy import text

from app.core.security import UserContext, get_current_user
from app.main import app
from tests import test_guardian_integration as base  # module import: keeps pytest from collecting its tests twice


class ChatClearIntegrationTests(unittest.TestCase):
    # Same isolated database setup and seed data (user uid-1 with access to org/shop).
    setUpClass = classmethod(base.GuardianIntegrationTests.setUpClass.__func__)
    setUp = base.GuardianIntegrationTests.setUp
    tearDown = base.GuardianIntegrationTests.tearDown
    _seed = base.GuardianIntegrationTests._seed

    def _conversation(self, user_id, title):
        s = self.session
        conversation_id = s.execute(
            text("INSERT INTO chat_conversations (user_id, repo_id, title) VALUES (:u, :r, :t) RETURNING id"),
            {"u": user_id, "r": self.repo_id, "t": title},
        ).scalar()
        message_id = s.execute(
            text(
                """
                INSERT INTO chat_messages (conversation_id, user_id, repo_id, role, content)
                VALUES (:c, :u, :r, 'assistant', 'answer') RETURNING id
                """
            ),
            {"c": conversation_id, "u": user_id, "r": self.repo_id},
        ).scalar()
        s.execute(
            text("INSERT INTO chat_feedback (message_id, user_id, repo_id, rating) VALUES (:m, :u, :r, 1)"),
            {"m": message_id, "u": user_id, "r": self.repo_id},
        )
        return conversation_id

    def _as(self, sub):
        app.dependency_overrides[get_current_user] = lambda: UserContext(sub=sub, email="a@example.com")

    def test_clear_removes_only_own_chats_in_that_repository(self):
        s = self.session
        self._conversation(self.user_id, "one")
        self._conversation(self.user_id, "two")
        other_user = s.execute(text("INSERT INTO users (auth0_sub, email) VALUES ('uid-2', 'b@example.com') RETURNING id")).scalar()
        kept = self._conversation(other_user, "someone else's")
        s.execute(
            text(
                """
                INSERT INTO chat_memory_items (user_id, repo_id, memory_scope, kind, key, value)
                VALUES (:u, :r, 'repo', 'fact', 'k', 'v')
                """
            ),
            {"u": self.user_id, "r": self.repo_id},
        )
        s.commit()

        self._as("uid-1")
        response = self.client.delete("/api/chat/conversations", params={"repo_id": self.repo_id})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"deleted": 2})

        count = lambda sql: s.execute(text(sql), {"u": self.user_id}).scalar()
        self.assertEqual(count("SELECT COUNT(*) FROM chat_conversations WHERE user_id = :u"), 0)
        self.assertEqual(count("SELECT COUNT(*) FROM chat_messages WHERE user_id = :u"), 0)
        self.assertEqual(count("SELECT COUNT(*) FROM chat_feedback WHERE user_id = :u"), 0)
        self.assertEqual(count("SELECT COUNT(*) FROM chat_memory_items WHERE user_id = :u"), 0)
        self.assertEqual(s.execute(text("SELECT COUNT(*) FROM chat_conversations WHERE id = :c"), {"c": kept}).scalar(), 1)

    def test_clear_requires_repository_access(self):
        self._as("uid-stranger")
        response = self.client.delete("/api/chat/conversations", params={"repo_id": self.repo_id})
        self.assertIn(response.status_code, (403, 404))
        self.assertEqual(self.client.delete("/api/chat/conversations", params={"repo_id": "../x"}).status_code, 404)
