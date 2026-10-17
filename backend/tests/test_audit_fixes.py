import asyncio
import datetime
import os
import threading
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from app import app
from fastapi import HTTPException, Response
from models.assignment import (
    SqlAssignment,
    SqlAssignmentEvaluationParticipant,
    SqlAssignmentGrade,
    SqlAssignmentGradeRevision,
    SqlAssignmentRubric,
)
from models.database import is_database_available
from models.notification import SqlNotification
from models.sql_models import SqlUser
from pydantic import ValidationError
from routes_fastapi.admin_routes import (
    _assert_admin_continuity,
    _lock_user_safety_context,
)
from routes_fastapi.assignment_routes import (
    _advance_saved_grade_revision,
    _assignment_students,
    _evaluation_workflow,
    _submission_has_content,
    _teacher_assignment,
    publish_ready_assignment_results,
)
from routes_fastapi.auth_routes import login
from schemas.auth import LoginRequest
from schemas.user import TemporaryCredentialResponse, UserStatusUpdate
from services.github_repository_service import _refresh_duplicate_flag
from sqlalchemy import select


def test_first_grade_save_stays_at_revision_one_and_later_saves_advance_once():
    grade = SimpleNamespace(revision=1)

    _advance_saved_grade_revision(grade, is_new=True)
    assert grade.revision == 1

    _advance_saved_grade_revision(grade, is_new=False)
    assert grade.revision == 2


@pytest.mark.parametrize(
    "field",
    [
        "repository_url",
        "active_version_id",
        "pending_version_id",
        "frozen_version_id",
    ],
)
def test_every_live_repository_pointer_counts_as_submission_content(field):
    submission = SimpleNamespace(
        repository_url=None,
        active_version_id=None,
        pending_version_id=None,
        frozen_version_id=None,
    )
    setattr(submission, field, "value")

    assert _submission_has_content(submission)


def test_reset_submission_without_repository_pointers_does_not_block_editing():
    submission = SimpleNamespace(
        repository_url=None,
        active_version_id=None,
        pending_version_id=None,
        frozen_version_id=None,
        status="reset",
    )

    assert not _submission_has_content(submission)


def test_admin_cannot_enter_teacher_assignment_helper():
    with pytest.raises(HTTPException) as raised:
        asyncio.run(_teacher_assignment(None, "assignment-1", {"_id": "admin-1", "role": "super_admin"}))

    assert raised.value.status_code == 403


def test_admin_cannot_delete_or_deactivate_self():
    admin = SimpleNamespace(id="admin-1", role="super_admin", is_active=True)

    with pytest.raises(HTTPException) as deleting:
        _assert_admin_continuity(admin, [admin], "admin-1", deleting=True)
    with pytest.raises(HTTPException) as deactivating:
        _assert_admin_continuity(admin, [admin], "admin-1", next_active=False)

    assert deleting.value.status_code == 409
    assert deactivating.value.status_code == 409


def test_last_active_admin_cannot_be_removed_by_another_admin_session():
    target = SimpleNamespace(id="admin-1", role="super_admin", is_active=True)

    with pytest.raises(HTTPException) as raised:
        _assert_admin_continuity(target, [target], "admin-2", deleting=True)

    assert raised.value.status_code == 409
    assert "At least one" in raised.value.detail


def test_one_admin_can_be_removed_when_another_active_admin_remains():
    target = SimpleNamespace(id="admin-1", role="super_admin", is_active=True)
    survivor = SimpleNamespace(id="admin-2", role="super_admin", is_active=True)

    _assert_admin_continuity(target, [target, survivor], "admin-2", deleting=True)


def test_similarity_refresh_preserves_review_metadata():
    reviewed_at = object()
    flag = SimpleNamespace(
        similarity=0.72,
        reviewed=True,
        review_status="rejected",
        reviewed_by="teacher-1",
        reviewed_at=reviewed_at,
        review_notes="False positive",
    )

    _refresh_duplicate_flag(flag, 0.91)

    assert flag.similarity == 0.91
    assert flag.reviewed is True
    assert flag.review_status == "rejected"
    assert flag.reviewed_by == "teacher-1"
    assert flag.reviewed_at is reviewed_at
    assert flag.review_notes == "False positive"


def test_user_status_requires_is_active():
    with pytest.raises(ValidationError):
        UserStatusUpdate.model_validate({})


def test_temporary_credential_contract_uses_consistent_wire_field():
    response = TemporaryCredentialResponse.model_validate(
        {
            "message": "Created",
            "temporary_password": "OneTime!Password123",
            "user": {
                "id": "student-1",
                "name": "Student One",
                "email": "student@example.com",
                "role": "student",
            },
        }
    )

    assert response.model_dump()["temporary_password"] == "OneTime!Password123"
    operation = app.openapi()["paths"]["/admin/add-student"]["post"]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("TemporaryCredentialResponse")


def test_login_role_filter_rejects_account_from_wrong_sign_in_page():
    request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))
    user = {
        "_id": "teacher-1",
        "name": "Teacher",
        "email": "teacher@example.com",
        "role": "teacher",
        "session_version": 0,
    }

    with (
        patch("routes_fastapi.auth_routes._enforce_login_rate_limit"),
        patch(
            "routes_fastapi.auth_routes.auth_service.authenticate",
            return_value=user,
        ),
    ):
        with pytest.raises(HTTPException) as raised:
            asyncio.run(
                login(
                    LoginRequest(email="teacher@example.com", password="ValidPassword!123"),
                    request,
                    Response(),
                    role="student",
                )
            )

    assert raised.value.status_code == 403


db_concurrency = pytest.mark.skipif(
    os.environ.get("CANVASGRADE_RUN_DB_CONCURRENCY") != "1",
    reason="set CANVASGRADE_RUN_DB_CONCURRENCY=1 to exercise PostgreSQL row locks",
)


@db_concurrency
def test_concurrent_scheduled_publishers_release_an_assignment_once():
    from models.database import async_session_factory, init_database

    asyncio.run(init_database())
    if not is_database_available():
        pytest.skip("PostgreSQL is unavailable")

    def run_db(callback):
        async def run():
            assert async_session_factory is not None
            async with async_session_factory() as async_session:
                try:
                    result = await async_session.run_sync(callback)
                    await async_session.commit()
                    return result
                except Exception:
                    await async_session.rollback()
                    raise

        return asyncio.run(run())

    def run_async(callback):
        async def run():
            assert async_session_factory is not None
            async with async_session_factory() as async_session:
                try:
                    result = await callback(async_session)
                    await async_session.commit()
                    return result
                except Exception:
                    await async_session.rollback()
                    raise

        return asyncio.run(run())

    async def _publish_count(async_session, release_time):
        return len(await publish_ready_assignment_results(async_session, release_time))

    suffix = uuid.uuid4().hex
    teacher_id, student_id, assignment_id = f"t-{suffix}", f"s-{suffix}", f"a-{suffix}"
    rubric_id, grade_id = f"r-{suffix}", f"g-{suffix}"
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

    def seed(setup):
        setup.add_all(
            [
                SqlUser(id=teacher_id, name="Concurrency Teacher", email=f"{teacher_id}@example.com", password="test", role="teacher", is_active=True),
                SqlUser(id=student_id, name="Concurrency Student", email=f"{student_id}@example.com", password="test", role="student", is_active=True),
            ]
        )
        setup.flush()
        setup.add(
            SqlAssignment(
                id=assignment_id,
                title="Concurrent release",
                instructions="",
                short_description="",
                difficulty="intermediate",
                total_marks=10,
                due_at=now - datetime.timedelta(hours=2),
                result_release_mode="scheduled",
                result_release_at=now - datetime.timedelta(hours=1),
                status="published",
                evaluation_locked_at=now - datetime.timedelta(hours=2),
                evaluation_lock_trigger="deadline",
                repository_fetch_started_at=now - datetime.timedelta(hours=2),
                repository_fetch_completed_at=now - datetime.timedelta(hours=2),
                created_by=teacher_id,
            )
        )
        setup.flush()
        setup.add_all(
            [
                SqlAssignmentRubric(id=rubric_id, assignment_id=assignment_id, title="Correctness", description="", max_marks=10, position=0),
                SqlAssignmentEvaluationParticipant(
                    id=f"p-{suffix}", assignment_id=assignment_id, student_id=student_id, submission_version_id=None, status="missing", locked_at=now
                ),
                SqlAssignmentGrade(
                    id=grade_id,
                    assignment_id=assignment_id,
                    student_id=student_id,
                    rubric_scores={rubric_id: 0},
                    feedback="",
                    total_awarded=0,
                    is_missing=True,
                    status="draft",
                    revision=1,
                    evaluation_source="automatic_missing",
                    evaluation_metadata={
                        "rubric_feedback": {
                            rubric_id: {
                                "what_was_done_well": "No assessable repository evidence was available.",
                                "what_is_missing": "No repository was submitted before the deadline.",
                            }
                        }
                    },
                ),
            ]
        )
        setup.flush()
        assert (
            setup.query(SqlAssignment)
            .filter(
                SqlAssignment.id == assignment_id,
                SqlAssignment.status == "published",
                SqlAssignment.result_release_mode == "scheduled",
                SqlAssignment.results_published_at.is_(None),
                SqlAssignment.due_at <= now,
                SqlAssignment.result_release_at <= now,
            )
            .count()
            == 1
        )
        assert setup.query(SqlAssignmentEvaluationParticipant).filter_by(assignment_id=assignment_id).count() == 1
        assert setup.query(SqlAssignmentGrade).filter_by(assignment_id=assignment_id).count() == 1

    async def check_helpers(async_session):
        assignment = (await async_session.scalars(select(SqlAssignment).filter_by(id=assignment_id))).one()
        assert [student.id for student in await _assignment_students(async_session, assignment)] == [student_id]
        assert (await _evaluation_workflow(async_session, assignment))["can_evaluate"] is True

    run_db(seed)
    run_async(check_helpers)
    try:
        barrier = threading.Barrier(2)
        results = []

        def publish():
            barrier.wait(timeout=5)
            results.append(run_async(lambda async_session: _publish_count(async_session, now)))

        threads = [threading.Thread(target=publish) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        def verify(setup):
            grade = setup.query(SqlAssignmentGrade).filter_by(id=grade_id).one()
            assignment = setup.query(SqlAssignment).filter_by(id=assignment_id).one()
            return (
                grade.status,
                grade.revision,
                assignment.results_published_at,
                setup.query(SqlAssignmentGradeRevision).filter_by(grade_id=grade_id, action="published").count(),
                setup.query(SqlNotification).filter_by(user_id=student_id, title="Assignment grade published").count(),
            )

        status, revision, published_at, revision_count, notification_count = run_db(verify)
        assert sorted(results) == [0, 1]
        assert status == "published"
        assert revision == 2
        assert published_at is not None
        assert revision_count == 1
        assert notification_count == 1
    finally:

        def cleanup(setup):
            setup.query(SqlAssignment).filter_by(id=assignment_id).delete(synchronize_session=False)
            setup.query(SqlUser).filter(SqlUser.id.in_([teacher_id, student_id])).delete(synchronize_session=False)

        run_db(cleanup)


@db_concurrency
def test_concurrent_admin_removals_cannot_delete_every_active_admin():
    from models.database import async_session_factory, init_database

    asyncio.run(init_database())
    if not is_database_available():
        pytest.skip("PostgreSQL is unavailable")

    def run_db(callback):
        async def run():
            assert async_session_factory is not None
            async with async_session_factory() as async_session:
                try:
                    result = await async_session.run_sync(callback)
                    await async_session.commit()
                    return result
                except Exception:
                    await async_session.rollback()
                    raise

        return asyncio.run(run())

    suffix = uuid.uuid4().hex
    admin_ids = [f"admin-a-{suffix}", f"admin-b-{suffix}"]

    def seed(setup):
        if setup.query(SqlUser).filter(SqlUser.role == "super_admin", SqlUser.is_active.is_(True)).count():
            return False
        setup.add_all(
            [
                SqlUser(id=admin_id, name=f"Admin {index}", email=f"{admin_id}@example.com", password="test", role="super_admin", is_active=True)
                for index, admin_id in enumerate(admin_ids)
            ]
        )
        setup.flush()
        return True

    if not run_db(seed):
        pytest.skip("admin lock test requires an otherwise empty test database")
    try:
        barrier = threading.Barrier(2)
        outcomes = []

        def remove(actor_id, target_id):
            try:
                barrier.wait(timeout=5)

                def remove_locked(session):
                    user, active_admins = _lock_user_safety_context(session, target_id)
                    _assert_admin_continuity(user, active_admins, actor_id, deleting=True)
                    session.delete(user)

                run_db(remove_locked)
                outcomes.append("deleted")
            except HTTPException as exc:
                outcomes.append(exc.status_code)

        threads = [
            threading.Thread(target=remove, args=(admin_ids[0], admin_ids[1])),
            threading.Thread(target=remove, args=(admin_ids[1], admin_ids[0])),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        survivors = run_db(
            lambda setup: setup.query(SqlUser).filter(SqlUser.id.in_(admin_ids), SqlUser.role == "super_admin", SqlUser.is_active.is_(True)).count()
        )
        assert survivors == 1
        assert sorted(outcomes, key=str) == [409, "deleted"]
    finally:
        run_db(lambda setup: setup.query(SqlUser).filter(SqlUser.id.in_(admin_ids)).delete(synchronize_session=False))
