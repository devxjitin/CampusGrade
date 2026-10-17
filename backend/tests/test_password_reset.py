"""Forgot / reset password (Sprint 4, S4-02/S4-03) and the email service (S4-01)."""

import asyncio
import datetime

import pytest
from sqlalchemy import create_engine, text

from tests.conftest import requires_docker

STRONG = "Br4nd-New-Pass!"


def _jobs(database_url, job_type="email.password_reset"):
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            return [row[0] for row in connection.execute(text("SELECT payload FROM jobs WHERE type = :t ORDER BY created_at"), {"t": job_type})]
    finally:
        engine.dispose()


def _clear(database_url):
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM jobs"))
        connection.execute(text("DELETE FROM password_reset_tokens"))
    engine.dispose()


def _token(database_url) -> str:
    from services.password_reset_service import raw_token_for

    return raw_token_for(_jobs(database_url)[-1]["token_id"])


@requires_docker
class TestForgotPassword:
    def test_unknown_and_known_email_get_the_same_answer(self, client, seed_user, database_url):
        _clear(database_url)
        seed_user(role="student", email="forgot-known@example.edu")

        known = client.post("/auth/forgot-password", json={"email": "forgot-known@example.edu"})
        unknown = client.post("/auth/forgot-password", json={"email": "nobody@example.edu"})

        assert known.status_code == unknown.status_code == 200
        assert known.json() == unknown.json()
        assert len(_jobs(database_url)) == 1  # only the real account gets a job

    def test_is_rate_limited(self, client, database_url):
        _clear(database_url)
        statuses = [client.post("/auth/forgot-password", json={"email": f"x{i}@example.edu"}).status_code for i in range(7)]
        assert statuses[:5] == [200] * 5
        assert 429 in statuses[5:]


@requires_docker
class TestResetPassword:
    def test_reset_sets_password_revokes_sessions_and_token_is_single_use(self, client, seed_user, database_url):
        _clear(database_url)
        user = seed_user(role="student", email="reset-me@example.edu")
        assert client.post("/login", json={"email": user["email"], "password": user["password"]}).status_code == 200
        assert client.get("/auth/me").status_code == 200

        client.post("/auth/forgot-password", json={"email": user["email"]})
        token = _token(database_url)
        done = client.post("/auth/reset-password", json={"token": token, "new_password": STRONG})
        assert done.status_code == 200

        # the session that existed before the reset is gone
        assert client.get("/auth/me").status_code == 401
        # the new password works, the old one does not
        assert client.post("/login", json={"email": user["email"], "password": STRONG}).status_code == 200
        assert client.post("/login", json={"email": user["email"], "password": user["password"]}).status_code == 401
        # a used token cannot be replayed
        replay = client.post("/auth/reset-password", json={"token": token, "new_password": "An0ther-Pass!!"})
        assert replay.status_code == 400

    def test_a_newer_request_invalidates_the_older_link(self, client, seed_user, database_url):
        _clear(database_url)
        seed_user(role="student", email="two-links@example.edu")
        client.post("/auth/forgot-password", json={"email": "two-links@example.edu"})
        first = _token(database_url)
        client.post("/auth/forgot-password", json={"email": "two-links@example.edu"})
        second = _token(database_url)

        assert client.post("/auth/reset-password", json={"token": first, "new_password": STRONG}).status_code == 400
        assert client.post("/auth/reset-password", json={"token": second, "new_password": STRONG}).status_code == 200

    def test_expired_token_is_rejected(self, client, seed_user, database_url):
        _clear(database_url)
        seed_user(role="student", email="expired@example.edu")
        client.post("/auth/forgot-password", json={"email": "expired@example.edu"})
        token = _token(database_url)
        engine = create_engine(database_url)
        with engine.begin() as connection:
            connection.execute(text("UPDATE password_reset_tokens SET expires_at = :t"), {"t": datetime.datetime.utcnow() - datetime.timedelta(minutes=1)})
        engine.dispose()

        assert client.post("/auth/reset-password", json={"token": token, "new_password": STRONG}).status_code == 400

    def test_tampered_token_and_weak_password_are_rejected(self, client, seed_user, database_url):
        _clear(database_url)
        seed_user(role="student", email="weak@example.edu")
        client.post("/auth/forgot-password", json={"email": "weak@example.edu"})
        token = _token(database_url)

        assert client.post("/auth/reset-password", json={"token": token[:-4] + "0000", "new_password": STRONG}).status_code == 400
        weak = client.post("/auth/reset-password", json={"token": token, "new_password": "short"})
        assert weak.status_code == 400
        # a rejected weak password must not burn the link
        assert client.post("/auth/reset-password", json={"token": token, "new_password": STRONG}).status_code == 200


class TestEmailService:
    def test_html_escapes_values_and_text_has_the_link(self):
        from services.email_service import render_email

        _subject, text_body, html_body = render_email("Hi <b>", ["<script>x</script>"], action_label="Go", action_url="https://x.test/?a=1&b=2")
        assert "<script>" not in html_body
        assert "&lt;script&gt;" in html_body
        assert "https://x.test/?a=1&b=2" in text_body
        assert "&amp;" in html_body

    def test_send_is_a_noop_without_smtp_host(self, monkeypatch):
        from config import get_settings
        from services import email_service

        monkeypatch.delenv("SMTP_HOST", raising=False)
        get_settings.cache_clear()
        try:
            assert asyncio.run(email_service.send_email("a@example.edu", "s", "t", "<p>t</p>")) is False
        finally:
            get_settings.cache_clear()

    def test_send_uses_smtp_when_configured(self, monkeypatch):
        from config import get_settings
        from services import email_service

        sent = []

        class FakeSMTP:
            def __init__(self, host, port, timeout=None):
                sent.append(("connect", host, port))

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def starttls(self, context=None):
                sent.append(("starttls",))

            def login(self, user, password):
                sent.append(("login", user))

            def send_message(self, message, from_addr=None):
                sent.append(("message", message["To"], message["Subject"], from_addr, message.is_multipart()))

        monkeypatch.setenv("SMTP_HOST", "mail.test")
        monkeypatch.setenv("SMTP_USER", "mailer")
        monkeypatch.setenv("SMTP_PASSWORD", "pw")
        monkeypatch.setattr(email_service.smtplib, "SMTP", FakeSMTP)
        get_settings.cache_clear()
        try:
            assert asyncio.run(email_service.send_email("a@example.edu", "Subject", "text", "<p>html</p>")) is True
        finally:
            get_settings.cache_clear()
        assert ("connect", "mail.test", 587) in sent
        assert ("login", "mailer") in sent
        assert ("message", "a@example.edu", "Subject", "no-reply@campusgrade.localhost", True) in sent


def test_preference_keys_include_email_opt_outs():
    from schemas.preferences import EMAIL_KEYS, NOTIFICATION_KEYS

    assert EMAIL_KEYS <= NOTIFICATION_KEYS
    assert "email_assignment_grades" in EMAIL_KEYS


@pytest.mark.parametrize("path", ["/auth/forgot-password", "/auth/reset-password"])
def test_reset_endpoints_are_csrf_exempt(path):
    from core.csrf import _EXEMPT_PATHS

    assert path in _EXEMPT_PATHS
