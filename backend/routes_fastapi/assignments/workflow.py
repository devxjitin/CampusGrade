import datetime
import uuid

import jwt
from fastapi import HTTPException
from models.assignment import (
    SqlAssignment,
    SqlAssignmentDuplicateFlag,
    SqlAssignmentEvaluationParticipant,
    SqlAssignmentGrade,
    SqlAssignmentGradeRevision,
    SqlAssignmentResource,
    SqlAssignmentRubric,
    SqlAssignmentSubmission,
    SqlAssignmentSubmissionVersion,
)
from models.sql_models import SqlBatch, SqlCourse, SqlSection, SqlSubject, SqlUser
from services import jobs
from services.assignment_external_evaluation import sanitize_external_feedback
from services.github_repository_service import EXTRACT_FINAL_JOB_TYPE
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .common import (
    _assignment_students,
    _eligible_students,
    _evaluation_participants,
    _notification,
    _now,
    _phase,
    _rubric,
    _snapshot_grade,
    _student_has_assignment_access,
    _submission_has_content,
    _submission_map,
)


async def _lock_evaluation_cohort(db: AsyncSession, assignment, *, actor_id=None, trigger: str, now=None):
    """Freeze the current academic group and create deadline missing-zero drafts once."""
    now = now or _now()
    if assignment.evaluation_locked_at:
        return await _evaluation_participants(db, assignment)
    students = await _eligible_students(db, assignment)
    submissions = await _submission_map(db, assignment.id)
    participants = []
    for student in students:
        submission = submissions.get(student.id)
        version_id = None
        has_repository = bool(submission and submission.repository_url)
        if has_repository:
            version_id = submission.frozen_version_id
            if not submission.freeze_requested_at:
                # Evaluation was not started by a teacher: take the final snapshot from GitHub now.
                submission.freeze_requested_at, submission.freeze_reason = now, "deadline"
                submission.next_sync_at = None
                submission.pending_version_id, submission.sync_status = None, "freeze_pending"
                await jobs.enqueue(db, EXTRACT_FINAL_JOB_TYPE, {"submission_id": submission.id}, max_attempts=6)
        participant = (
            await db.scalars(select(SqlAssignmentEvaluationParticipant).filter_by(assignment_id=assignment.id, student_id=student.id))
        ).first()
        if participant:
            participant.submission_version_id = participant.submission_version_id or version_id
            participant.status = "submitted" if (participant.submission_version_id or has_repository) else "missing"
        else:
            participant = SqlAssignmentEvaluationParticipant(
                id=str(uuid.uuid4()),
                assignment_id=assignment.id,
                student_id=student.id,
                submission_version_id=version_id,
                status="submitted" if has_repository else "missing",
                locked_at=now,
            )
            db.add(participant)
        participants.append(participant)
        if trigger == "deadline" and not has_repository:
            grade = (await db.scalars(select(SqlAssignmentGrade).filter_by(assignment_id=assignment.id, student_id=student.id))).first()
            if not grade:
                rubric = await _rubric(db, assignment.id)
                grade = SqlAssignmentGrade(
                    id=str(uuid.uuid4()),
                    assignment_id=assignment.id,
                    student_id=student.id,
                    submission_version_id=None,
                    rubric_scores={item.id: 0 for item in rubric},
                    feedback="",
                    total_awarded=0,
                    is_missing=True,
                    status="draft",
                    revision=1,
                    evaluated_by=None,
                    evaluated_at=now,
                    evaluation_source="automatic_missing",
                    evaluation_metadata={
                        "trigger": "deadline",
                        "rubric_feedback": _automatic_zero_rubric_feedback(rubric, "No repository was submitted before the deadline."),
                    },
                )
                db.add(grade)
                db.add(
                    SqlAssignmentGradeRevision(
                        id=str(uuid.uuid4()), grade_id=grade.id, action="automatic_missing_zero", snapshot=_snapshot_grade(grade), actor_id=None
                    )
                )
    assignment.evaluation_locked_at = now
    assignment.evaluation_locked_by = actor_id
    assignment.evaluation_lock_trigger = trigger
    assignment.repository_fetch_started_at = assignment.repository_fetch_started_at or now
    return participants


async def _evaluation_workflow(db: AsyncSession, assignment):
    phase = _phase(assignment)
    students = await _assignment_students(db, assignment)
    submissions = await _submission_map(db, assignment.id)
    submitted = sum(bool(submissions.get(student.id) and submissions[student.id].active_version_id) for student in students)
    total = len(students)
    all_submitted = bool(total) and submitted == total
    deadline_passed = phase == "closed"
    participants = await _evaluation_participants(db, assignment) if assignment.evaluation_locked_at else []
    version_ids = [row.submission_version_id for row in participants if row.submission_version_id]
    statuses = {}
    if version_ids:
        for row in (await db.scalars(select(SqlAssignmentSubmissionVersion).filter(SqlAssignmentSubmissionVersion.id.in_(version_ids)))).all():
            statuses[row.analysis_status] = statuses.get(row.analysis_status, 0) + 1
    ready = statuses.get("ready", 0)
    failed = statuses.get("failed", 0)
    unresolved = sum(1 for row in participants if row.status == "submitted" and not row.submission_version_id)
    pending = len(version_ids) - ready - failed + unresolved
    if not assignment.evaluation_locked_at:
        fetch_status = "eligible" if (all_submitted or deadline_passed) else "waiting_for_submissions"
    elif not assignment.repository_fetch_started_at:
        fetch_status = "not_started"
    elif failed:
        fetch_status = "failed"
    elif pending:
        fetch_status = "processing"
    else:
        fetch_status = "ready" if assignment.repository_fetch_completed_at else "processing"
    return {
        "eligible_count": total,
        "submitted_count": submitted,
        "missing_count": max(0, total - submitted),
        "all_submitted": all_submitted,
        "deadline_passed": deadline_passed,
        "can_fetch": bool(total)
        and not assignment.repository_fetch_completed_at
        and (
            (not assignment.evaluation_locked_at and (all_submitted or deadline_passed))
            or (assignment.evaluation_locked_at and (not assignment.repository_fetch_started_at or failed))
        ),
        "can_evaluate": bool(assignment.repository_fetch_completed_at and not failed and not pending),
        "fetch_status": fetch_status,
        "ready_count": ready,
        "failed_count": failed,
        "pending_count": pending,
        "roster_locked": bool(assignment.evaluation_locked_at),
        "lock_trigger": assignment.evaluation_lock_trigger,
        "repository_fetch_started_at": assignment.repository_fetch_started_at,
        "repository_fetch_completed_at": assignment.repository_fetch_completed_at,
    }


async def _assert_evaluation_allowed(db: AsyncSession, assignment, student_id=None):
    if student_id:
        submission = (await db.scalars(select(SqlAssignmentSubmission).filter_by(assignment_id=assignment.id, student_id=student_id))).first()
        if not submission or not submission.frozen_version_id:
            raise HTTPException(409, "Start evaluation and wait for the frozen repository snapshot")
        version = (await db.scalars(select(SqlAssignmentSubmissionVersion).filter_by(id=submission.frozen_version_id))).first()
        if not version or version.analysis_status != "ready":
            raise HTTPException(409, "Wait for the frozen repository snapshot to finish processing")
        return {"can_evaluate": True, "version_id": version.id}
    workflow = await _evaluation_workflow(db, assignment)
    if workflow["can_evaluate"]:
        return workflow
    if not workflow["all_submitted"] and not workflow["deadline_passed"]:
        raise HTTPException(409, f"Evaluation opens after all {workflow['eligible_count']} students submit or after the deadline")
    if not workflow["roster_locked"]:
        raise HTTPException(409, "Fetch all repositories to lock the evaluation cohort")
    if workflow["fetch_status"] == "failed":
        raise HTTPException(409, "Retry failed repository fetches before evaluation")
    raise HTTPException(409, "Wait for every repository fetch and analysis to finish before evaluation")


def _check_context_rows(course, batch, section, subject) -> None:
    """Validate that program, batch, section and subject form one consistent chain."""
    if not course:
        raise HTTPException(404, "Program not found")
    if not batch or batch.course_id != course.id:
        raise HTTPException(400, "Batch does not belong to the selected program")
    if not section or section.batch_id != batch.id or section.course_id != course.id:
        raise HTTPException(400, "Section does not belong to the selected batch")
    if not subject:
        raise HTTPException(404, "Subject not found")
    if subject.course_id != course.id:
        raise HTTPException(400, "Subject does not belong to the selected program")
    if subject.batch_id and subject.batch_id != batch.id:
        raise HTTPException(400, "Subject does not belong to the selected batch")


def _teacher_allocated(allocations, program_id: str, batch_id: str, section_id: str, subject_id: str) -> bool:
    for item in allocations or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("program_id") or item.get("course_id") or "") != program_id:
            continue
        if str(item.get("batch_id") or "") != batch_id or str(item.get("section_id") or "") != section_id:
            continue
        if subject_id in {str(value) for value in item.get("subject_ids") or []}:
            return True
    return False


async def _resolve_assignment_context(db: AsyncSession, program_id, batch_id, section_id, subject_id, user):
    """Load and validate program > batch > section > subject; teachers must also be allocated to the combination."""
    program_id, batch_id, section_id, subject_id = (str(value or "") for value in (program_id, batch_id, section_id, subject_id))
    if not (program_id and batch_id and section_id and subject_id):
        raise HTTPException(400, "Select program, batch, section and subject first")
    course = await db.get(SqlCourse, program_id)
    batch = await db.get(SqlBatch, batch_id)
    section = await db.get(SqlSection, section_id)
    subject = await db.get(SqlSubject, subject_id)
    _check_context_rows(course, batch, section, subject)
    if user.get("role") == "teacher" and not _teacher_allocated(user.get("assignments"), program_id, batch_id, section_id, subject_id):
        raise HTTPException(403, "You are not allocated to this program, batch, section and subject")
    return course, batch, section, subject


async def _validate_assignment_subject(db: AsyncSession, body, user):
    """Validate the audience context of an assignment and set its subject name."""
    *_, subject = await _resolve_assignment_context(db, body.target_course_id, body.target_batch_id, body.target_section_id, body.subject_id, user)
    body.subject = subject.name
    return subject


def _overdue_ungraded_submission_count(assignment, submitted_student_ids, graded_student_ids, now=None):
    now = now or _now()
    if _phase(assignment, now) != "closed" or not assignment.due_at or now < assignment.due_at + datetime.timedelta(hours=24):
        return 0
    return len(set(submitted_student_ids) - set(graded_student_ids))


async def _assignment_stats(db: AsyncSession, assignment):
    eligible = await _assignment_students(db, assignment)
    eligible_ids = [student.id for student in eligible]
    submissions = (await db.scalars(select(SqlAssignmentSubmission).filter_by(assignment_id=assignment.id))).all()
    submitted_ids = {submission.student_id for submission in submissions if submission.student_id in eligible_ids and _submission_has_content(submission)}
    submission_count = len(submitted_ids)
    all_grades = (await db.scalars(select(SqlAssignmentGrade).filter_by(assignment_id=assignment.id))).all()
    grades = [grade for grade in all_grades if grade.student_id in eligible_ids]
    graded_ids = {grade.student_id for grade in grades}
    published_count = sum(grade.status == "published" for grade in grades)
    phase = _phase(assignment)
    deadline_passed = phase == "closed"
    overdue_ungraded_count = _overdue_ungraded_submission_count(
        assignment,
        submitted_ids,
        graded_ids,
    )
    if assignment.status == "archived":
        workflow = "archived"
    elif phase in {"scheduled", "open"}:
        workflow = phase
    elif eligible_ids and published_count >= len(eligible_ids):
        workflow = "completed"
    elif published_count:
        workflow = "results_partial"
    else:
        workflow = "awaiting_grading"
    return {
        "eligible_count": len(eligible),
        "submission_count": submission_count,
        "pending_submission_count": max(0, len(eligible_ids) - submission_count) if not deadline_passed else 0,
        "closed_eligible_count": len(eligible_ids) if deadline_passed else 0,
        "missed_count": max(0, len(eligible_ids) - submission_count) if deadline_passed else 0,
        "submission_rate": round((submission_count / len(eligible_ids)) * 100, 2) if deadline_passed and eligible_ids else None,
        "missed_rate": round(((len(eligible_ids) - submission_count) / len(eligible_ids)) * 100, 2) if deadline_passed and eligible_ids else None,
        "graded_count": len(grades),
        "published_grade_count": published_count,
        "pending_grade_count": max(0, len(submitted_ids - graded_ids)) if deadline_passed else 0,
        "evaluation_overdue": overdue_ungraded_count > 0,
        "overdue_ungraded_submission_count": overdue_ungraded_count,
        "workflow_status": workflow,
        "edit_allowed": submission_count == 0,
        "teacher_delete_allowed": submission_count == 0,
    }


async def _notify_assignment_published(db: AsyncSession, assignment):
    for student in await _eligible_students(db, assignment):
        await _notification(
            db,
            student.id,
            "New assignment",
            f"{assignment.title} is now available.",
            action_url=f"/assignments/{assignment.id}",
            dedupe_key=f"assignment-published:{assignment.id}:{student.id}",
        )


async def _notify_assignment_updated(db: AsyncSession, assignment):
    for student in await _eligible_students(db, assignment):
        await _notification(
            db,
            student.id,
            "Assignment updated",
            f"{assignment.title} has been updated. Review the latest requirements, schedule, and resources.",
            action_url=f"/assignments/{assignment.id}",
        )


async def _teacher_dashboard_summary(db: AsyncSession, teacher, items):
    student_ids = set()
    course_ids = set()
    for allocation in teacher.get("assignments") or []:
        if not isinstance(allocation, dict):
            continue
        course_id = allocation.get("program_id") or allocation.get("course_id")
        if course_id:
            course_ids.add(course_id)
        query = select(SqlUser.id).filter(SqlUser.role == "student")
        if course_id:
            query = query.filter(SqlUser.course_id == course_id)
        if allocation.get("batch_id"):
            query = query.filter(SqlUser.batch_id == allocation["batch_id"])
        if allocation.get("section_id"):
            query = query.filter(SqlUser.section_id == allocation["section_id"])
        student_ids.update(row for row in (await db.scalars(query)).all())
    if not student_ids:
        for item in items:
            course_id = item.get("target_course_id")
            if course_id:
                course_ids.add(course_id)
            assignment = (await db.scalars(select(SqlAssignment).filter_by(id=item["id"]))).first()
            if assignment:
                student_ids.update(student.id for student in await _eligible_students(db, assignment))
    return {
        "assignment_count": len(items),
        "active_assignment_count": sum(item["workflow_status"] in {"scheduled", "open", "awaiting_grading", "results_partial"} for item in items),
        "course_count": len(course_ids),
        "student_count": len(student_ids),
        "submission_count": sum(item["submission_count"] for item in items),
        "pending_submission_count": sum(item["pending_submission_count"] for item in items),
        "pending_grade_count": sum(item["pending_grade_count"] for item in items),
    }


async def _student_assignment(db: AsyncSession, assignment_id, user):
    row = (await db.scalars(select(SqlAssignment).filter(SqlAssignment.id == assignment_id, SqlAssignment.status == "published"))).first()
    if not row or not await _student_has_assignment_access(db, row, user):
        raise HTTPException(404, "Assignment not found")
    return row


async def _assert_student_submission_allowed(db: AsyncSession, assignment, student_id, *, lock_submission=False):
    if assignment.evaluation_locked_at:
        raise HTTPException(409, "Evaluation has started and repository changes are closed")
    if assignment.submission_locked_at:
        raise HTTPException(409, assignment.submission_lock_reason or "Submissions are locked by the administrator")
    if _phase(assignment) != "open":
        raise HTTPException(409, "The assignment deadline has passed or submissions are not open")
    grade = (await db.scalars(select(SqlAssignmentGrade).filter_by(assignment_id=assignment.id, student_id=student_id, status="published"))).first()
    if grade:
        raise HTTPException(409, "Your result is published, so this assignment is locked")
    submission_query = select(SqlAssignmentSubmission).filter_by(assignment_id=assignment.id, student_id=student_id)
    if lock_submission:
        submission_query = submission_query.with_for_update()
    submission = (await db.scalars(submission_query)).first()
    if submission and (submission.repository_url or (submission.active_version_id and submission.status != "reset")):
        raise HTTPException(409, "A repository is already linked. Its URL cannot be changed")
    return submission, 0


async def _sync_rubric_and_links(db: AsyncSession, assignment, body):
    await db.execute(delete(SqlAssignmentRubric).where(SqlAssignmentRubric.assignment_id == assignment.id))
    for position, item in enumerate(body.rubric):
        db.add(
            SqlAssignmentRubric(
                id=item.id or str(uuid.uuid4()),
                assignment_id=assignment.id,
                title=item.title,
                description=item.description,
                max_marks=item.max_marks,
                position=position,
            )
        )
    await db.execute(delete(SqlAssignmentResource).where(SqlAssignmentResource.assignment_id == assignment.id, SqlAssignmentResource.kind == "link"))
    for position, item in enumerate(body.links):
        db.add(SqlAssignmentResource(id=str(uuid.uuid4()), assignment_id=assignment.id, kind="link", label=item.label, url=str(item.url), position=position))


AI_DRAFT_TOKEN_TYPE = "assignment_ai_draft"


def _decode_ai_draft(token, secret_key, teacher_id):
    """Verify the signed token issued with an AI assignment prompt; it binds the context and settings."""
    try:
        payload = jwt.decode(token, secret_key, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(409, "This AI prompt expired. Generate a new prompt") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(400, "Invalid AI prompt reference") from exc
    if payload.get("type") != AI_DRAFT_TOKEN_TYPE or payload.get("teacher_id") != teacher_id:
        raise HTTPException(400, "Invalid AI prompt reference")
    return payload


def _decode_external_batch(token, secret_key):
    try:
        payload = jwt.decode(token, secret_key, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(409, "This evaluation batch expired. Generate a new class export") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(400, "Invalid evaluation batch") from exc
    if payload.get("type") != "assignment_external_evaluation":
        raise HTTPException(400, "Invalid evaluation batch type")
    return payload


async def _external_duplicate_flags(db: AsyncSession, assignment_id, version_id):
    return (
        await db.scalars(
            select(SqlAssignmentDuplicateFlag).filter(
                SqlAssignmentDuplicateFlag.assignment_id == assignment_id,
                (SqlAssignmentDuplicateFlag.left_version_id == version_id) | (SqlAssignmentDuplicateFlag.right_version_id == version_id),
            )
        )
    ).all()


async def _similarity_mark_limit(db: AsyncSession, assignment, version_id):
    if not version_id:
        return float(assignment.total_marks), False, False
    flags = [
        flag
        for flag in await _external_duplicate_flags(db, assignment.id, version_id)
        if flag.flag_type == "code_similarity" and float(flag.similarity) > 0.70
    ]
    system_limited = bool(flags)
    limit = float(assignment.total_marks) / 2 if system_limited else float(assignment.total_marks)
    return limit, system_limited, False


def _normalize_rubric_feedback(raw_feedback, criterion_ids, *, student_label="student"):
    """Validate and sanitize criterion-specific final evaluation feedback."""
    if not isinstance(raw_feedback, dict) or set(raw_feedback) != set(criterion_ids):
        raise HTTPException(400, f"Every rubric criterion needs feedback for {student_label}")
    normalized = {}
    for criterion_id in criterion_ids:
        entry = raw_feedback.get(criterion_id)
        if not isinstance(entry, dict):
            raise HTTPException(400, f"Rubric feedback is invalid for {student_label}")
        done_well = sanitize_external_feedback(entry.get("what_was_done_well"))
        missing = sanitize_external_feedback(entry.get("what_is_missing"))
        if not done_well or not missing:
            raise HTTPException(400, f"Each rubric criterion needs both what was done well and what is missing for {student_label}")
        if len(done_well) > 10_000 or len(missing) > 10_000:
            raise HTTPException(400, f"Rubric feedback is too long for {student_label}")
        normalized[criterion_id] = {"what_was_done_well": done_well, "what_is_missing": missing}
    return normalized


def _automatic_zero_rubric_feedback(rubric, reason):
    return {
        item.id: {
            "what_was_done_well": "No assessable repository evidence was available for this criterion.",
            "what_is_missing": f"{reason} Criterion assessed: {item.title}." + (f" {item.description}" if item.description else ""),
        }
        for item in rubric
    }
