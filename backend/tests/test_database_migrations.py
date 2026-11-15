import os
import unittest
from pathlib import Path

import psycopg2


class DatabaseMigrationTests(unittest.TestCase):
    def test_migrations_apply_and_rollback_in_order(self):
        database_url = os.getenv("TEST_DATABASE_URL")
        if not database_url:
            self.skipTest("TEST_DATABASE_URL must point to a dedicated test database")

        migration_dir = Path(__file__).resolve().parents[2] / "database" / "migrations"
        up_migrations = [
            "001_init.sql",
            "002_access_control_and_sync_jobs.sql",
            "003_chat_memory.sql",
            "004_github_oauth_states.sql",
            "005_kavi_intelligence.sql",
        ]
        down_migrations = [
            "005_kavi_intelligence_down.sql",
            "004_github_oauth_states_down.sql",
            "003_chat_memory_down.sql",
            "002_access_control_and_sync_jobs_down.sql",
            "001_init_down.sql",
        ]

        connection = psycopg2.connect(database_url)
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_database()")
                if not cursor.fetchone()[0].endswith("_test"):
                    self.fail("Refusing to run destructive migration tests outside a *_test database")

                for migration_name in up_migrations:
                    cursor.execute((migration_dir / migration_name).read_text(encoding="utf-8-sig"))

                cursor.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                    """
                )
                created_tables = {row[0] for row in cursor.fetchall()}
                self.assertTrue(
                    {"users", "repositories", "repository_access", "sync_jobs",
                     "chat_conversations", "chat_messages", "chat_memory_items"}
                    .issubset(created_tables)
                )
                self.assertIn("github_oauth_states", created_tables)
                self.assertTrue(
                    {"pr_participants", "pr_promises", "blame_cache", "kavi_tokens",
                     "guardian_reviews", "eval_runs"}.issubset(created_tables)
                )

                for migration_name in down_migrations:
                    cursor.execute((migration_dir / migration_name).read_text(encoding="utf-8-sig"))

                cursor.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                    """
                )
                remaining_tables = {row[0] for row in cursor.fetchall()}
                self.assertFalse(
                    {"users", "repositories", "repository_access", "sync_jobs",
                     "chat_conversations", "chat_messages", "chat_memory_items"}
                    .intersection(remaining_tables)
                )
                self.assertNotIn("github_oauth_states", remaining_tables)
                self.assertNotIn("pr_promises", remaining_tables)

                for migration_name in up_migrations:
                    cursor.execute((migration_dir / migration_name).read_text(encoding="utf-8-sig"))

                cursor.execute(
                    "SELECT to_regclass('public.chat_memory_items'), to_regclass('public.users')"
                )
                self.assertEqual(cursor.fetchone(), ("chat_memory_items", "users"))
        finally:
            connection.rollback()
            connection.close()


if __name__ == "__main__":
    unittest.main()
