"""`/ready` is the container health check, so it must actually be callable.

Regression for the original bug: `schema_revision_status()` is a coroutine but
was called without `await`, so `/ready` raised `TypeError` (HTTP 500) on every
request and any health check pointed at it marked every replica unhealthy.
"""

import app as app_module
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module, "is_database_available", lambda: True)
    # TestClient without a `with` block never runs the lifespan, so there is no
    # database to migrate and no storage to probe.
    return TestClient(app_module.app, raise_server_exceptions=False)


def _revision(ready: bool):
    async def fake() -> dict:
        return {"ready": ready, "current": "head" if ready else "old", "head": "head"}

    return fake


def test_ready_returns_200_when_database_and_storage_are_ready(client, monkeypatch):
    monkeypatch.setattr(app_module, "schema_revision_status", _revision(True))
    app_module.app.state.private_storage_ready = True

    response = client.get("/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["database_revision"] == "head"
    assert body["dependencies"]["storage"] == "ready"


def test_ready_returns_503_when_migrations_are_behind(client, monkeypatch):
    monkeypatch.setattr(app_module, "schema_revision_status", _revision(False))
    app_module.app.state.private_storage_ready = True

    assert client.get("/ready").status_code == 503


def test_ready_returns_503_when_storage_is_not_ready(client, monkeypatch):
    monkeypatch.setattr(app_module, "schema_revision_status", _revision(True))
    app_module.app.state.private_storage_ready = False

    assert client.get("/ready").status_code == 503


def test_ready_returns_503_when_database_is_down(monkeypatch):
    monkeypatch.setattr(app_module, "is_database_available", lambda: False)

    response = TestClient(app_module.app, raise_server_exceptions=False).get("/ready")

    assert response.status_code == 503
