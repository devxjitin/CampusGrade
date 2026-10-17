import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import jwt
from app import _is_weak_secret
from fastapi import HTTPException
from routes_fastapi.deps import ACCESS_COOKIE_NAME, get_bearer_token, get_current_user, issue_token, require_roles


class SecretKeyTests(unittest.TestCase):
    def test_rejects_predictable_jwt_secrets(self):
        self.assertTrue(_is_weak_secret("12345678901234567890123456789012345"))
        self.assertTrue(_is_weak_secret("a" * 32))
        self.assertFalse(_is_weak_secret("R7q!C2m#K9v$L4x@N8p%T3w^Y6d&F1h*"))


class PasswordlessSignInGuardTests(unittest.TestCase):
    """Sign-in is by email only, so the app must refuse to run as a production deployment."""

    SECRET = "R7q!C2m#K9v$L4x@N8p%T3w^Y6d&F1h*"

    def test_production_is_refused(self):
        from config import Settings

        for env in ("production", "Production", "prod"):
            with self.assertRaisesRegex(ValueError, "not allowed"):
                Settings(_env_file=None, secret_key=self.SECRET, app_env=env)

    def test_development_and_test_are_allowed(self):
        from config import Settings

        for env in ("development", "test"):
            self.assertEqual(env, Settings(_env_file=None, secret_key=self.SECRET, app_env=env).app_env)


class AuthorizationPolicyTests(unittest.TestCase):
    def test_issued_tokens_include_the_current_session_version(self):
        secret = "test-secret-with-at-least-thirty-two-characters"
        token = issue_token("user-1", secret, session_version=3)

        payload = jwt.decode(token, secret, algorithms=["HS256"], issuer="canvas-grade", audience="canvas-grade")
        self.assertEqual("user-1", payload["user_id"])
        self.assertEqual(3, payload["session_version"])

    def test_token_is_rejected_after_its_session_version_changes(self):
        secret = "test-secret-with-at-least-thirty-two-characters"
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(secret_key=secret, app_id="canvas-grade")))
        token = issue_token("user-1", secret, session_version=1)

        with patch("routes_fastapi.deps.load_authenticated_user", new=AsyncMock(return_value={"_id": "user-1", "session_version": 2, "is_active": True})):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(get_current_user(request=request, token=token, db=object()))

        self.assertEqual(401, raised.exception.status_code)
        self.assertIn("no longer valid", raised.exception.detail)

    def test_required_role_rejects_wrong_role(self):
        dependency = require_roles("admin")
        with self.assertRaisesRegex(Exception, "403"):
            dependency(current_user={"role": "student"})

    def test_required_role_accepts_correct_role(self):
        dependency = require_roles("admin")
        user = {"role": "admin"}
        self.assertIs(user, dependency(current_user=user))


class CookieAuthTests(unittest.TestCase):
    """Sprint 6, the original implementation plan: `get_bearer_token` reads the
    httpOnly access cookie first, falls back to the `Authorization` header.
    None of this needs Docker/a database;
    `get_bearer_token` only looks at `request.cookies`/`request.headers`."""

    def test_prefers_the_access_cookie(self):
        request = SimpleNamespace(cookies={ACCESS_COOKIE_NAME: "cookie-token"}, headers={"Authorization": "Bearer header-token"})
        self.assertEqual("cookie-token", get_bearer_token(request))

    def test_falls_back_to_the_header_when_no_cookie_is_present(self):
        request = SimpleNamespace(cookies={}, headers={"Authorization": "Bearer header-token"})
        self.assertEqual("header-token", get_bearer_token(request))

    def test_no_cookie_and_no_header_is_rejected(self):
        request = SimpleNamespace(cookies={}, headers={})
        with self.assertRaises(HTTPException) as raised:
            get_bearer_token(request)
        self.assertEqual(401, raised.exception.status_code)


if __name__ == "__main__":
    unittest.main()
