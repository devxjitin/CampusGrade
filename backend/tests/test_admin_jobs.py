"""Super Admin jobs endpoints and the shared rate limiter (Sprint 2, S2-08/S2-09)."""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from tests.conftest import requires_docker


def _sql(database_url, statement, params=None):
    async def run():
        engine = create_async_engine(database_url.replace("postgresql+psycopg://", "postgresql+asyncpg://"))
        try:
            async with async_sessionmaker(engine)() as db:
                result = await db.execute(text(statement), params or {})
                rows = result.fetchall() if result.returns_rows else None
                await db.commit()
                return rows
        finally:
            await engine.dispose()

    return asyncio.run(run())


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@requires_docker
class TestAdminJobs:
    def test_lists_and_retries_dead_jobs(self, client, seed_user, login, database_url):
        admin = seed_user(role="super_admin", email="jobs-admin@example.edu")
        token = login(admin["email"])
        _sql(database_url, "DELETE FROM jobs")
        _sql(
            database_url,
            "INSERT INTO jobs (type, payload, status, attempts, max_attempts, last_error) "
            "VALUES ('repository.analyze', '{\"version_id\": \"v1\"}', 'dead', 4, 4, 'boom'), "
            "('repository.analyze', '{}', 'queued', 0, 4, NULL)",
        )

        listed = client.get("/admin/jobs?status=dead", headers=_auth(token))
        assert listed.status_code == 200
        body = listed.json()
        assert body["total"] == 1 and body["jobs"][0]["last_error"] == "boom"
        assert body["counts"]["queued"] == 1

        job_id = body["jobs"][0]["id"]
        retried = client.post(f"/admin/jobs/{job_id}/retry", headers=_auth(token))
        assert retried.status_code == 200
        assert retried.json()["job"]["status"] == "queued" and retried.json()["job"]["attempts"] == 0
        assert client.post(f"/admin/jobs/{job_id}/retry", headers=_auth(token)).status_code == 409

    def test_rejects_invalid_status_filter(self, client, seed_user, login):
        admin = seed_user(role="super_admin", email="jobs-admin2@example.edu")
        token = login(admin["email"])
        assert client.get("/admin/jobs?status=bogus", headers=_auth(token)).status_code == 422

    def test_students_cannot_see_jobs(self, client, seed_user, login):
        student = seed_user(role="student", email="jobs-student@example.edu")
        token = login(student["email"])
        assert client.get("/admin/jobs", headers=_auth(token)).status_code == 403


@requires_docker
def test_rate_limit_counters_are_shared_through_the_database(database_url, monkeypatch):
    from services import rate_limiter

    async def scenario():
        engine = create_async_engine(database_url.replace("postgresql+psycopg://", "postgresql+asyncpg://"))
        monkeypatch.setattr(rate_limiter.database, "async_session_factory", async_sessionmaker(engine, expire_on_commit=False))
        try:
            results = await asyncio.gather(*[rate_limiter.hit("test-shared", 3, 60) for _ in range(6)])
        finally:
            await engine.dispose()
        return results

    results = asyncio.run(scenario())
    assert sum(1 for allowed, _ in results if allowed) == 3
    assert all(retry >= 1 for allowed, retry in results if not allowed)


@requires_docker
class TestAdminUserDetailsStats:
    """`/admin/user/{id}/details` computes assignment stats with the async helpers (S2-07)."""

    def test_teacher_details_include_assignment_progress(self, client, seed_user, login, database_url):
        import datetime
        import uuid

        from models.assignment import SqlAssignment
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        admin = seed_user(role="super_admin", email="details-admin@example.edu")
        teacher = seed_user(role="teacher", email="details-teacher@example.edu")
        token = login(admin["email"])
        due = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(days=2)
        engine = create_engine(database_url)
        with Session(engine) as session:
            session.add(
                SqlAssignment(
                    id=str(uuid.uuid4()),
                    title="Stats assignment",
                    instructions="",
                    short_description="",
                    difficulty="intermediate",
                    total_marks=10,
                    due_at=due,
                    status="published",
                    created_by=teacher["id"],
                )
            )
            session.commit()
        engine.dispose()

        response = client.get(f"/admin/user/{teacher['id']}/details", headers=_auth(token))

        assert response.status_code == 200, response.text
        user = response.json()["user"]
        assert user["owned_assignments"][0]["title"] == "Stats assignment"
        assert set(user["assignment_summary"]) >= {"created", "closed_eligible", "submissions", "missed", "overdue_evaluations"}
        assert user["subject_progress"] and user["evaluation_overdue"] is False

    def test_unknown_user_is_404(self, client, seed_user, login):
        admin = seed_user(role="super_admin", email="details-admin2@example.edu")
        token = login(admin["email"])
        assert client.get("/admin/user/nope/details", headers=_auth(token)).status_code == 404
