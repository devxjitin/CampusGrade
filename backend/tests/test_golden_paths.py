"""Characterisation tests (Sprint 0 of IMPLEMENTATION_PLAN.md).

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
        seed_user(role="student", email="asha@example.edu", password="Str0ng!Pass99")

        response = client.post("/login", json={"email": "asha@example.edu", "password": "Str0ng!Pass99"})

        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) >= {"message", "token", "user", "session_id"}
        assert body["user"]["role"] == "student"
        assert body["user"]["email"] == "asha@example.edu"
        assert "password" not in body["user"]

    def test_login_rejects_wrong_password(self, client, seed_user):
        seed_user(role="student", email="wrongpw@example.edu")

        response = client.post("/login", json={"email": "wrongpw@example.edu", "password": "not-the-password"})

        assert response.status_code == 401

    def test_login_is_rate_limited(self, client, seed_user):
        seed_user(role="student", email="ratelimit@example.edu")

        statuses = [
            client.post("/login", json={"email": "ratelimit@example.edu", "password": "wrong"}).status_code
            for _ in range(12)
        ]

        assert 429 in statuses, "the 11th+ attempt from one IP within the window should be throttled"


@requires_docker
class TestAdminUserManagement:
    def test_admin_can_list_users(self, client, seed_user, login):
        admin = seed_user(role="super_admin", email="root-admin@example.edu")
        seed_user(role="student", email="listed-student@example.edu")
        token = login(admin["email"], admin["password"])

        response = client.get("/admin/users", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 200
        body = response.json()
        assert "users" in body
        emails = {u["email"] for u in body["users"]}
        assert "listed-student@example.edu" in emails

    def test_teacher_cannot_list_users(self, client, seed_user, login):
        teacher = seed_user(role="teacher", email="not-an-admin@example.edu")
        token = login(teacher["email"], teacher["password"])

        response = client.get("/admin/users", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 403


@requires_docker
class TestAssignments:
    def test_teacher_creates_assignment(self, client, seed_user, login):
        teacher = seed_user(role="teacher", email="creator@example.edu")
        token = login(teacher["email"], teacher["password"])
        headers = {"Authorization": f"Bearer {token}"}

        response = client.post(
            "/assignments/teacher",
            json={"title": "Binary Search Trees", "instructions": "Implement insert/delete/search.", "total_marks": 20},
            headers=headers,
        )

        assert response.status_code == 200, response.text
        assignment = response.json()["assignment"]
        assert assignment["title"] == "Binary Search Trees"
        assert assignment["total_marks"] == 20

        listing = client.get("/assignments/teacher", headers=headers)
        assert listing.status_code == 200
        assert any(a["id"] == assignment["id"] for a in listing.json()["assignments"])

    def test_student_cannot_create_assignment(self, client, seed_user, login):
        student = seed_user(role="student", email="not-a-teacher@example.edu")
        token = login(student["email"], student["password"])

        response = client.post(
            "/assignments/teacher",
            json={"title": "Should not work", "instructions": "n/a", "total_marks": 10},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 403

    def test_teacher_cannot_read_another_teachers_assignment(self, client, seed_user, login):
        owner = seed_user(role="teacher", email="owner@example.edu")
        other = seed_user(role="teacher", email="other-teacher@example.edu")
        owner_token = login(owner["email"], owner["password"])
        other_token = login(other["email"], other["password"])

        created = client.post(
            "/assignments/teacher",
            json={"title": "Owner Only", "instructions": "n/a", "total_marks": 10},
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
