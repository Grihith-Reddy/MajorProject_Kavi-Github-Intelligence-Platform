import asyncio
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from app.core.middleware import RateLimitMiddleware, RequestSizeLimitMiddleware
from app.core.security import create_oauth_state, verify_jwt_token, verify_oauth_state
from app.core.settings import settings
from app.api.chat import ChatQuery
from app.api.ingestion import SyncRequest
from app.services.ai_service import AIService


class RequestSizeLimitTests(unittest.TestCase):
    def run_request(self, chunks, *, content_length=None, maximum=8):
        messages = [
            {
                "type": "http.request",
                "body": chunk,
                "more_body": index < len(chunks) - 1,
            }
            for index, chunk in enumerate(chunks)
        ]
        message_index = 0
        response_messages = []
        app_bodies = []

        async def receive():
            nonlocal message_index
            message = messages[message_index]
            message_index += 1
            return message

        async def send(message):
            response_messages.append(message)

        async def app(scope, app_receive, app_send):
            body = bytearray()
            while True:
                message = await app_receive()
                body.extend(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            app_bodies.append(bytes(body))
            await app_send({"type": "http.response.start", "status": 200, "headers": []})
            await app_send({"type": "http.response.body", "body": b"ok"})

        headers = []
        if content_length is not None:
            headers.append((b"content-length", str(content_length).encode("ascii")))
        scope = {"type": "http", "method": "POST", "path": "/", "headers": headers}

        with patch.object(settings, "MAX_REQUEST_BODY_BYTES", maximum):
            asyncio.run(RequestSizeLimitMiddleware(app)(scope, receive, send))

        return response_messages[0]["status"], app_bodies

    def test_rejects_oversized_chunked_body_before_application(self):
        status_code, app_bodies = self.run_request([b"1234", b"56789"])

        self.assertEqual(status_code, 413)
        self.assertEqual(app_bodies, [])

    def test_allows_body_within_limit(self):
        status_code, app_bodies = self.run_request([b"1234", b"5678"], content_length=8)

        self.assertEqual(status_code, 200)
        self.assertEqual(app_bodies, [b"12345678"])

    def test_rejects_invalid_content_length(self):
        status_code, app_bodies = self.run_request([b""], content_length="invalid")

        self.assertEqual(status_code, 400)
        self.assertEqual(app_bodies, [])


class AuthenticationAndOutboundSecretTests(unittest.TestCase):
    def test_firebase_verification_checks_revocation(self):
        app = object()
        with (
            patch("app.core.security._get_firebase_app", return_value=app),
            patch(
                "app.core.security.firebase_auth.verify_id_token",
                return_value={"uid": "user-1"},
            ) as verify,
        ):
            payload = verify_jwt_token("firebase-token")

        self.assertEqual(payload["uid"], "user-1")
        verify.assert_called_once_with("firebase-token", app=app, check_revoked=True)

    def test_oauth_state_is_signed_and_tampering_is_rejected(self):
        with patch.object(settings, "GITHUB_STATE_SECRET", "state-secret-for-tests-at-least-32-bytes"):
            state, _, _ = create_oauth_state()

            self.assertTrue(verify_oauth_state(state))
            with self.assertRaises(HTTPException) as context:
                verify_oauth_state(f"{state}tampered")
        self.assertEqual(context.exception.status_code, 400)

    def test_gemini_api_key_is_sent_in_header_not_url(self):
        service = AIService()
        response = unittest.mock.Mock()
        response.status_code = 200
        response.json.return_value = {
            "candidates": [{"content": {"parts": [{"text": "safe response"}]}}]
        }

        with (
            patch.object(settings, "AI_API_KEY", "unit-test-key"),
            patch.object(settings, "AI_MODEL", "gemini-test"),
            patch("app.services.ai_service.requests.post", return_value=response) as post,
            patch("app.services.ai_service.ai_circuit_breaker.before_request"),
            patch("app.services.ai_service.ai_circuit_breaker.record_success"),
        ):
            result = service._call_gemini("test prompt", 0.1, 100)

        self.assertEqual(result, "safe response")
        request_url = post.call_args.args[0]
        self.assertNotIn("unit-test-key", request_url)
        self.assertNotIn("key=", request_url)
        self.assertEqual(post.call_args.kwargs["headers"]["x-goog-api-key"], "unit-test-key")

    def test_gemini_model_discovery_uses_secret_header(self):
        service = AIService()
        response = unittest.mock.Mock()
        response.status_code = 200
        response.json.return_value = {
            "models": [
                {
                    "name": "models/gemini-2.5-flash",
                    "supportedGenerationMethods": ["generateContent"],
                }
            ]
        }

        with (
            patch.object(settings, "AI_API_KEY", "unit-test-key"),
            patch.object(AIService, "_model_discovery_attempted", False),
            patch("app.services.ai_service.requests.get", return_value=response) as get,
        ):
            model_name = service._discover_supported_model()

        self.assertEqual(model_name, "gemini-2.5-flash")
        self.assertNotIn("unit-test-key", get.call_args.args[0])
        self.assertEqual(get.call_args.kwargs["headers"]["x-goog-api-key"], "unit-test-key")

    def test_external_input_models_reject_oversized_and_malformed_values(self):
        with self.assertRaises(ValueError):
            ChatQuery(repo_id="repo-1", query=" ")
        with self.assertRaises(ValueError):
            ChatQuery(repo_id="repo-1", query="x" * 4001)
        with self.assertRaises(ValueError):
            SyncRequest(repo_full_name="../sensitive")

    def test_rate_limit_key_does_not_change_with_rotating_bearer_tokens(self):
        def request_for(token):
            scope = {
                "type": "http",
                "method": "GET",
                "path": "/api/knowledge",
                "headers": [(b"authorization", f"Bearer {token}".encode())],
                "client": ("192.0.2.10", 1234),
                "server": ("testserver", 80),
                "scheme": "http",
                "query_string": b"",
            }
            return Request(scope)

        middleware = object.__new__(RateLimitMiddleware)

        self.assertEqual(
            middleware._request_key(request_for("token-a")),
            middleware._request_key(request_for("token-b")),
        )


if __name__ == "__main__":
    unittest.main()
