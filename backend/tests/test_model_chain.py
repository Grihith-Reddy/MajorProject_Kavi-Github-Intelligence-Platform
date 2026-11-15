import time
import unittest
from unittest.mock import MagicMock, patch

from app.services import ai_service
from app.services.ai_service import AIService, gemini_model_chain, is_quota_exhausted, mark_model_exhausted


class ModelChainTests(unittest.TestCase):
    def setUp(self):
        ai_service._model_exhausted_until.clear()

    def tearDown(self):
        ai_service._model_exhausted_until.clear()

    def test_primary_first_then_fallbacks_without_duplicates(self):
        with patch.object(ai_service.settings, "AI_FALLBACK_MODELS", "gemini-flash-latest, models/gemini-2.5-flash,gemini-flash-lite-latest"):
            self.assertEqual(gemini_model_chain("gemini-2.5-flash"), ["gemini-2.5-flash", "gemini-flash-latest", "gemini-flash-lite-latest"])

    def test_exhausted_models_are_skipped_until_cooldown(self):
        with patch.object(ai_service.settings, "AI_FALLBACK_MODELS", "b,c"):
            mark_model_exhausted("a")
            self.assertEqual(gemini_model_chain("a"), ["b", "c"])
            ai_service._model_exhausted_until["a"] = time.time() - 1
            self.assertEqual(gemini_model_chain("a"), ["a", "b", "c"])

    def test_quota_detection(self):
        self.assertTrue(is_quota_exhausted(429, '{"error": {"status": "RESOURCE_EXHAUSTED", "message": "You exceeded your current quota"}}'))
        self.assertFalse(is_quota_exhausted(503, "overloaded"))

    def test_call_falls_back_to_next_model_on_quota(self):
        quota = MagicMock(status_code=429, text='{"error": {"message": "You exceeded your current quota"}}')
        ok = MagicMock(status_code=200, text="{}")
        ok.json.return_value = {"candidates": [{"content": {"parts": [{"text": "hello"}]}}]}
        calls = []

        def fake_post(url, **kwargs):
            calls.append(url)
            return quota if "gemini-2.5-flash:" in url else ok

        with patch.object(ai_service.settings, "AI_API_KEY", "k"), patch.object(ai_service.settings, "AI_MODEL", "gemini-2.5-flash"), patch.object(
            ai_service.settings, "AI_FALLBACK_MODELS", "gemini-flash-latest"
        ), patch.object(ai_service.requests, "post", side_effect=fake_post), patch.object(AIService, "_resolved_model_name", None):
            self.assertEqual(AIService()._call_gemini("hi", temperature=0, max_output_tokens=10), "hello")
        self.assertIn("gemini-flash-latest", calls[-1])
        self.assertIn("gemini-2.5-flash", ai_service._model_exhausted_until)


if __name__ == "__main__":
    unittest.main()
