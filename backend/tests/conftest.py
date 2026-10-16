"""Shared fixtures for integration tests.

`database_url` spins up a throwaway Postgres container (Sprint 0 of
IMPLEMENTATION_PLAN.md), runs every Alembic migration against it, and yields
a connection URL a test can point the app at. This is what lets later
sprints refactor the database layer with confidence: a route's behaviour is
checked against a real Postgres instance, not mocked out.

Tests that don't need the database (unit tests on pure functions) should not
depend on these fixtures — they add real setup cost (pulling and starting a
container) that unit tests don't need.

Requires Docker. If Docker is unavailable, tests using `client`/`database_url`
are skipped rather than failed, so `pytest` stays usable on a laptop without
Docker for the pure-unit-test subset.
"""

from __future__ import annotations

import os
import subprocess
from collections.abc import Iterator

import pytest


def _docker_available() -> bool:
    try:
        subprocess.run(["docker", "info"], capture_output=True, timeout=5, check=True)
        return True
    except Exception:
        return False


requires_docker = pytest.mark.skipif(not _docker_available(), reason="Docker is not available in this environment")


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    if not _docker_available():
        pytest.skip("Docker is not available in this environment")

    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("postgres:16-alpine") as postgres:
        sync_url = postgres.get_connection_url().replace("postgresql+psycopg2://", "postgresql+psycopg://")

        from alembic import command
        from alembic.config import Config

        backend_dir = os.path.join(os.path.dirname(__file__), "..")
        config = Config(os.path.join(backend_dir, "alembic.ini"))
        config.set_main_option("script_location", os.path.join(backend_dir, "migrations"))
        config.set_main_option("sqlalchemy.url", sync_url)
        command.upgrade(config, "head")

        yield sync_url


@pytest.fixture
def app_env(database_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """Set the environment the app reads at import time."""
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("SECRET_KEY", "test-secret-of-at-least-thirty-two-characters-ok")
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:3000")
    monkeypatch.setenv("PRIVATE_STORAGE_BACKEND", "local")
    monkeypatch.setenv("PRIVATE_STORAGE_PATH", "/tmp/campusgrade-test-storage")
    monkeypatch.setenv("REDIS_REQUIRED", "false")


@pytest.fixture
def client(app_env: None) -> Iterator["TestClient"]:  # noqa: F821,UP037 - TestClient is imported lazily below, string annotation is intentional
    """A TestClient wired to a real, migrated Postgres database.

    Importing `app` is deferred to fixture time (not module import time) so
    that the DATABASE_URL/SECRET_KEY env vars set by `app_env` are in place
    before `models/database.py` builds its engine at import.
    """
    import importlib
    import sys

    for name in list(sys.modules):
        if name == "app" or name.startswith("models.") or name.startswith("routes_fastapi."):
            del sys.modules[name]

    app_module = importlib.import_module("app")
    from fastapi.testclient import TestClient

    with TestClient(app_module.app) as test_client:
        yield test_client


@pytest.fixture
def seed_user(client):  # noqa: ARG001 - client ensures the app (and its engine) is imported first
    """Insert a user directly via the ORM, bypassing HTTP.

    There is no self-registration endpoint — accounts are always created by
    an admin — so tests need a way to seed a login-ready user without going
    through `/admin/add-student` and its side effects (temp-password email,
    audit log, etc). Returns a small factory; call it once per user needed.
    """
    import asyncio
    import uuid

    from models.database import async_session_factory
    from models.sql_models import SqlUser
    from utils.security_utils import hash_password

    created_ids: list[str] = []

    def _create(*, role: str, email: str, password: str = "Test-Password-123!", **fields):
        async def create_user():
            if async_session_factory is None:
                raise RuntimeError("Async test database is unavailable")
            async with async_session_factory() as session:
                user_id = str(uuid.uuid4())
                session.add(
                    SqlUser(
                        id=user_id,
                        name=fields.pop("name", email.split("@")[0].title()),
                        email=email,
                        password=hash_password(password),
                        role=role,
                        is_active=True,
                        must_change_password=False,
                        **fields,
                    )
                )
                await session.commit()
                return user_id

        user_id = asyncio.run(create_user())
        created_ids.append(user_id)
        return {"id": user_id, "email": email, "password": password, "role": role}

    yield _create

    if created_ids:
        async def cleanup_users():
            if async_session_factory is None:
                return
            from sqlalchemy import delete
            async with async_session_factory() as session:
                await session.execute(delete(SqlUser).where(SqlUser.id.in_(created_ids)))
                await session.commit()

        asyncio.run(cleanup_users())


@pytest.fixture
def login(client):
    def _login(email: str, password: str):
        response = client.post("/login", json={"email": email, "password": password})
        assert response.status_code == 200, response.text
        return response.json()["token"]

    return _login
