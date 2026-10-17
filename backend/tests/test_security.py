import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import jwt
from app import _is_weak_secret
from config import get_settings
from fastapi import HTTPException
from routes_fastapi.deps import ACCESS_COOKIE_NAME, get_bearer_token, get_current_user, issue_token, require_roles
from services.admin_helpers import _generate_temporary_password
from utils import security_utils
from utils.validators import validate_password


class PasswordSecurityTests(unittest.TestCase):
    def test_rejects_predictable_jwt_secrets(self):
        self.assertTrue(_is_weak_secret("12345678901234567890123456789012345"))
        self.assertTrue(_is_weak_secret("a" * 32))
        self.assertFalse(_is_weak_secret("R7q!C2m#K9v$L4x@N8p%T3w^Y6d&F1h*"))

    def test_passwords_are_one_way_argon2_hashes(self):
        """Sprint 4, the original implementation plan: new hashes are argon2id, not bcrypt."""
        stored = security_utils.hash_password("CorrectHorse@2026")

        self.assertTrue(security_utils.is_argon2_hash(stored))
        self.assertTrue(security_utils.is_password_hash(stored))
        self.assertFalse(security_utils.needs_password_rehash(stored))
        self.assertNotIn("CorrectHorse@2026", stored)
        self.assertTrue(security_utils.verify_password("CorrectHorse@2026", stored))
        self.assertFalse(security_utils.verify_password("wrong", stored))
        self.assertEqual("", security_utils.decrypt_password(stored))

    def test_legacy_bcrypt_hashes_still_verify_and_flag_for_rehash(self):
        """An account created before Sprint 4 has a bcrypt hash — it must
        still be able to log in, and `needs_password_rehash` must say yes
        so `AuthService.authenticate` upgrades it to argon2id on that
        successful login (see `services/auth_service.py`)."""
        import bcrypt

        legacy_bcrypt_hash = bcrypt.hashpw(b"OldPassword@2020", bcrypt.gensalt(rounds=12)).decode("utf-8")

        self.assertTrue(security_utils.is_bcrypt_hash(legacy_bcrypt_hash))
        self.assertTrue(security_utils.is_password_hash(legacy_bcrypt_hash))
        self.assertTrue(security_utils.verify_password("OldPassword@2020", legacy_bcrypt_hash))
        self.assertFalse(security_utils.verify_password("wrong", legacy_bcrypt_hash))
        self.assertTrue(security_utils.needs_password_rehash(legacy_bcrypt_hash))

    def test_legacy_ciphertext_can_be_verified_for_migration(self):
        original_secret = os.environ.get("SECRET_KEY")
        os.environ["SECRET_KEY"] = "test-secret-with-at-least-thirty-two-characters"
        get_settings.cache_clear()
        try:
            legacy = security_utils._legacy_fernet().encrypt(b"Legacy@2026").decode("utf-8")
            self.assertTrue(security_utils.verify_password("Legacy@2026", legacy))
            self.assertTrue(security_utils.needs_password_rehash(legacy))
        finally:
            get_settings.cache_clear()
            if original_secret is None:
                os.environ.pop("SECRET_KEY", None)
            else:
                os.environ["SECRET_KEY"] = original_secret

    def test_generated_temporary_password_is_strong_and_unique(self):
        first = _generate_temporary_password()
        second = _generate_temporary_password()

        self.assertNotEqual(first, second)
        self.assertTrue(validate_password(first)[0])
        self.assertTrue(validate_password(second)[0])


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

    def test_temporary_password_session_is_limited_to_password_change(self):
        secret = "test-secret-with-at-least-thirty-two-characters"
        token = issue_token("user-1", secret, session_version=2)
        user = {
            "_id": "user-1",
            "session_version": 2,
            "is_active": True,
            "must_change_password": True,
        }

        dashboard_request = SimpleNamespace(
            app=SimpleNamespace(state=SimpleNamespace(secret_key=secret, app_id="canvas-grade")),
            url=SimpleNamespace(path="/dashboard"),
        )
        with patch("routes_fastapi.deps.load_authenticated_user", new=AsyncMock(return_value=user)):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(get_current_user(request=dashboard_request, token=token, db=object()))
        self.assertEqual(403, raised.exception.status_code)

        change_request = SimpleNamespace(
            app=SimpleNamespace(state=SimpleNamespace(secret_key=secret, app_id="canvas-grade")),
            url=SimpleNamespace(path="/change-password"),
        )
        with patch("routes_fastapi.deps.load_authenticated_user", new=AsyncMock(return_value=user)):
            current_user = asyncio.run(get_current_user(request=change_request, token=token, db=object()))
        self.assertEqual("user-1", current_user["_id"])


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
