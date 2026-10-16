"""Sprint 5, IMPLEMENTATION_PLAN.md "Done when": a program admin scoped to
one program gets an empty list for another program's batches — asserted
against real rows in a real (migrated) Postgres database, not just a status
code. Docker-gated like every other real-database test in this project;
see `tests/conftest.py`.
"""

import asyncio
import uuid

from tests.conftest import requires_docker


def _seed_course_with_batch(*, course_name: str, course_code: str, batch_start_year: int):
    from models.database import async_session_factory
    from models.sql_models import SqlBatch, SqlCourse

    async def seed():
        if async_session_factory is None:
            raise RuntimeError("Async test database is unavailable")
        async with async_session_factory() as session:
            course = SqlCourse(id=str(uuid.uuid4()), name=course_name, code=course_code)
            session.add(course)
            await session.flush()
            batch = SqlBatch(id=str(uuid.uuid4()), course_id=course.id, start_year=batch_start_year, end_year=batch_start_year + 4)
            session.add(batch)
            await session.commit()
            return course.id, batch.id

    return asyncio.run(seed())


def _seed_admin_program_scope(user_id: str, program_id: str):
    from models.database import async_session_factory
    from models.sql_models import SqlAdminProgramScope

    async def seed():
        if async_session_factory is None:
            raise RuntimeError("Async test database is unavailable")
        async with async_session_factory() as session:
            session.add(SqlAdminProgramScope(user_id=user_id, program_id=program_id))
            await session.commit()

    asyncio.run(seed())


@requires_docker
class TestProgramAdminScoping:
    def test_program_admin_only_sees_their_own_program_batches(self, client, seed_user, login):
        own_course_id, own_batch_id = _seed_course_with_batch(
            course_name="B.Tech CSE", course_code="BT-CSE", batch_start_year=2024
        )
        other_course_id, other_batch_id = _seed_course_with_batch(
            course_name="BBA", course_code="BBA", batch_start_year=2024
        )

        program_admin = seed_user(role="program_admin", email="cse-admin@example.edu")
        _seed_admin_program_scope(program_admin["id"], own_course_id)
        token = login(program_admin["email"], program_admin["password"])

        response = client.get("/admin/batches", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 200
        batch_ids = {row["id"] for row in response.json()["batches"]}
        # This is the assertion the plan explicitly asks for: not just "200
        # OK", but that the *other* program's real row is verifiably absent
        # and the admin's own program's real row is verifiably present.
        assert own_batch_id in batch_ids
        assert other_batch_id not in batch_ids

    def test_program_admin_with_no_scopes_sees_no_batches(self, client, seed_user, login):
        """A program admin who was created (or had their scopes cleared)
        without any `admin_program_scopes` row must see an empty list, not
        every batch — `scope_to_programs` treats "no scopes" as "nothing",
        never as "unscoped"."""
        _seed_course_with_batch(course_name="B.Des", course_code="BDES", batch_start_year=2024)
        program_admin = seed_user(role="program_admin", email="scopeless-admin@example.edu")
        token = login(program_admin["email"], program_admin["password"])

        response = client.get("/admin/batches", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 200
        assert response.json()["batches"] == []

    def test_super_admin_sees_every_program_batch(self, client, seed_user, login):
        _, batch_a = _seed_course_with_batch(course_name="Course A", course_code="CA", batch_start_year=2024)
        _, batch_b = _seed_course_with_batch(course_name="Course B", course_code="CB", batch_start_year=2024)
        admin = seed_user(role="super_admin", email="root-super-admin@example.edu")
        token = login(admin["email"], admin["password"])

        response = client.get("/admin/batches", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 200
        batch_ids = {row["id"] for row in response.json()["batches"]}
        assert {batch_a, batch_b} <= batch_ids
