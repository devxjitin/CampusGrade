"""Characterisation tests (Sprint 0 of the original implementation plan).

These lock in *current* behaviour — right or wrong — against a real,
migrated Postgres database. Every later refactor sprint (async DB layer,
policy engine, identity split, subject_offerings backfill, ...) is checked
against this file. If a sprint changes what one of these asserts, that is a
deliberate, visible decision — not an accidental regression.

Do not "fix" a test here to match new code. If behaviour must change,
change the assertion in the same PR as the code change, with a comment
explaining why, so the diff shows the decision.
"""

from tests.conftest import requires_docker


@requires_docker
class TestLogin:
    def test_login_returns_token_and_user(self, client, seed_user):
        seed_user(role="student", email="asha@example.edu")

        response = client.post("/login", json={"email": "asha@example.edu"})

        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) >= {"message", "token", "user", "session_id"}
        assert body["user"]["role"] == "student"
        assert body["user"]["email"] == "asha@example.edu"
        assert "password" not in body["user"]

    def test_login_rejects_an_unknown_email(self, client, seed_user):
        seed_user(role="student", email="known@example.edu")

        response = client.post("/login", json={"email": "nobody@example.edu"})

        assert response.status_code == 401

    def test_login_rejects_a_suspended_account(self, client, seed_user):
        from models.database import async_session_factory
        from models.sql_models import SqlUser
        from sqlalchemy import update

        user = seed_user(role="student", email="suspended@example.edu")

        async def suspend():
            async with async_session_factory() as db:
                await db.execute(update(SqlUser).where(SqlUser.id == user["id"]).values(is_active=False))
                await db.commit()

        client.portal.call(suspend)

        response = client.post("/login", json={"email": "suspended@example.edu"})

        assert response.status_code == 403

    def test_login_no_longer_accepts_or_needs_a_password(self, client, seed_user):
        seed_user(role="student", email="nopassword@example.edu")

        assert client.post("/login", json={"email": "nopassword@example.edu", "password": "anything"}).status_code == 200
        assert client.post("/login", json={"email": "nopassword@example.edu"}).status_code == 200

    def test_login_is_rate_limited(self, client, seed_user):
        seed_user(role="student", email="ratelimit@example.edu")

        # The limiter uses fixed windows, so 12 requests that straddle a window boundary
        # can stay under the limit. 22 requests always put at least 11 in one window.
        statuses = []
        for _ in range(22):
            statuses.append(client.post("/login", json={"email": "ratelimit@example.edu"}).status_code)
            if statuses[-1] == 429:
                break

        assert 429 in statuses, "more than 10 attempts from one IP within a window should be throttled"


@requires_docker
class TestAdminUserManagement:
    def test_admin_can_list_users(self, client, seed_user, login):
        admin = seed_user(role="super_admin", email="root-admin@example.edu")
        seed_user(role="student", email="listed-student@example.edu")
        token = login(admin["email"])

        response = client.get("/admin/users", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 200
        body = response.json()
        assert "users" in body
        emails = {u["email"] for u in body["users"]}
        assert "listed-student@example.edu" in emails

    def test_teacher_cannot_list_users(self, client, seed_user, login):
        teacher = seed_user(role="teacher", email="not-an-admin@example.edu")
        token = login(teacher["email"])

        response = client.get("/admin/users", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 403


def _assignment_body(structure: dict, title: str, total_marks: float = 20) -> dict:
    """A valid create-assignment payload: the API requires an audience (program,
    batch, section), an official subject, a deadline and a rubric that adds up to
    the total marks."""
    import datetime

    due_at = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)).replace(tzinfo=None)
    return {
        "title": title,
        "instructions": "Implement insert/delete/search.",
        "total_marks": total_marks,
        "subject_id": structure["subject_id"],
        "target_course_id": structure["course_id"],
        "target_batch_id": structure["batch_id"],
        "target_section_id": structure["section_id"],
        "due_at": due_at.isoformat(),
        "rubric": [{"title": "Correctness", "description": "Works as specified", "max_marks": total_marks}],
    }


@requires_docker
class TestAssignments:
    def test_teacher_creates_assignment(self, client, seed_user, seed_academic, login):
        teacher = seed_user(role="teacher", email="creator@example.edu")
        token = login(teacher["email"])
        headers = {"Authorization": f"Bearer {token}"}

        response = client.post(
            "/assignments/teacher",
            json=_assignment_body(seed_academic(), "Binary Search Trees"),
            headers=headers,
        )

        assert response.status_code == 200, response.text
        assignment = response.json()["assignment"]
        assert assignment["title"] == "Binary Search Trees"
        assert assignment["total_marks"] == 20

        listing = client.get("/assignments/teacher", headers=headers)
        assert listing.status_code == 200
        assert any(a["id"] == assignment["id"] for a in listing.json()["assignments"])

    def test_student_cannot_create_assignment(self, client, seed_user, seed_academic, login):
        student = seed_user(role="student", email="not-a-teacher@example.edu")
        token = login(student["email"])

        response = client.post(
            "/assignments/teacher",
            json=_assignment_body(seed_academic(), "Should not work", 10),
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 403

    def test_teacher_cannot_read_another_teachers_assignment(self, client, seed_user, seed_academic, login):
        owner = seed_user(role="teacher", email="owner@example.edu")
        other = seed_user(role="teacher", email="other-teacher@example.edu")
        owner_token = login(owner["email"])
        other_token = login(other["email"])

        created = client.post(
            "/assignments/teacher",
            json=_assignment_body(seed_academic(), "Owner Only", 10),
            headers={"Authorization": f"Bearer {owner_token}"},
        ).json()["assignment"]

        response = client.get(
            f"/assignments/teacher/{created['id']}",
            headers={"Authorization": f"Bearer {other_token}"},
        )

        # Documents today's actual scoping behaviour on this endpoint. If this
        # assertion ever needs to change, that is exactly the kind of decision
        # Sprint 3 (policy engine) and Sprint 11 (assignments domain) must make
        # deliberately, with a test update in the same commit.
        assert response.status_code in (403, 404)


@requires_docker
class TestUnauthenticated:
    def test_protected_route_without_token_is_rejected(self, client):
        response = client.get("/admin/users")
        assert response.status_code == 401

    def test_protected_route_with_garbage_token_is_rejected(self, client):
        response = client.get("/admin/users", headers={"Authorization": "Bearer not-a-real-token"})
        assert response.status_code == 401
