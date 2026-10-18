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


def _allocation(structure: dict) -> list[dict]:
    """The teacher allocation that lets a teacher create assignments for this structure."""
    return [{"program_id": structure["course_id"], "batch_id": structure["batch_id"], "section_id": structure["section_id"], "subject_ids": [structure["subject_id"]]}]


@requires_docker
class TestAssignments:
    def test_teacher_creates_assignment(self, client, seed_user, seed_academic, login):
        structure = seed_academic()
        teacher = seed_user(role="teacher", email="creator@example.edu", assignments=_allocation(structure))
        token = login(teacher["email"])
        headers = {"Authorization": f"Bearer {token}"}

        response = client.post(
            "/assignments/teacher",
            json=_assignment_body(structure, "Binary Search Trees"),
            headers=headers,
        )

        assert response.status_code == 200, response.text
        assignment = response.json()["assignment"]
        assert assignment["title"] == "Binary Search Trees"
        assert assignment["total_marks"] == 20

        listing = client.get("/assignments/teacher", headers=headers)
        assert listing.status_code == 200
        assert any(a["id"] == assignment["id"] for a in listing.json()["assignments"])

    def test_teacher_outside_allocation_cannot_create_assignment(self, client, seed_user, seed_academic, login):
        teacher = seed_user(role="teacher", email="unallocated@example.edu")
        token = login(teacher["email"])

        response = client.post(
            "/assignments/teacher",
            json=_assignment_body(seed_academic(), "Not mine", 10),
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 403

    def test_context_options_lists_only_allocated_chain(self, client, seed_user, seed_academic, login):
        structure = seed_academic()
        teacher = seed_user(role="teacher", email="options@example.edu", assignments=_allocation(structure))
        token = login(teacher["email"])

        response = client.get("/assignments/teacher-tools/context-options", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 200, response.text
        program = response.json()["programs"][0]
        assert program["id"] == structure["course_id"]
        section = program["batches"][0]["sections"][0]
        assert section["id"] == structure["section_id"]
        assert [s["id"] for s in section["subjects"]] == [structure["subject_id"]]

    def test_ai_prompt_uses_database_names_and_signed_draft(self, client, seed_user, seed_academic, login):
        import jwt

        structure = seed_academic()
        teacher = seed_user(role="teacher", email="prompt@example.edu", assignments=_allocation(structure))
        headers = {"Authorization": f"Bearer {login(teacher['email'])}"}
        body = {
            "program_id": structure["course_id"], "batch_id": structure["batch_id"], "section_id": structure["section_id"],
            "subject_id": structure["subject_id"], "brief": "Build a REST API", "total_marks": 20, "rubric_count": 4,
        }

        response = client.post("/assignments/teacher-tools/external-ai-prompt", json=body, headers=headers)

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["draft_ref"] in data["prompt"]
        assert data["draft_token"] not in data["prompt"]
        assert "Build a REST API" in data["prompt"] and "Subject " in data["prompt"]
        claims = jwt.decode(data["draft_token"], options={"verify_signature": False})
        assert claims["draft_ref"] == data["draft_ref"] and claims["rubric_count"] == 4 and claims["subject_id"] == structure["subject_id"]

    def test_ai_prompt_rejects_unallocated_teacher(self, client, seed_user, seed_academic, login):
        structure = seed_academic()
        teacher = seed_user(role="teacher", email="prompt-denied@example.edu")
        headers = {"Authorization": f"Bearer {login(teacher['email'])}"}
        body = {
            "program_id": structure["course_id"], "batch_id": structure["batch_id"], "section_id": structure["section_id"],
            "subject_id": structure["subject_id"], "brief": "Build a REST API",
        }

        assert client.post("/assignments/teacher-tools/external-ai-prompt", json=body, headers=headers).status_code == 403

    def _prompt_and_proposal(self, client, structure, headers):
        body = {
            "program_id": structure["course_id"], "batch_id": structure["batch_id"], "section_id": structure["section_id"],
            "subject_id": structure["subject_id"], "brief": "Build a REST API", "total_marks": 20, "rubric_count": 2,
        }
        data = client.post("/assignments/teacher-tools/external-ai-prompt", json=body, headers=headers).json()
        proposal = {
            "schema_version": 1, "draft_ref": data["draft_ref"], "title": "Library API", "short_description": "Build a REST API.",
            "instructions": "## Objective\n" + "Build and document the service. " * 5 + "\n```mermaid\nflowchart TD\n A-->B\n```",
            "learning_outcomes": ["REST"], "tags": ["api"], "difficulty": "intermediate",
            "repository_requirements": {"require_readme": True, "required_files": ["README.md"]}, "total_marks": 20,
            "rubric": [{"title": "Impl", "description": "Works", "max_marks": 12}, {"title": "Quality", "description": "Clean", "max_marks": 8}],
        }
        return data["draft_token"], proposal

    def test_ai_proposal_validation_accepts_good_json_and_reports_bad_marks(self, client, seed_user, seed_academic, login):
        structure = seed_academic()
        teacher = seed_user(role="teacher", email="validate@example.edu", assignments=_allocation(structure))
        headers = {"Authorization": f"Bearer {login(teacher['email'])}"}
        token, proposal = self._prompt_and_proposal(client, structure, headers)
        url = "/assignments/teacher-tools/external-ai-proposal/validate"

        ok = client.post(url, json={"draft_token": token, "proposal": proposal}, headers=headers)
        assert ok.status_code == 200, ok.text
        assert [item["max_marks"] for item in ok.json()["proposal"]["rubric"]] == [12, 8]

        proposal["rubric"][0]["max_marks"] = 15
        bad = client.post(url, json={"draft_token": token, "proposal": proposal}, headers=headers)
        assert bad.status_code == 422
        assert any(item["path"] == "rubric" for item in bad.json()["errors"])

    def test_ai_proposal_validation_accepts_own_json_for_an_allocated_class(self, client, seed_user, seed_academic, login):
        structure = seed_academic()
        teacher = seed_user(role="teacher", email="own-json@example.edu", assignments=_allocation(structure))
        outsider = seed_user(role="teacher", email="own-json-outsider@example.edu")
        _, proposal = self._prompt_and_proposal(client, structure, {"Authorization": f"Bearer {login(teacher['email'])}"})
        ids = {"program_id": structure["course_id"], "batch_id": structure["batch_id"], "section_id": structure["section_id"], "subject_id": structure["subject_id"]}
        url = "/assignments/teacher-tools/external-ai-proposal/validate"
        own = {key: value for key, value in proposal.items() if key not in ("draft_ref", "schema_version")}

        headers = {"Authorization": f"Bearer {login(teacher['email'])}"}
        assert client.post(url, json={**ids, "proposal": own}, headers=headers).status_code == 200
        assert client.post(url, json={"proposal": own}, headers=headers).status_code == 422

        outsider_headers = {"Authorization": f"Bearer {login(outsider['email'])}"}
        assert client.post(url, json={**ids, "proposal": own}, headers=outsider_headers).status_code == 403

    def test_ai_proposal_validation_rejects_tampered_or_foreign_token(self, client, seed_user, seed_academic, login):
        structure = seed_academic()
        owner = seed_user(role="teacher", email="draft-owner@example.edu", assignments=_allocation(structure))
        other = seed_user(role="teacher", email="draft-other@example.edu", assignments=_allocation(structure))
        owner_headers = {"Authorization": f"Bearer {login(owner['email'])}"}
        token, proposal = self._prompt_and_proposal(client, structure, owner_headers)
        other_headers = {"Authorization": f"Bearer {login(other['email'])}"}
        url = "/assignments/teacher-tools/external-ai-proposal/validate"

        assert client.post(url, json={"draft_token": token, "proposal": proposal}, headers=other_headers).status_code == 400
        assert client.post(url, json={"draft_token": token[:-3] + "abc", "proposal": proposal}, headers=owner_headers).status_code == 400

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
        structure = seed_academic()
        owner = seed_user(role="teacher", email="owner@example.edu", assignments=_allocation(structure))
        other = seed_user(role="teacher", email="other-teacher@example.edu")
        owner_token = login(owner["email"])
        other_token = login(other["email"])

        created = client.post(
            "/assignments/teacher",
            json=_assignment_body(structure, "Owner Only", 10),
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
