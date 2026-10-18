from fastapi import HTTPException
from models.assignment import (
    SqlAssignment,
    SqlAssignmentAnnouncement,
    SqlAssignmentGrade,
    SqlAssignmentSubmission,
    SqlAssignmentSubmissionVersion,
)
from models.job import Job
from models.sql_models import SqlBatch, SqlCourse, SqlSection, SqlSubject
from services.github_repository_service import ANALYZE_JOB_TYPE
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .common import _phase, _resources, _rubric, _serialize_grade, _serialize_resource, _utc_naive, _utc_response
from .workflow import _assignment_stats, _evaluation_workflow


async def _serialize_assignment(db: AsyncSession, assignment, include_detail=True):
    subject = (await db.scalars(select(SqlSubject).filter_by(id=assignment.subject_id))).first() if assignment.subject_id else None
    course = (await db.scalars(select(SqlCourse).filter_by(id=assignment.target_course_id))).first() if assignment.target_course_id else None
    batch = (await db.scalars(select(SqlBatch).filter_by(id=assignment.target_batch_id))).first() if assignment.target_batch_id else None
    section = (await db.scalars(select(SqlSection).filter_by(id=assignment.target_section_id))).first() if assignment.target_section_id else None
    data = {
        "id": assignment.id,
        "title": assignment.title,
        "instructions": assignment.instructions,
        "short_description": assignment.short_description or "",
        "subject": assignment.subject,
        "subject_id": assignment.subject_id,
        "subject_record": None if not subject else {"id": subject.id, "name": subject.name, "code": subject.code, "credits": subject.credits},
        "difficulty": assignment.difficulty or "intermediate",
        "estimated_minutes": assignment.estimated_minutes,
        "learning_outcomes": assignment.learning_outcomes or [],
        "tags": assignment.tags or [],
        "starter_repository_url": assignment.starter_repository_url,
        "repository_requirements": assignment.repository_requirements or {},
        "target_course_id": assignment.target_course_id,
        "target_batch_id": assignment.target_batch_id,
        "target_section_id": assignment.target_section_id,
        "audience": {
            "course": None if not course else {"id": course.id, "name": course.name, "code": course.code},
            "batch": None if not batch else {"id": batch.id, "name": batch.name, "start_year": batch.start_year, "end_year": batch.end_year},
            "section": None if not section else {"id": section.id, "name": section.name},
        },
        "total_marks": assignment.total_marks,
        "opens_at": _utc_response(assignment.opens_at),
        "due_at": _utc_response(assignment.due_at),
        "allow_late": False,
        "late_until": None,
        "result_release_mode": assignment.result_release_mode or "manual",
        "result_release_at": _utc_response(assignment.result_release_at),
        "results_published_at": _utc_response(assignment.results_published_at),
        "status": assignment.status,
        "phase": _phase(assignment),
        "created_by": assignment.created_by,
        "submission_locked_at": _utc_response(assignment.submission_locked_at),
        "submission_lock_reason": assignment.submission_lock_reason,
        "evaluation_locked_at": _utc_response(assignment.evaluation_locked_at),
        "evaluation_lock_trigger": assignment.evaluation_lock_trigger,
        "repository_fetch_started_at": _utc_response(assignment.repository_fetch_started_at),
        "repository_fetch_completed_at": _utc_response(assignment.repository_fetch_completed_at),
        "created_at": _utc_response(assignment.created_at),
        "updated_at": _utc_response(assignment.updated_at),
    }
    data.update(await _assignment_stats(db, assignment))
    data["evaluation_workflow"] = await _evaluation_workflow(db, assignment)
    if include_detail:
        rubric_rows = await _rubric(db, assignment.id)
        data["rubric"] = [
            {"id": item.id, "title": item.title, "description": item.description, "max_marks": item.max_marks, "position": item.position}
            for item in rubric_rows
        ]
        data["resources"] = [_serialize_resource(item) for item in await _resources(db, assignment.id)]
        announcements = (
            await db.scalars(select(SqlAssignmentAnnouncement).filter_by(assignment_id=assignment.id).order_by(SqlAssignmentAnnouncement.created_at.desc()))
        ).all()
        data["announcements"] = [
            {"id": item.id, "title": item.title, "body": item.body, "created_at": item.created_at, "updated_at": item.updated_at} for item in announcements
        ]
    return data


async def _teacher_assignment(db: AsyncSession, assignment_id, user, *, lock=False):
    if user.get("role") != "teacher":
        raise HTTPException(403, "Teacher access required")
    query = select(SqlAssignment).filter(SqlAssignment.id == assignment_id, SqlAssignment.created_by == user["_id"])
    if lock:
        query = query.with_for_update()
    row = (await db.scalars(query)).first()
    if not row:
        raise HTTPException(404, "Assignment not found")
    return row


def _assignment_payload(assignment, body):
    for field in (
        "title",
        "instructions",
        "short_description",
        "subject",
        "subject_id",
        "difficulty",
        "estimated_minutes",
        "learning_outcomes",
        "tags",
        "starter_repository_url",
        "repository_requirements",
        "target_course_id",
        "target_batch_id",
        "target_section_id",
        "total_marks",
        "status",
        "result_release_mode",
    ):
        setattr(assignment, field, getattr(body, field))
    assignment.opens_at = _utc_naive(body.opens_at)
    assignment.due_at = _utc_naive(body.due_at)
    assignment.result_release_at = _utc_naive(body.result_release_at)
    assignment.allow_late, assignment.late_until = False, None


async def _analysis_state(db: AsyncSession, version):
    """Repository analysis status for the student/teacher UI, with retry info from the worker job."""
    if version is None:
        return None
    state = {"version_id": version.id, "commit_sha": version.commit_sha, "status": version.analysis_status}
    if version.analysis_status != "ready":
        job = (
            await db.scalars(
                select(Job).where(Job.type == ANALYZE_JOB_TYPE, Job.payload["version_id"].as_string() == version.id).order_by(Job.id.desc()).limit(1)
            )
        ).first()
        if job:
            state.update(
                job_status=job.status,
                attempt=job.attempts,
                max_attempts=job.max_attempts,
                retry_at=_utc_response(job.run_after) if job.status == "failed" else None,
            )
    return state


async def _submission_payload(db: AsyncSession, assignment, student_id, *, include_analysis=False):
    submission = (await db.scalars(select(SqlAssignmentSubmission).filter_by(assignment_id=assignment.id, student_id=student_id))).first()
    grade = (await db.scalars(select(SqlAssignmentGrade).filter_by(assignment_id=assignment.id, student_id=student_id))).first()
    versions = (
        (
            await db.scalars(
                select(SqlAssignmentSubmissionVersion).filter_by(submission_id=submission.id).order_by(SqlAssignmentSubmissionVersion.submitted_at.desc())
            )
        ).all()
        if submission
        else []
    )
    selected_version_id = (submission.frozen_version_id or submission.active_version_id or submission.pending_version_id) if submission else None
    version = next((item for item in versions if item.id == selected_version_id), None) if submission else None
    repository_url = (submission.repository_url if submission else None) or (version.repository_url if version else None)
    repository_owner = (submission.repository_owner if submission else None) or (version.repository_owner if version else None)
    repository_name = (submission.repository_name if submission else None) or (version.repository_name if version else None)
    default_branch = (submission.default_branch if submission else None) or (version.default_branch if version else None)
    pending_version = next((item for item in versions if submission and item.id == submission.pending_version_id), None)
    analysis = await _analysis_state(db, pending_version or version)
    lock_reason = None
    if assignment.evaluation_locked_at:
        lock_reason = "evaluation_started"
    elif assignment.submission_locked_at:
        lock_reason = "administrator_lock"
    elif grade and grade.status == "published":
        lock_reason = "result_published"
    elif _phase(assignment) != "open":
        lock_reason = "deadline_passed" if _phase(assignment) == "closed" else "submission_window_closed"
    elif repository_url:
        lock_reason = "repository_linked"
    serialize_version = _serialize_version if include_analysis else _serialize_student_version
    return {
        "submission": None
        if not submission
        else {
            "id": submission.id,
            "status": submission.status,
            "first_submitted_at": submission.first_submitted_at,
            "last_submitted_at": submission.last_submitted_at,
        },
        "version": None if not version else serialize_version(version),
        "versions": [serialize_version(item) for item in versions],
        "repository": None
        if not repository_url
        else {"url": repository_url, "owner": repository_owner, "name": repository_name, "default_branch": default_branch, "immutable": True},
        "analysis": analysis,
        "sync_state": None
        if not submission
        else {
            "status": submission.sync_status,
            "last_checked_at": _utc_response(submission.last_sync_checked_at),
            "last_updated_at": _utc_response(submission.last_sync_completed_at),
            "next_check_at": _utc_response(submission.next_sync_at),
            "error": submission.sync_error,
        },
        "freeze_state": None
        if not submission
        else {
            "status": "frozen" if submission.frozen_version_id else ("pending" if submission.freeze_requested_at else "live"),
            "requested_at": _utc_response(submission.freeze_requested_at),
            "frozen_at": _utc_response(submission.frozen_at),
            "reason": submission.freeze_reason,
            "version_id": submission.frozen_version_id,
        },
        "can_sync": bool(submission and repository_url and not submission.freeze_requested_at and _phase(assignment) == "open"),
        "version_count": len(versions),
        "can_submit": lock_reason is None,
        "submission_lock_reason": lock_reason,
        "grade": None if not grade or grade.status != "published" else _serialize_grade(grade),
    }


def _serialize_version(version):
    summary = dict(version.analysis_summary or {})
    summary.pop("text_hashes", None)
    return {
        "id": version.id,
        "repository_url": version.repository_url,
        "repository_owner": version.repository_owner,
        "repository_name": version.repository_name,
        "default_branch": version.default_branch,
        "commit_sha": version.commit_sha,
        "commit_message": version.commit_message,
        "commit_at": version.commit_at,
        "submitted_at": version.submitted_at,
        "is_late": version.is_late,
        "seconds_late": version.seconds_late,
        "analysis_status": version.analysis_status,
        "analysis_error": version.analysis_error,
        "analysis_summary": summary,
        "readme_markdown": version.readme_markdown,
    }


def _serialize_student_version(version):
    """Expose immutable submission evidence without teacher-only analysis data."""
    return {
        "id": version.id,
        "repository_url": version.repository_url,
        "repository_owner": version.repository_owner,
        "repository_name": version.repository_name,
        "default_branch": version.default_branch,
        "commit_sha": version.commit_sha,
        "commit_message": version.commit_message,
        "commit_at": version.commit_at,
        "submitted_at": version.submitted_at,
        "is_late": version.is_late,
        "seconds_late": version.seconds_late,
    }

