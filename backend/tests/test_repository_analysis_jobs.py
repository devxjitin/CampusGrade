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


@requires_docker
def test_pushes_are_only_noted_while_open_and_extracted_once_at_the_end(client, seed_user, database_url):
    from models.assignment import SqlAssignment, SqlAssignmentSubmission, SqlAssignmentSubmissionVersion
    from models.database import async_session_factory
    from services import github_repository_service as repository_service

    teacher = seed_user(role="teacher", email="extract-teacher@example.edu")
    student = seed_user(role="student", email="extract-student@example.edu")
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    assignment_id, submission_id, version_id = (str(uuid.uuid4()) for _ in range(3))
    url = "https://github.com/someone/project"

    engine = create_engine(database_url)
    with Session(engine) as session:
        session.add(
            SqlAssignment(
                id=assignment_id, title="Extract", instructions="", short_description="", difficulty="intermediate", total_marks=10,
                due_at=now + datetime.timedelta(days=1), status="published", created_by=teacher["id"],
            )
        )
        session.commit()

    def head(sha):
        return {"commit_sha": sha, "default_branch": "main", "commit_message": "work", "commit_at": None}

    with Session(engine) as session:
        session.add(
            SqlAssignmentSubmission(
                id=submission_id, assignment_id=assignment_id, student_id=student["id"], first_submitted_at=now, last_submitted_at=now, status="submitted",
                repository_url=url, repository_owner="someone", repository_name="project", default_branch="main", latest_remote_sha="a" * 40,
                active_version_id=None, sync_status="live",
            )
        )
        session.flush()
        session.add(
            SqlAssignmentSubmissionVersion(
                id=version_id, submission_id=submission_id, repository_generation=1, detected_at=now, detection_source="student", repository_url=url,
                repository_owner="someone", repository_name="project", default_branch="main", commit_sha="a" * 40, submitted_at=now, is_late=False,
                seconds_late=0, analysis_status="ready",
            )
        )
        session.flush()
        session.get(SqlAssignmentSubmission, submission_id).active_version_id = version_id
        session.commit()

    async def run(sha, coroutine):
        with patch.object(repository_service, "preview_repository", return_value=head(sha)):
            return await coroutine

    async def sync():
        async with async_session_factory() as db:
            return await repository_service.sync_submission_repository(db, submission_id, force=True)

    def counts():
        with Session(engine) as session:
            versions = session.execute(text("SELECT count(*) FROM assignment_submission_versions WHERE submission_id = :id"), {"id": submission_id}).scalar_one()
            jobs_queued = session.execute(text("SELECT count(*) FROM jobs WHERE type = 'repository.analyze'")).scalar_one()
        return versions, jobs_queued

    # Three pushes while the assignment is open: nothing is downloaded, only the newest commit is noted.
    for sha in ("b" * 40, "c" * 40, "d" * 40):
        assert asyncio.run(run(sha, sync()))["head_changed"] is True
    assert counts() == (1, 0)
    with Session(engine) as session:
        assert session.execute(text("SELECT latest_remote_sha FROM assignment_submissions WHERE id = :id"), {"id": submission_id}).scalar_one() == "d" * 40

    # The final extraction takes the newest commit once and queues exactly one analysis.
    asyncio.run(run("d" * 40, repository_service.extract_final_snapshot(submission_id)))
    assert counts() == (2, 1)
    with Session(engine) as session:
        status, pending, frozen = session.execute(
            text("SELECT sync_status, pending_version_id, frozen_version_id FROM assignment_submissions WHERE id = :id"), {"id": submission_id}
        ).one()
    engine.dispose()
    assert (status, frozen) == ("freeze_pending", None) and pending
