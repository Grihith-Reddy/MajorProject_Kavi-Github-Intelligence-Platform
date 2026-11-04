import base64
import hashlib
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import jwt
from fastapi import HTTPException

from app.api.github import github_connect_url
from app.core.access import require_github_account
from app.core.security import create_oauth_state, decrypt_token, verify_oauth_state
from app.core.settings import settings
from app.core.security import UserContext
from app.services.github_service import exchange_code_for_token


class _Result:
    def fetchone(self):
        return ("user-id",)


class _ConnectDatabase:
    def __init__(self):
        self.calls = []

    def execute(self, statement, params=None):
        self.calls.append((str(statement), params))
        return _Result()

    def commit(self):
        pass


class _AccountResult:
    def mappings(self):
        return self

    def first(self):
        return {
            "id": "account-id",
            "username": "octocat",
            "access_token_encrypted": "encrypted",
            "token_scopes": "repo,read:user",
            "authorization_type": "legacy_oauth",
            "updated_at": None,
        }


class _AccountDatabase:
    def execute(self, _statement, _params):
        return _AccountResult()


class GitHubAppAuthorizationTests(unittest.TestCase):
    def test_state_uses_random_id_and_pkce_s256_challenge(self):
        state, verifier, challenge = create_oauth_state()

        payload = jwt.decode(state, settings.GITHUB_STATE_SECRET, algorithms=["HS256"])
        expected_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).decode("ascii").rstrip("=")

        self.assertEqual(verify_oauth_state(state), payload["jti"])
        self.assertEqual(len(challenge), 43)
        self.assertEqual(challenge, expected_challenge)
        self.assertNotIn("sub", payload)

    def test_state_rejects_tampering(self):
        state, _, _ = create_oauth_state()

        with self.assertRaises(HTTPException):
            verify_oauth_state(f"{state}tampered")

    def test_connect_url_uses_no_classic_scopes_and_persists_pkce_verifier(self):
        db = _ConnectDatabase()

        result = github_connect_url(UserContext(sub="firebase-user"), db)
        params = parse_qs(urlparse(result["url"]).query)

        self.assertNotIn("scope", params)
        self.assertEqual(params["code_challenge_method"], ["S256"])
        state_id = verify_oauth_state(params["state"][0])
        stored_state = next(call[1] for call in db.calls if call[1] and "state_id" in call[1])
        self.assertEqual(stored_state["state_id"], state_id)
        verifier = decrypt_token(stored_state["code_verifier_encrypted"])
        expected_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).decode("ascii").rstrip("=")
        self.assertEqual(params["code_challenge"], [expected_challenge])

    def test_legacy_classic_oauth_token_is_blocked_until_reauthorization(self):
        with self.assertRaises(HTTPException) as raised:
            require_github_account(_AccountDatabase(), "user-id")

        self.assertEqual(raised.exception.status_code, 409)

    @patch("app.services.github_service.requests.post")
    def test_token_exchange_sends_pkce_verifier(self, post):
        response = post.return_value
        response.status_code = 200
        response.json.return_value = {"access_token": "token"}

        result = exchange_code_for_token("authorization-code", "pkce-verifier")

        self.assertEqual(result, {"access_token": "token"})
        self.assertEqual(
            post.call_args.kwargs["data"]["code_verifier"],
            "pkce-verifier",
        )
        self.assertEqual(
            post.call_args.kwargs["data"]["client_id"],
            settings.GITHUB_CLIENT_ID,
        )


if __name__ == "__main__":
    unittest.main()
