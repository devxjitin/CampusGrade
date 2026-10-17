import csv
import io
import json
import uuid

from core.db import db_session
from core.policy import Permission, require_roles, require_user
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from models.assignment import SqlAssignment, SqlAssignmentGrade, SqlAssignmentGradeRevision, SqlAssignmentSubmission
from models.sql_models import SqlUser
from schemas.assignment import GradeInput, WithdrawGradeInput
from services.notification_email import enqueue_notification_email
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .common import (
    _advance_saved_grade_revision,
    _assignment_students,
    _closed,
    _evaluation_participants,
    _notification,
    _now,
    _rubric,
    _serialize_grade,
    _snapshot_grade,
)
from .payloads import _teacher_assignment
from .submissions import _assignment_roster_payload
from .workflow import (
    _assert_evaluation_allowed,
    _automatic_zero_rubric_feedback,
    _evaluation_workflow,
    _lock_evaluation_cohort,
    _normalize_rubric_feedback,
    _similarity_mark_limit,
)

router = APIRouter()


@router.put("/teacher/{assignment_id}/grades/{student_id}")
async def save_grade(
    assignment_id: str,
    student_id: str,
    body: GradeInput,
    teacher=Depends(require_user(Permission.ASSIGNMENT_GRADE)),
    db: AsyncSession = Depends(db_session),
):
    assignment = await _teacher_assignment(db, assignment_id, teacher, lock=True)
    rubric = await _rubric(db, assignment.id)
    await _assert_evaluation_allowed(db, assignment, student_id)
    student = (await db.scalars(select(SqlUser).filter_by(id=student_id, role="student"))).first()
    if not student:
        raise HTTPException(404, "Student not found")
    submission = (await db.scalars(select(SqlAssignmentSubmission).filter_by(assignment_id=assignment.id, student_id=student_id))).first()
    if not submission and not body.missing:
        raise HTTPException(409, "Student has no submission")
    valid_ids = {x.id: x.max_marks for x in rubric}
    if any(key not in valid_ids or score < 0 or score > valid_ids[key] for key, score in body.rubric_scores.items()):
        raise HTTPException(400, "Rubric score is outside the allowed range")
    if not body.missing and set(body.rubric_scores) != set(valid_ids):
        raise HTTPException(400, "Every rubric criterion needs a score")
    rubric_feedback = (
        _automatic_zero_rubric_feedback(rubric, "No repository was submitted before the deadline.")
        if body.missing
        else _normalize_rubric_feedback(body.rubric_feedback, valid_ids, student_label=student.name)
    )
    total = 0 if body.missing else sum(body.rubric_scores.values())
    mark_limit, similarity_limited, _ = await _similarity_mark_limit(db, assignment, submission.frozen_version_id if submission else None)
    if not body.missing and total > mark_limit + 0.001:
        raise HTTPException(400, f"Marks cannot exceed {mark_limit:g} after system-detected code similarity above 70%")
    grade = (await db.scalars(select(SqlAssignmentGrade).filter_by(assignment_id=assignment.id, student_id=student_id).with_for_update())).first()
    if grade and body.expected_revision and grade.revision != body.expected_revision:
        raise HTTPException(409, "Grade changed in another session. Reload before saving")
    is_new = grade is None
    if is_new:
        grade = SqlAssignmentGrade(
            id=str(uuid.uuid4()),
            assignment_id=assignment.id,
            student_id=student_id,
            submission_version_id=submission.frozen_version_id if submission else None,
            rubric_scores={},
            feedback="",
            total_awarded=0,
            is_missing=body.missing,
            status="draft",
            revision=1,
        )
        db.add(grade)
    elif grade.status == "published":
        raise HTTPException(409, "Withdraw the published grade before editing")
    frozen_version_id = submission.frozen_version_id if submission else None
    grade.submission_version_id = frozen_version_id
    grade.rubric_scores = {item.id: 0 for item in rubric} if body.missing else body.rubric_scores
    grade.feedback = ""
    grade.total_awarded = total
    grade.evaluation_source = "manual"
    grade.evaluation_metadata = {"similarity_mark_limit": mark_limit if similarity_limited else None, "rubric_feedback": rubric_feedback}
    grade.is_missing = body.missing
    grade.status = "draft"
    grade.evaluated_by = teacher["_id"]
    grade.evaluated_at = _now()
    _advance_saved_grade_revision(grade, is_new=is_new)
    await db.flush()
    db.add(SqlAssignmentGradeRevision(id=str(uuid.uuid4()), grade_id=grade.id, action="saved", snapshot=_snapshot_grade(grade), actor_id=teacher["_id"]))
    await db.commit()
    return {"message": "Grade saved", "grade": _serialize_grade(grade)}


async def _publish_grade(db: AsyncSession, assignment, grade, actor_id):
    if not grade.is_missing:
        await _assert_evaluation_allowed(db, assignment)
    if not _closed(assignment):
        raise HTTPException(409, "Grades can be published only after the submission window closes")
    if grade.status != "draft":
        raise HTTPException(409, "Only saved evaluations can be published")
    rubric_rows = await _rubric(db, assignment.id)
    rubric_ids = {item.id for item in rubric_rows}
    _normalize_rubric_feedback((grade.evaluation_metadata or {}).get("rubric_feedback"), rubric_ids, student_label="this student")
    mark_limit, _similarity_limited, _ = await _similarity_mark_limit(db, assignment, grade.submission_version_id)
    if not grade.is_missing and grade.total_awarded > mark_limit + 0.001:
        raise HTTPException(409, f"Grade exceeds the automatic similarity limit of {mark_limit:g}")
    grade.status, grade.published_at, grade.withdrawn_at, grade.withdrawal_reason = "published", _now(), None, None
    grade.revision += 1
    db.add(SqlAssignmentGradeRevision(id=str(uuid.uuid4()), grade_id=grade.id, action="published", snapshot=_snapshot_grade(grade), actor_id=actor_id))
    await _notification(db, grade.student_id, "Assignment grade published", f"Your grade for {assignment.title} is now available.")
    await enqueue_notification_email(
        db, grade.student_id, "email_assignment_grades", "Your grade is available",
        [f"Your grade for {assignment.title} has been published."], f"/assignments/{assignment.id}",
    )


async def _refresh_assignment_completion(db: AsyncSession, assignment, actor_id=None):
    await db.flush()
    eligible_ids = [student.id for student in await _assignment_students(db, assignment)]
    published_rows = (await db.scalars(select(SqlAssignmentGrade).filter_by(assignment_id=assignment.id, status="published"))).all()
    published_ids = {row.student_id for row in published_rows}
    if eligible_ids and set(eligible_ids).issubset(published_ids):
        assignment.results_published_at = assignment.results_published_at or _now()
        assignment.results_published_by = actor_id if actor_id and actor_id != "system" else None
    else:
        assignment.results_published_at, assignment.results_published_by = None, None


async def finalize_assignment_deadlines(db: AsyncSession, now=None):
    """Create frozen deadline cohorts and private missing-zero evaluations exactly once.

    Runs on the worker (see `publish_ready_assignment_results`)."""
    now = now or _now()
    finalized = []
    rows = (
        await db.scalars(
            select(SqlAssignment)
            .filter(
                SqlAssignment.status == "published",
                SqlAssignment.due_at.is_not(None),
                SqlAssignment.due_at <= now,
                SqlAssignment.evaluation_locked_at.is_(None),
            )
            .order_by(SqlAssignment.id)
            .with_for_update(skip_locked=True)
        )
    ).all()
    for assignment in rows:
        await _lock_evaluation_cohort(db, assignment, actor_id=None, trigger="deadline", now=now)
        participants = await _evaluation_participants(db, assignment)
        missing = sum(1 for row in participants if row.status == "missing")
        await _notification(
            db,
            assignment.created_by,
            "Assignment deadline reached",
            f"{assignment.title} is ready for class repository fetching. {missing} student(s) received private missing-submission zero evaluations.",
            "assignment_deadline",
            f"/assignments/{assignment.id}/review",
            f"assignment-deadline:{assignment.id}",
        )
        finalized.append(assignment)
    return finalized


async def publish_ready_assignment_results(db: AsyncSession, now=None):
    """Finalize deadlines and release scheduled results. Called by the worker's periodic task
    and by the concurrency tests; row locks (`skip_locked`) make concurrent runs release once."""
    now = now or _now()
    released = []
    finalized = await finalize_assignment_deadlines(db, now)
    rows = (
        await db.scalars(
            select(SqlAssignment)
            .filter(
                SqlAssignment.status == "published",
                SqlAssignment.result_release_mode == "scheduled",
                SqlAssignment.results_published_at.is_(None),
                SqlAssignment.due_at.is_not(None),
                SqlAssignment.due_at <= now,
                SqlAssignment.result_release_at.is_not(None),
                SqlAssignment.result_release_at <= now,
            )
            .order_by(SqlAssignment.id)
            .with_for_update(skip_locked=True)
        )
    ).all()
    for assignment in rows:
        if (
            assignment.status != "published"
            or assignment.result_release_mode != "scheduled"
            or assignment.results_published_at is not None
            or not assignment.due_at
            or now < assignment.due_at
            or not assignment.result_release_at
            or now < assignment.result_release_at
        ):
            continue
        workflow = await _evaluation_workflow(db, assignment)
        if workflow["submitted_count"] and not workflow["can_evaluate"]:
            continue
        eligible_ids = [student.id for student in await _assignment_students(db, assignment)]
        grades = (await db.scalars(select(SqlAssignmentGrade).filter_by(assignment_id=assignment.id).with_for_update())).all()
        if not eligible_ids or not set(eligible_ids).issubset({grade.student_id for grade in grades}):
            continue
        for grade in grades:
            if grade.status == "draft":
                await _publish_grade(db, assignment, grade, None)
        await _refresh_assignment_completion(db, assignment)
        if assignment.results_published_at:
            released.append(assignment)
    if released or finalized:
        await db.commit()
    return released


@router.post("/teacher/{assignment_id}/grades/{student_id}/publish")
async def publish_grade(
    assignment_id: str,
    student_id: str,
    teacher=Depends(require_user(Permission.GRADE_PUBLISH)),
    db: AsyncSession = Depends(db_session),
):
    assignment = await _teacher_assignment(db, assignment_id, teacher, lock=True)
    grade = (await db.scalars(select(SqlAssignmentGrade).filter_by(assignment_id=assignment.id, student_id=student_id).with_for_update())).first()
    if not grade:
        raise HTTPException(404, "Draft grade not found")
    await _publish_grade(db, assignment, grade, teacher["_id"])
    await _refresh_assignment_completion(db, assignment, teacher["_id"])
    await db.commit()
    return {"message": "Grade published", "grade": _serialize_grade(grade)}


@router.post("/teacher/{assignment_id}/grades/publish-all")
async def publish_all_grades(assignment_id: str, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    assignment = await _teacher_assignment(db, assignment_id, teacher, lock=True)
    workflow = await _evaluation_workflow(db, assignment)
    if workflow["submitted_count"]:
        await _assert_evaluation_allowed(db, assignment)
    if not _closed(assignment):
        raise HTTPException(409, "Grades can be published only after the submission deadline")
    eligible_ids = [student.id for student in await _assignment_students(db, assignment)]
    all_grades = (await db.scalars(select(SqlAssignmentGrade).filter_by(assignment_id=assignment.id).with_for_update())).all()
    if not eligible_ids:
        raise HTTPException(409, "This assignment has no eligible students")
    missing = set(eligible_ids) - {grade.student_id for grade in all_grades}
    if missing:
        raise HTTPException(409, f"Grade or mark missing must be recorded for {len(missing)} student(s)")
    grades = [grade for grade in all_grades if grade.status == "draft"]
    for grade in grades:
        await _publish_grade(db, assignment, grade, teacher["_id"])
    await _refresh_assignment_completion(db, assignment, teacher["_id"])
    await db.commit()
    return {"message": f"Published {len(grades)} grades", "count": len(grades)}


@router.post("/teacher/{assignment_id}/grades/{student_id}/withdraw")
async def withdraw_grade(
    assignment_id: str, student_id: str, body: WithdrawGradeInput, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)
):
    assignment = await _teacher_assignment(db, assignment_id, teacher, lock=True)
    grade = (
        await db.scalars(select(SqlAssignmentGrade).filter_by(assignment_id=assignment.id, student_id=student_id, status="published").with_for_update())
    ).first()
    if not grade:
        raise HTTPException(404, "Published grade not found")
    grade.status, grade.withdrawn_at, grade.withdrawal_reason, grade.published_at = "draft", _now(), body.reason, None
    grade.revision += 1
    assignment.result_release_mode, assignment.result_release_at = "manual", None
    await _refresh_assignment_completion(db, assignment)
    db.add(
        SqlAssignmentGradeRevision(
            id=str(uuid.uuid4()), grade_id=grade.id, action="withdrawn", snapshot=_snapshot_grade(grade), actor_id=teacher["_id"], reason=body.reason
        )
    )
    await _notification(db, student_id, "Assignment grade withdrawn", f"Your grade for {assignment.title} is being corrected.")
    await db.commit()
    return {"message": "Grade withdrawn", "grade": _serialize_grade(grade)}


@router.get("/teacher/{assignment_id}/gradebook.csv")
async def gradebook_csv(assignment_id: str, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    assignment = await _teacher_assignment(db, assignment_id, teacher)
    roster = (await _assignment_roster_payload(db, assignment))["roster"]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Student", "Email", "Roll No", "Repository", "Commit", "Submitted At", "Late", "Status", "Marks", "Published", "Rubric Feedback"])
    for row in roster:
        version, grade = row["version"] or {}, row["grade"] or {}
        writer.writerow(
            [
                row["student"]["name"],
                row["student"]["email"],
                row["student"]["roll_no"],
                version.get("repository_url"),
                version.get("commit_sha"),
                version.get("submitted_at"),
                version.get("is_late", False),
                (row["submission"] or {}).get("status", "missing"),
                grade.get("total_awarded"),
                grade.get("status"),
                json.dumps(grade.get("rubric_feedback") or {}, ensure_ascii=False),
            ]
        )
    return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{assignment.title}-gradebook.csv"'})
