import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.main import ready


class _Result:
    def __init__(self, schema_state):
        self.schema_state = schema_state

    def mappings(self):
        return self

    def one(self):
        return self.schema_state


class _Database:
    def __init__(self, schema_state):
        self.schema_state = schema_state
        self.closed = False

    def execute(self, _statement):
        return _Result(self.schema_state)

    def close(self):
        self.closed = True


class ReadinessTests(unittest.TestCase):
    def test_ready_requires_all_application_tables(self):
        required_tables = (
            "users",
            "github_accounts",
            "github_oauth_states",
            "repositories",
            "repository_access",
            "knowledge_entries",
            "sync_jobs",
            "chat_conversations",
            "chat_messages",
            "chat_memory_items",
        )
        db = _Database({table: True for table in required_tables})

        with patch("app.main.SessionLocal", return_value=db):
            self.assertEqual(ready(), {"status": "ready"})

        self.assertTrue(db.closed)

    def test_ready_returns_service_unavailable_when_migrations_are_missing(self):
        db = _Database({"users": True, "sync_jobs": False})

        with patch("app.main.SessionLocal", return_value=db):
            with self.assertRaises(HTTPException) as raised:
                ready()

        self.assertEqual(raised.exception.status_code, 503)
        self.assertTrue(db.closed)


if __name__ == "__main__":
    unittest.main()
