"""The session-rollover engine: preview, execute and undo.

Promotes every active student from one academic session to the next,
creates the next intake's batches/sections on an Odd rollover, auto-enrols
compulsory subjects, and graduates students whose study year has run past
their course's duration. See the original academic-sessions plan Part 4.

Every row this module creates is stamped with a rollover_run_id so it can
be audited, and undone within the allowed window (before any new
assignment/submission exists in the target session).
"""
from __future__ import annotations

import datetime
import uuid
from dataclasses import dataclass, field

from fastapi import HTTPException
from models.assignment import SqlAssignment, SqlAssignmentSubmission
from models.notification import SqlNotification
from models.sql_models import (
    SqlAcademicSession,
    SqlBatch,
    SqlCourse,
    SqlRolloverRun,
    SqlSection,
    SqlStudentSessionRecord,
    SqlStudentSubjectEnrollment,
    SqlSubject,
    SqlTeacherSessionAllocation,
    SqlUser,
)
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from services.academic_calendar import derive_study_year_semester, is_graduating, next_session_label, sync_user_cached_fields

# NOTE ON SYNC/ASYNC: `preview`/`execute`/`undo` below are async and are the
# ONLY callers of this module's own helpers (`_get_or_build_target_session`,
# `_active_students_in_session`, `_plan`) — confirmed by grep before doing
# this, unlike `services/academic_calendar.py`'s `resolve_current_session`/
# `mirror_teacher_allocations`, which are also called from still-sync
# `admin_routes.py`/`assignment_routes.py` and needed a sync+async twin pair
# instead. `notify_admins_if_rollover_due` at the bottom of this file is
# different again: it's called via `asyncio.to_thread` from `app.py`'s
# lifespan scheduler, so it stays sync (`db: Session`) — converting it would
# require touching that scheduler bridge for no benefit, since to_thread
# already keeps it off the event loop.


@dataclass
class RolloverPreview:
    from_session: dict | None
    to_session: dict
    to_session_exists: bool
    promote_count: int = 0
    graduate_count: int = 0
    new_batches: list[dict] = field(default_factory=list)
    new_sections_count: int = 0
    enrollment_count: int = 0
    teacher_allocation_count: int = 0
    warnings: list[str] = field(default_factory=list)


def _to_session_fields(from_session: SqlAcademicSession | None):
    if from_session is None:
        raise HTTPException(400, "No current academic session is set — create and mark one current before rolling over")
    label, term, start_date, end_date = next_session_label(from_session)
    return label, term, start_date, end_date


async def _get_or_build_target_session(db: AsyncSession, from_session: SqlAcademicSession) -> tuple[SqlAcademicSession, bool]:
    label, term, start_date, end_date = _to_session_fields(from_session)
    existing = (
        await db.scalars(select(SqlAcademicSession).where(SqlAcademicSession.label == label, SqlAcademicSession.term == term))
    ).first()
    if existing:
        return existing, True
    return SqlAcademicSession(id=str(uuid.uuid4()), label=label, term=term, start_date=start_date, end_date=end_date, is_current=False, status="upcoming"), False


async def _active_students_in_session(db: AsyncSession, session_id: str):
    return (
        await db.scalars(
            select(SqlStudentSessionRecord).where(
                SqlStudentSessionRecord.session_id == session_id, SqlStudentSessionRecord.status == "active"
            )
        )
    ).all()


async def _plan(db: AsyncSession, from_session: SqlAcademicSession, to_session: SqlAcademicSession, to_session_is_new: bool):
    """Shared logic between preview and execute: works out what would/should
    happen, without writing anything. Returns a dict of computed pieces."""
    warnings: list[str] = []
    outgoing_records = await _active_students_in_session(db, from_session.id)
    courses_by_id = {row.id: row for row in (await db.scalars(select(SqlCourse))).all()}
    batches_by_id = {row.id: row for row in (await db.scalars(select(SqlBatch))).all()}

    promotions: list[dict] = []
    for record in outgoing_records:
        student = (await db.scalars(select(SqlUser).where(SqlUser.id == record.student_id))).first()
        if not student:
            continue
        if record.is_override and record.status in {"repeating", "on_leave"}:
            promotions.append({"record": record, "student": student, "study_year": record.study_year, "semester": record.semester, "status": record.status, "keep_same_level": True})
            continue
        batch = batches_by_id.get(record.batch_id) if record.batch_id else None
        if not batch:
            warnings.append(f"{student.name or student.id} has no batch set and will be skipped")
            continue
        course = courses_by_id.get(batch.course_id)
        study_year, semester = derive_study_year_semester(batch, to_session)
        graduated = is_graduating(study_year, course.duration_years if course else 4)
        promotions.append({"record": record, "student": student, "study_year": study_year, "semester": semester, "status": "graduated" if graduated else "active", "keep_same_level": False})

    new_batches: list[dict] = []
    if to_session.term == "odd":
        active_courses = (await db.scalars(select(SqlCourse))).all()
        intake_year = int(to_session.label.split("-")[0])
        for course in active_courses:
            end_year = intake_year + course.duration_years
            exists = (
                await db.scalars(
                    select(SqlBatch).where(SqlBatch.course_id == course.id, SqlBatch.start_year == intake_year, SqlBatch.end_year == end_year)
                )
            ).first()
            if not exists:
                new_batches.append({"course_id": course.id, "course_name": course.name, "start_year": intake_year, "end_year": end_year})

    promote_count = sum(1 for p in promotions if p["status"] != "graduated")
    graduate_count = sum(1 for p in promotions if p["status"] == "graduated")

    enrollment_count = 0
    for p in promotions:
        if p["status"] != "active" or p["keep_same_level"]:
            continue
        record = p["record"]
        subject_query = select(func.count()).select_from(SqlSubject).where(SqlSubject.enrollment_type == "compulsory", SqlSubject.year == p["study_year"])
        batch = batches_by_id.get(record.batch_id)
        if batch:
            subject_query = subject_query.where((SqlSubject.course_id == batch.course_id) | (SqlSubject.course_id.is_(None)))
        enrollment_count += await db.scalar(subject_query)

    if not outgoing_records:
        warnings.append(f"No active students found in {from_session.label} ({from_session.term}) — nothing to promote")

    teacher_allocation_count = await db.scalar(
        select(func.count()).select_from(SqlTeacherSessionAllocation).where(SqlTeacherSessionAllocation.session_id == from_session.id)
    )

    return {
        "promotions": promotions,
        "new_batches": new_batches,
        "promote_count": promote_count,
        "graduate_count": graduate_count,
        "enrollment_count": enrollment_count,
        "teacher_allocation_count": teacher_allocation_count,
        "warnings": warnings,
    }


async def preview(db: AsyncSession, from_session: SqlAcademicSession) -> RolloverPreview:
    to_session, exists = await _get_or_build_target_session(db, from_session)
    plan = await _plan(db, from_session, to_session, exists)
    return RolloverPreview(
        from_session={"id": from_session.id, "label": from_session.label, "term": from_session.term},
        to_session={"id": to_session.id if exists else None, "label": to_session.label, "term": to_session.term, "start_date": to_session.start_date.isoformat(), "end_date": to_session.end_date.isoformat()},
        to_session_exists=exists,
        promote_count=plan["promote_count"],
        graduate_count=plan["graduate_count"],
        new_batches=plan["new_batches"],
        new_sections_count=len(plan["new_batches"]),  # one default section per new batch
        enrollment_count=plan["enrollment_count"],
        teacher_allocation_count=plan["teacher_allocation_count"],
        warnings=plan["warnings"],
    )


async def execute(db: AsyncSession, from_session: SqlAcademicSession, executed_by: str | None) -> dict:
    to_session, exists = await _get_or_build_target_session(db, from_session)
    plan = await _plan(db, from_session, to_session, exists)

    if not exists:
        db.add(to_session)
        await db.flush()

    run = SqlRolloverRun(id=str(uuid.uuid4()), from_session_id=from_session.id, to_session_id=to_session.id, executed_by=executed_by, counts={})
    db.add(run)
    await db.flush()

    # 1. New batches (Odd rollovers only) + one default section each.
    created_batches = 0
    created_sections = 0
    for spec in plan["new_batches"]:
        batch = SqlBatch(id=str(uuid.uuid4()), course_id=spec["course_id"], start_year=spec["start_year"], end_year=spec["end_year"], status="active", auto_created=True, intake_open=True)
        db.add(batch)
        await db.flush()
        section = SqlSection(id=str(uuid.uuid4()), course_id=spec["course_id"], batch_id=batch.id, name="A")
        db.add(section)
        created_batches += 1
        created_sections += 1

    # 2. Promote / graduate every active student.
    promoted = 0
    graduated = 0
    for p in plan["promotions"]:
        record, student = p["record"], p["student"]
        new_record = SqlStudentSessionRecord(
            id=str(uuid.uuid4()),
            student_id=student.id,
            session_id=to_session.id,
            batch_id=record.batch_id,
            section_id=record.section_id,
            study_year=p["study_year"],
            semester=p["semester"],
            status=p["status"],
            is_override=p["keep_same_level"],
            rollover_run_id=run.id,
        )
        db.add(new_record)
        await db.flush()
        if p["status"] == "graduated":
            graduated += 1
        else:
            promoted += 1
            # 3. Auto-enrol compulsory subjects for the new level.
            batch = (await db.scalars(select(SqlBatch).where(SqlBatch.id == record.batch_id))).first() if record.batch_id else None
            subject_query = select(SqlSubject).where(SqlSubject.enrollment_type == "compulsory", SqlSubject.year == p["study_year"])
            if batch:
                subject_query = subject_query.where((SqlSubject.course_id == batch.course_id) | (SqlSubject.course_id.is_(None)))
            subjects = (await db.scalars(subject_query)).all()
            for subject in subjects:
                already = (
                    await db.scalars(
                        select(SqlStudentSubjectEnrollment).where(
                            SqlStudentSubjectEnrollment.student_id == student.id,
                            SqlStudentSubjectEnrollment.subject_id == subject.id,
                            SqlStudentSubjectEnrollment.session_id == to_session.id,
                        )
                    )
                ).first()
                if not already:
                    db.add(SqlStudentSubjectEnrollment(id=str(uuid.uuid4()), student_id=student.id, subject_id=subject.id, session_id=to_session.id))

    # 4. Carry teacher allocations forward. users.assignments (the JSON blob
    # every existing screen reads) is re-synced too, so teachers keep the
    # same allocations in the new session without an admin re-entering them.
    carried_allocations = 0
    outgoing_allocations = (
        await db.scalars(select(SqlTeacherSessionAllocation).where(SqlTeacherSessionAllocation.session_id == from_session.id))
    ).all()
    allocations_by_teacher: dict[str, list[dict]] = {}
    for allocation in outgoing_allocations:
        db.add(SqlTeacherSessionAllocation(
            id=str(uuid.uuid4()), teacher_id=allocation.teacher_id, session_id=to_session.id,
            program_id=allocation.program_id,
            batch_id=allocation.batch_id, section_id=allocation.section_id,
            subject_ids=allocation.subject_ids, rollover_run_id=run.id,
        ))
        allocations_by_teacher.setdefault(allocation.teacher_id, []).append({
            "program_id": allocation.program_id,
            "batch_id": allocation.batch_id, "section_id": allocation.section_id,
            "subject_ids": allocation.subject_ids,
        })
        carried_allocations += 1
    for teacher_id, allocations in allocations_by_teacher.items():
        teacher = (await db.scalars(select(SqlUser).where(SqlUser.id == teacher_id))).first()
        if teacher:
            teacher.assignments = allocations

    # 5. Flip is_current.
    await db.execute(update(SqlAcademicSession).where(SqlAcademicSession.id != to_session.id).values(is_current=False))
    to_session.is_current = True
    to_session.status = "active"
    from_session.status = "closed"

    # 6. Sync cached fields for anything still shown from users.year/semester.
    for p in plan["promotions"]:
        if p["status"] != "graduated":
            new_record = (
                await db.scalars(
                    select(SqlStudentSessionRecord).where(
                        SqlStudentSessionRecord.student_id == p["student"].id, SqlStudentSessionRecord.session_id == to_session.id
                    )
                )
            ).first()
            if new_record:
                sync_user_cached_fields(db, p["student"], new_record)

    counts = {
        "promoted": promoted,
        "graduated": graduated,
        "new_batches": created_batches,
        "new_sections": created_sections,
        "teacher_allocations_carried": carried_allocations,
        "warnings": plan["warnings"],
    }
    run.counts = counts
    await db.flush()
    return {"run_id": run.id, "to_session_id": to_session.id, **counts}


def notify_admins_if_rollover_due(db: Session) -> int:
    """Called from the background scheduler (see app.py). If the current
    session's end_date has passed and nothing has rolled over yet, nudge
    every admin once — this is the "prepare automatically, confirm
    manually" behaviour from the original academic-sessions plan Part 4
    Step 4: never flip the current session on its own, just make sure an
    admin can't miss that it's time to.

    Returns the number of notifications created (0 most days — cheap to
    call often)."""
    from services.academic_calendar import next_session_label, resolve_current_session

    current = resolve_current_session(db)
    if not current:
        return 0
    today = datetime.date.today()
    if current.end_date >= today:
        return 0

    label, term, _start, _end = next_session_label(current)
    dedupe_key = f"rollover-due:{current.id}:{label}:{term}"
    # Sprint 5, the original implementation plan: rollover is a `ROLLOVER_EXECUTE`
    # action, super-admin only (see core/policy.py) — only super admins get
    # notified that a rollover is due.
    admins = db.query(SqlUser).filter(SqlUser.role == "super_admin", SqlUser.is_active.is_(True)).all()
    created = 0
    for admin in admins:
        already = db.query(SqlNotification.id).filter(SqlNotification.user_id == admin.id, SqlNotification.dedupe_key == dedupe_key).first()
        if already:
            continue
        db.add(SqlNotification(
            id=str(uuid.uuid4()),
            user_id=admin.id,
            type="session_rollover",
            title="Session rollover is due",
            message=f"{current.label} ({current.term}) ended on {current.end_date.isoformat()}. Review and confirm the rollover to {label} ({term}).",
            metadata_json={"from_session_id": current.id, "to_session_label": label, "to_session_term": term},
            action_url="/admin/session-rollover",
            dedupe_key=dedupe_key,
        ))
        created += 1
    if created:
        db.commit()
    return created


async def undo(db: AsyncSession, run_id: str) -> dict:
    run = (await db.scalars(select(SqlRolloverRun).where(SqlRolloverRun.id == run_id))).first()
    if not run:
        raise HTTPException(404, "Rollover run not found")
    if run.undone_at:
        raise HTTPException(400, "This rollover has already been undone")

    has_assignment_activity = (
        await db.scalars(select(SqlAssignment).where(SqlAssignment.session_id == run.to_session_id))
    ).first()
    has_submission_activity = (
        await db.scalars(select(SqlAssignmentSubmission).join(SqlAssignment).where(SqlAssignment.session_id == run.to_session_id))
    ).first()
    if has_assignment_activity or has_submission_activity:
        raise HTTPException(409, "Cannot undo — new assignments or submissions already exist in the session this rollover created")

    # Batches/sections created by this run are left in place even on undo —
    # deleting them is only safe if nothing else references them yet, and
    # that's not worth the risk for what is otherwise a harmless empty
    # "upcoming" batch. Admins can delete an empty auto-created batch by hand
    # from the Batches page if it really shouldn't exist.
    await db.execute(delete(SqlStudentSessionRecord).where(SqlStudentSessionRecord.rollover_run_id == run_id))
    await db.execute(delete(SqlStudentSubjectEnrollment).where(SqlStudentSubjectEnrollment.session_id == run.to_session_id))
    await db.execute(delete(SqlTeacherSessionAllocation).where(SqlTeacherSessionAllocation.rollover_run_id == run_id))

    to_session = (await db.scalars(select(SqlAcademicSession).where(SqlAcademicSession.id == run.to_session_id))).first()
    from_session = (
        (await db.scalars(select(SqlAcademicSession).where(SqlAcademicSession.id == run.from_session_id))).first()
        if run.from_session_id else None
    )
    if to_session:
        to_session.is_current = False
        to_session.status = "upcoming"
    if from_session:
        from_session.is_current = True
        from_session.status = "active"

    run.undone_at = datetime.datetime.utcnow()
    await db.flush()
    return {"message": "Rollover undone", "run_id": run_id}
