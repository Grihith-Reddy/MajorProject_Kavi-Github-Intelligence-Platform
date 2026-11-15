import math
import unittest
from unittest.mock import MagicMock, patch

from app.services import embedding_service
from app.services.embedding_service import (
    LOCAL_MODEL,
    cosine,
    entry_embedding_text,
    local_embedding,
    reciprocal_rank_fusion,
    semantic_search,
)


class LocalEmbeddingTests(unittest.TestCase):
    def test_vectors_are_normalised_and_deterministic(self):
        first = local_embedding("Retry failed payment webhooks")
        second = local_embedding("Retry failed payment webhooks")
        self.assertEqual(first, second)
        self.assertAlmostEqual(math.sqrt(sum(v * v for v in first)), 1.0, places=6)

    def test_related_text_scores_higher_than_unrelated(self):
        query = local_embedding("payment webhook retries")
        related = local_embedding("Retry failed payment webhooks with backoff")
        unrelated = local_embedding("Update README badges and logo")
        self.assertGreater(cosine(query, related), cosine(query, unrelated))

    def test_camel_case_identifiers_are_split(self):
        query = local_embedding("rate limit middleware")
        code = local_embedding("RateLimitMiddleware tracks requests per window")
        self.assertGreater(cosine(query, code), 0.2)


class FusionTests(unittest.TestCase):
    def test_items_found_by_multiple_rankers_win(self):
        fused = reciprocal_rank_fusion([["a", "b", "c"], ["c", "a"], ["c"]])
        self.assertEqual([item for item, _ in fused][:2], ["c", "a"])

    def test_cosine_handles_mismatched_vectors(self):
        self.assertEqual(cosine([1.0, 0.0], [1.0]), 0.0)
        self.assertEqual(cosine([], []), 0.0)


class EntryTextTests(unittest.TestCase):
    def test_includes_pr_decisions_and_files(self):
        text_value = entry_embedding_text(
            {
                "github_pr_number": 12,
                "pr_title": "Add retries",
                "summary": "Adds retries to the webhook handler.",
                "intent": "Avoid lost payments.",
                "decisions": ["Use exponential backoff"],
                "tags": ["payments"],
                "file_paths": ["app/webhooks.py"],
            }
        )
        self.assertIn("PR #12", text_value)
        self.assertIn("exponential backoff", text_value)
        self.assertIn("app/webhooks.py", text_value)


class SemanticSearchTests(unittest.TestCase):
    def test_returns_empty_when_schema_is_missing(self):
        db = MagicMock()
        db.execute.side_effect = Exception("column embedding does not exist")
        self.assertEqual(semantic_search(db, "repo", "anything"), [])
        db.rollback.assert_called()

    def test_ranks_stored_vectors_with_the_repository_model(self):
        db = MagicMock()
        stored = [
            ("entry-payments", local_embedding("retry failed payment webhooks")),
            ("entry-docs", local_embedding("update readme badges")),
        ]
        with patch.object(embedding_service, "repo_embedding_model", return_value=LOCAL_MODEL), patch.object(
            embedding_service, "_load_repo_vectors", return_value=stored
        ):
            results = semantic_search(db, "repo", "payment webhook retries", limit=2)
        self.assertEqual(results[0][0], "entry-payments")


if __name__ == "__main__":
    unittest.main()
