"""Shared fixtures for integration tests.

`database_url` spins up a throwaway Postgres container (Sprint 0 of
the original implementation plan), runs every Alembic migration against it, and yields
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

# Must happen before any test module imports the app: `models.database` decides at import
# time whether to build a pooled engine, and test modules import it during collection.
# (A real APP_ENV in the environment still wins.)
os.environ.setdefault("APP_ENV", "test")


def _docker_available() -> bool:
    try:
        subprocess.run(["docker", "info"], capture_output=True, timeout=5, check=True)
        return True
    except Exception:
        return False


def _database_available() -> bool:
    return bool(os.environ.get("TEST_DATABASE_URL")) or _docker_available()


requires_docker = pytest.mark.skipif(
    not _database_available(), reason="Neither Docker nor TEST_DATABASE_URL is available in this environment"
)


def _migrate(sync_url: str) -> None:
    from alembic import command
    from alembic.config import Config

    backend_dir = os.path.join(os.path.dirname(__file__), "..")
    config = Config(os.path.join(backend_dir, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(backend_dir, "migrations"))
    config.set_main_option("sqlalchemy.url", sync_url)
    # migrations/env.py prefers DATABASE_URL from the app settings (environment or a
    # developer's backend/.env) over the URL above, which would migrate the wrong
    # database. Point the settings at the test database for the duration.
    from config import get_settings

    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = sync_url
    get_settings.cache_clear()
    try:
        command.upgrade(config, "head")
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous
        get_settings.cache_clear()


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    # Set TEST_DATABASE_URL to an empty, disposable Postgres database (e.g. a
    # `docker run postgres` container) to skip testcontainers, which cannot reach
    # its containers on some Docker Desktop setups.
    external = os.environ.get("TEST_DATABASE_URL")
    if external:
        _migrate(external)
        yield external
        return

    if not _docker_available():
        pytest.skip("Docker is not available in this environment")

    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("postgres:16-alpine") as postgres:
        sync_url = postgres.get_connection_url().replace("postgresql+psycopg2://", "postgresql+psycopg://")
        _migrate(sync_url)
        yield sync_url


@pytest.fixture
def app_env(database_url: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Set the environment the app reads at import time."""
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("SECRET_KEY", "test-secret-of-at-least-thirty-two-characters-ok")
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:3000")
    monkeypatch.setenv("PRIVATE_STORAGE_BACKEND", "local")
    monkeypatch.setenv("PRIVATE_STORAGE_PATH", "/tmp/campusgrade-test-storage")
    monkeypatch.setenv("REDIS_REQUIRED", "false")
    monkeypatch.setenv("APP_ENV", "test")
    # `get_settings()` is cached for the process; without this a value cached by an
    # earlier test (e.g. an empty DATABASE_URL) would shadow the variables above.
    from config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def client(app_env: None) -> Iterator["TestClient"]:  # noqa: F821,UP037 - TestClient is imported lazily below, string annotation is intentional
    """A TestClient wired to a real, migrated Postgres database.

    Importing `app` is deferred to fixture time (not module import time) so
    that the DATABASE_URL/SECRET_KEY env vars set by `app_env` are in place
    before `models/database.py` builds its engine at import.
    """
    import importlib
    import sys

    # Several modules capture the database engine or session getter when they are first
    # imported (core.db, the dependencies in core.policy, models.database, ...), and test
    # modules import the app at collection time, before any database URL is known. So every
    # DB-backed test gets a freshly imported copy of the whole backend graph (except the
    # settings module and the tests themselves), and the original modules are put back
    # afterwards so that patch() in other tests targets the module the code under test
    # actually belongs to.
    backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    keep = {"config"}

    def _is_app_module(name: str) -> bool:
        if name in keep or name == "tests" or name.startswith("tests.") or name == "conftest":
            return False
        path = getattr(sys.modules.get(name), "__file__", None) or ""
        return os.path.abspath(path).startswith(backend_dir + os.sep)

    saved = {name: sys.modules[name] for name in list(sys.modules) if _is_app_module(name)}
    for name in saved:
        del sys.modules[name]

    app_module = importlib.import_module("app")
    from fastapi.testclient import TestClient

    try:
        with TestClient(app_module.app) as test_client:
            yield test_client
    finally:
        for name in [n for n in list(sys.modules) if _is_app_module(n)]:
            del sys.modules[name]
        sys.modules.update(saved)


@pytest.fixture
def seed_user(client):
    """Insert a user directly via the ORM, bypassing HTTP.

    There is no self-registration endpoint — accounts are always created by
    an admin — so tests need a way to seed a login-ready user without going
    through `/admin/add-student` and its side effects (temp-password email,
    audit log, etc). Returns a small factory; call it once per user needed.
    """
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

        # Run on the app's own event loop (the TestClient portal): asyncpg connections
        # are bound to the loop that opened them, so a separate asyncio.run() would fail
        # with "attached to a different loop".
        user_id = client.portal.call(create_user)
        created_ids.append(user_id)
        return {"id": user_id, "email": email, "password": password, "role": role}

    yield _create

    if created_ids:
        async def cleanup_users():
            if async_session_factory is None:
                return
            from models.assignment import SqlAssignment
            from sqlalchemy import delete

            async with async_session_factory() as session:
                # Rows the test created on behalf of these users must go first (foreign keys).
                await session.execute(delete(SqlAssignment).where(SqlAssignment.created_by.in_(created_ids)))
                await session.execute(delete(SqlUser).where(SqlUser.id.in_(created_ids)))
                await session.commit()

        client.portal.call(cleanup_users)


@pytest.fixture
def seed_academic(client):
    """Create a program, batch, section and subject (what an assignment targets).

    Names and codes are unique per call so tests never collide on the unique
    constraints (the database is shared by the whole test session). Returns the ids.
    """
    import uuid

    from models.database import async_session_factory
    from models.sql_models import SqlBatch, SqlCourse, SqlSection, SqlSubject

    def _seed() -> dict[str, str]:
        tag = uuid.uuid4().hex[:8]

        async def create():
            if async_session_factory is None:
                raise RuntimeError("Async test database is unavailable")
            async with async_session_factory() as session:
                course = SqlCourse(id=str(uuid.uuid4()), name=f"Program {tag}", code=f"P{tag}")
                session.add(course)
                await session.flush()
                batch = SqlBatch(id=str(uuid.uuid4()), course_id=course.id, start_year=2024, end_year=2028)
                session.add(batch)
                await session.flush()
                section = SqlSection(id=str(uuid.uuid4()), course_id=course.id, batch_id=batch.id, name="A")
                subject = SqlSubject(id=str(uuid.uuid4()), name=f"Subject {tag}", code=f"S{tag}", course_id=course.id, batch_id=batch.id)
                session.add_all([section, subject])
                await session.commit()
                return {"course_id": course.id, "batch_id": batch.id, "section_id": section.id, "subject_id": subject.id}

        return client.portal.call(create)

    return _seed


@pytest.fixture
def login(client):
    def _login(email: str, password: str):
        response = client.post("/login", json={"email": email, "password": password})
        assert response.status_code == 200, response.text
        # Like the real frontend: echo the readable CSRF cookie as a header on every
        # later mutating request (core/csrf.py enforces the double-submit check).
        csrf = client.cookies.get("campusgrade_csrf")
        if csrf:
            client.headers["X-CSRF-Token"] = csrf
        # Callers authenticate each request with the returned token in an
        # Authorization header. Leaving the access cookie in the shared jar would let
        # the most recent login silently win over that header (cookies take priority),
        # so tests that log in as two users would both act as the second one.
        client.cookies.delete("campusgrade_access")
        client.cookies.delete("campusgrade_refresh")
        return response.json()["token"]

    return _login
