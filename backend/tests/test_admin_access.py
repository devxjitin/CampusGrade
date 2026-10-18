"""Admin accounts: a Super Admin sets what each `admin` may do, per resource and level.

Real-database tests (Docker-gated like the other DB tests, see `tests/conftest.py`):
the access is read from `admin_access` on every request, so these check the whole path
from the grant to the HTTP status.
"""

import uuid

from tests.conftest import requires_docker


def _grant(client, user_id: str, **access: str) -> None:
    from models.database import async_session_factory
    from models.sql_models import SqlAdminAccess

    async def seed():
        async with async_session_factory() as session:
            session.add_all(SqlAdminAccess(user_id=user_id, resource=resource, level=level) for resource, level in access.items())
            await session.commit()

    client.portal.call(seed)


def _seed_course_with_batch(client, *, name: str, start_year: int = 2024):
    from models.database import async_session_factory
    from models.sql_models import SqlBatch, SqlCourse

    async def seed():
        async with async_session_factory() as session:
            tag = uuid.uuid4().hex[:6]
            course = SqlCourse(id=str(uuid.uuid4()), name=f"{name} {tag}", code=f"{name[:4]}-{tag}")
            session.add(course)
            await session.flush()
            batch = SqlBatch(id=str(uuid.uuid4()), course_id=course.id, start_year=start_year, end_year=start_year + 4)
            session.add(batch)
            await session.commit()
            return course.id, batch.id

    return client.portal.call(seed)


def _headers(login, user) -> dict[str, str]:
    return {"Authorization": f"Bearer {login(user['email'])}"}


@requires_docker
def test_admin_sees_every_program_with_view_access(client, seed_user, login):
    _, batch_a = _seed_course_with_batch(client, name="Course A")
    _, batch_b = _seed_course_with_batch(client, name="Course B")
    admin = seed_user(role="admin", email="viewer-admin@example.edu")
    _grant(client, admin["id"], batches="view")

    response = client.get("/admin/batches", headers=_headers(login, admin))

    assert response.status_code == 200
    assert {batch_a, batch_b} <= {row["id"] for row in response.json()["batches"]}


@requires_docker
def test_view_edit_and_full_unlock_read_change_and_delete(client, seed_user, login):
    _, batch_id = _seed_course_with_batch(client, name="Levels")
    url = f"/admin/batches/{batch_id}"
    viewer = seed_user(role="admin", email="level-view@example.edu")
    editor = seed_user(role="admin", email="level-edit@example.edu")
    owner = seed_user(role="admin", email="level-full@example.edu")
    _grant(client, viewer["id"], batches="view")
    _grant(client, editor["id"], batches="edit")
    _grant(client, owner["id"], batches="full")

    view_headers, edit_headers, full_headers = (_headers(login, user) for user in (viewer, editor, owner))
    # View: can read, cannot change or delete.
    assert client.get("/admin/batches", headers=view_headers).status_code == 200
    assert client.put(url, headers=view_headers, json={}).status_code == 403
    assert client.delete(url, headers=view_headers).status_code == 403
    # Edit: can change, still cannot delete.
    assert client.put(url, headers=edit_headers, json={}).status_code != 403
    assert client.delete(url, headers=edit_headers).status_code == 403
    # Full: may delete (the batch is gone afterwards).
    assert client.delete(url, headers=full_headers).status_code == 200
    assert client.delete(url, headers=full_headers).status_code == 404


@requires_docker
def test_admin_has_no_access_to_a_resource_that_was_not_granted(client, seed_user, login):
    admin = seed_user(role="admin", email="batches-only@example.edu")
    _grant(client, admin["id"], batches="full")
    headers = _headers(login, admin)

    assert client.get("/admin/batches", headers=headers).status_code == 200
    assert client.get("/admin/subjects", headers=headers).status_code == 403
    assert client.get("/admin/sections", headers=headers).status_code == 403
    assert client.get("/admin/audit-log", headers=headers).status_code == 403
    # Platform-wide screens stay Super Admin only whatever an admin was given.
    assert client.get("/admin/academic-sessions", headers=headers).status_code == 403
    assert client.get("/admin/admins", headers=headers).status_code == 403


@requires_docker
def test_changed_access_applies_without_signing_in_again(client, seed_user, login):
    admin = seed_user(role="admin", email="live-access@example.edu")
    boss = seed_user(role="super_admin", email="live-access-boss@example.edu")
    _grant(client, admin["id"], batches="view")
    admin_headers = _headers(login, admin)
    boss_headers = _headers(login, boss)
    assert client.get("/admin/subjects", headers=admin_headers).status_code == 403

    updated = client.put(f"/admin/admins/{admin['id']}/access", headers=boss_headers, json={"access": {"subjects": "view"}})
    assert updated.status_code == 200

    assert client.get("/admin/subjects", headers=admin_headers).status_code == 200
    assert client.get("/admin/batches", headers=admin_headers).status_code == 403  # replaced, not merged


@requires_docker
def test_admin_cannot_manage_administrator_accounts_or_promote_themselves(client, seed_user, login):
    admin = seed_user(role="admin", email="cannot-escalate@example.edu")
    boss = seed_user(role="super_admin", email="boss-target@example.edu")
    other_admin = seed_user(role="admin", email="other-admin@example.edu")
    _grant(client, admin["id"], users="full")
    headers = _headers(login, admin)

    # Promote self, and edit, deactivate or delete administrator accounts: all refused.
    assert client.put(f"/admin/user/{admin['id']}", headers=headers, json={"role": "super_admin"}).status_code == 403
    assert client.put(f"/admin/user/{boss['id']}", headers=headers, json={"name": "Hijacked"}).status_code == 403
    assert client.patch(f"/admin/user/{boss['id']}", headers=headers, json={"is_active": False}).status_code == 403
    assert client.delete(f"/admin/user/{other_admin['id']}", headers=headers).status_code == 403


@requires_docker
def test_super_admin_creates_admin_with_access_and_it_is_returned(client, seed_user, login):
    boss = seed_user(role="super_admin", email="creator-boss@example.edu")
    headers = _headers(login, boss)
    email = f"new-admin-{uuid.uuid4().hex[:6]}@example.edu"

    created = client.post("/admin/admins", headers=headers, json={"name": "New Admin", "email": email, "role": "admin", "access": {"batches": "edit", "audit_log": "view"}})
    assert created.status_code == 200, created.text
    assert created.json()["user"]["access"] == {"batches": "edit", "audit_log": "view"}

    listed = {row["email"]: row for row in client.get("/admin/admins", headers=headers).json()["admins"]}
    assert listed[email]["access"] == {"batches": "edit", "audit_log": "view"}
    assert listed[email]["role"] == "admin"

    # No access at all, an unknown level and an editable audit log are all refused.
    assert client.post("/admin/admins", headers=headers, json={"name": "X", "email": f"a{email}", "role": "admin", "access": {}}).status_code == 400
    assert client.post("/admin/admins", headers=headers, json={"name": "X", "email": f"b{email}", "role": "admin", "access": {"batches": "owner"}}).status_code == 422
    assert client.post("/admin/admins", headers=headers, json={"name": "X", "email": f"c{email}", "role": "admin", "access": {"audit_log": "edit"}}).status_code == 422


@requires_docker
def test_auth_me_reports_what_the_account_may_do(client, seed_user, login):
    admin = seed_user(role="admin", email="me-admin@example.edu")
    boss = seed_user(role="super_admin", email="me-boss@example.edu")
    _grant(client, admin["id"], batches="edit", audit_log="view")

    assert client.get("/auth/me", headers=_headers(login, admin)).json()["access"] == {"batches": "edit", "audit_log": "view"}
    boss_access = client.get("/auth/me", headers=_headers(login, boss)).json()["access"]
    assert boss_access["batches"] == "full" and boss_access["audit_log"] == "view"


@requires_docker
def test_deleting_a_student_with_profile_rows_succeeds(client, seed_user, login):
    from models.database import async_session_factory
    from models.sql_models import SqlUser, SqlUserProfile
    from sqlalchemy import select

    boss = seed_user(role="super_admin", email="delete-boss@example.edu")
    student = seed_user(role="student", email="delete-me@example.edu")

    async def add_profile():
        async with async_session_factory() as session:
            session.add(SqlUserProfile(user_id=student["id"], full_name="Delete Me"))
            await session.commit()

    client.portal.call(add_profile)
    assert client.delete(f"/admin/user/{student['id']}", headers=_headers(login, boss)).status_code == 200

    async def remaining():
        async with async_session_factory() as session:
            users = (await session.scalars(select(SqlUser).filter_by(id=student["id"]))).all()
            profiles = (await session.scalars(select(SqlUserProfile).filter_by(user_id=student["id"]))).all()
            return len(users), len(profiles)

    assert client.portal.call(remaining) == (0, 0)
