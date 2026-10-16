from types import SimpleNamespace

import pytest
from fastapi import Request
from models.sql_models import SqlAdminProgramScope
from routes_fastapi.admin import admins as admin_routes


class _ScalarResult:
    def __init__(self, *, first=None, rows=()):
        self._first = first
        self._rows = rows

    def first(self):
        return self._first

    def all(self):
        return list(self._rows)


class _CreateAdminSession:
    def __init__(self):
        self.added = []
        self.flush_snapshots = []
        self.scalar_calls = 0

    async def scalars(self, _statement):
        self.scalar_calls += 1
        if self.scalar_calls == 1:
            return _ScalarResult(first=None)
        return _ScalarResult(rows=("program-1",))

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        self.flush_snapshots.append(tuple(type(value) for value in self.added))

    async def rollback(self):  # pragma: no cover - failure-path protocol only
        raise AssertionError("The valid create operation must not roll back")


@pytest.mark.asyncio
async def test_create_program_admin_flushes_user_before_scope(monkeypatch):
    """The scope FK cannot be inserted until the new users row exists."""
    session = _CreateAdminSession()

    async def fake_sync_profile(db, user):
        assert db is session
        assert user in db.added

    monkeypatch.setattr(admin_routes, "sync_profile", fake_sync_profile)
    monkeypatch.setattr(admin_routes, "encrypt_password", lambda _password: "hashed")
    monkeypatch.setattr(admin_routes, "_generate_temporary_password", lambda: "Temporary-123!")
    async def fake_write_audit_log(*_args, **_kwargs):
        return None

    monkeypatch.setattr(admin_routes, "write_audit_log", fake_write_audit_log)

    response = await admin_routes.create_admin(
        admin_routes.AdminCreate(
            name="Program Administrator",
            email="program-admin@example.edu",
            role="program_admin",
            program_ids=["program-1"],
        ),
        Request({"type": "http", "client": ("127.0.0.1", 50000)}),
        principal=SimpleNamespace(user_id="super-admin-1"),
        db=session,
    )

    assert response["user"]["program_ids"] == ["program-1"]
    assert len(session.flush_snapshots) == 2
    assert SqlAdminProgramScope not in session.flush_snapshots[0]
    assert SqlAdminProgramScope in session.flush_snapshots[1]
