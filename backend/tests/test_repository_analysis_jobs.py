"""A repository that cannot be analysed fails its job (retry -> dead), not silently (S2-11)."""

import asyncio
import datetime
import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from tests.conftest import requires_docker


@requires_docker
def test_failed_analysis_raises_for_retry_and_notifies_once(client, seed_user, database_url):
    # `client` re-imports the app graph against the test database; import under it.
    from models.assignment import SqlAssignment, SqlAssignmentSubmission, SqlAssignmentSubmissionVersion
    from models.database import async_session_factory
    from routes_fastapi.assignments.payloads import _analysis_state
    from services import github_repository_service as repository_service

    teacher = seed_user(role="teacher", email="analysis-teacher@example.edu")
    student = seed_user(role="student", email="analysis-student@example.edu")
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    assignment_id, submission_id, version_id = (str(uuid.uuid4()) for _ in range(3))

    engine = create_engine(database_url)
    with Session(engine) as session:
        session.add(
            SqlAssignment(
                id=assignment_id,
                title="Analysis failure",
                instructions="",
                short_description="",
                difficulty="intermediate",
                total_marks=10,
                due_at=now + datetime.timedelta(days=1),
                status="published",
                created_by=teacher["id"],
            )
        )
        session.flush()
        session.add(
            SqlAssignmentSubmission(
                id=submission_id, assignment_id=assignment_id, student_id=student["id"], first_submitted_at=now, last_submitted_at=now, status="submitted"
            )
        )
        session.flush()
        session.add(
            SqlAssignmentSubmissionVersion(
                id=version_id,
                submission_id=submission_id,
                repository_generation=1,
                detected_at=now,
                detection_source="student",
                repository_url="https://github.com/nobody/does-not-exist",
                repository_owner="nobody",
                repository_name="does-not-exist",
                default_branch="main",
                commit_sha="a" * 40,
                submitted_at=now,
                is_late=False,
                seconds_late=0,
                analysis_status="queued",
            )
        )
        session.commit()

    async def attempt():
        with patch.object(repository_service, "_download", side_effect=repository_service.GitHubRepositoryError("repository not found")):
            with pytest.raises(repository_service.GitHubRepositoryError):
                await repository_service.analyze_repository_version(version_id)

    async def state():
        async with async_session_factory() as db:
            return await _analysis_state(db, await db.get(SqlAssignmentSubmissionVersion, version_id))

    asyncio.run(attempt())
    asyncio.run(attempt())  # the retry

    with Session(engine) as session:
        status, error = session.execute(
            text("SELECT analysis_status, analysis_error FROM assignment_submission_versions WHERE id = :id"), {"id": version_id}
        ).one()
        notifications = session.execute(
            text("SELECT count(*) FROM notifications WHERE dedupe_key = :key"), {"key": f"repository-analysis-failed:{version_id}"}
        ).scalar_one()
    engine.dispose()

    assert status == "failed" and "repository not found" in error
    assert notifications == 1  # one teacher notification across both attempts
    result = asyncio.run(state())
    assert result["status"] == "failed" and result["commit_sha"] == "a" * 40
