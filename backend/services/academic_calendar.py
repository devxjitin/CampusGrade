"""Derivation helpers for academic sessions, batches, and student year/semester.

The core idea (see the original academic-sessions plan Part 1): a batch is
fixed forever once it is created ("B.Tech CSE 2025-2029"), and a session is
one Odd/Even term. A student's study year and semester are *derived* from
those two facts rather than typed by hand, so "the semester changed" and
"the year changed" become the same one-line calculation.
"""
from __future__ import annotations

import datetime
import uuid

from models.sql_models import SqlAcademicSession, SqlBatch, SqlStudentSessionRecord, SqlTeacherSessionAllocation, SqlUser
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession


def session_start_year(session: SqlAcademicSession) -> int:
    """"2026-2027" -> 2026. Sessions are always labelled start-end."""
    return int(str(session.label).split("-")[0])


def derive_study_year_semester(batch: SqlBatch, session: SqlAcademicSession) -> tuple[int, int]:
    """Given a batch and a session, work out which study year and semester
    a normally-progressing student in that batch is in during that session.

    Odd term -> odd semester (1, 3, 5, 7), Even term -> even semester.
    """
    years_elapsed = session_start_year(session) - batch.start_year
    study_year = years_elapsed + 1
    semester = (2 * study_year - 1) if session.term == "odd" else (2 * study_year)
    return study_year, semester


def is_graduating(study_year: int, course_duration_years: int) -> bool:
    return study_year > course_duration_years


def resolve_current_session(db) -> SqlAcademicSession | None:
    return db.query(SqlAcademicSession).filter(SqlAcademicSession.is_current.is_(True)).order_by(SqlAcademicSession.start_date.desc()).first()


async def resolve_current_session_async(db: AsyncSession) -> SqlAcademicSession | None:
    """Async twin of `resolve_current_session`. Kept side-by-side rather than
    converting the original, because the original is still called with a
    sync `Session` from `admin_helpers.py` and `assignment_routes.py`
    (neither ported yet — see the original implementation plan Sprint 2/10). Both
    versions must stay behaviorally identical; if you change the filter/order
    logic in one, change it in the other."""
    return (
        await db.scalars(
            select(SqlAcademicSession).where(SqlAcademicSession.is_current.is_(True)).order_by(SqlAcademicSession.start_date.desc())
        )
    ).first()


def get_student_session_record(db, student_id: str, session_id: str) -> SqlStudentSessionRecord | None:
    return (
        db.query(SqlStudentSessionRecord)
        .filter(SqlStudentSessionRecord.student_id == student_id, SqlStudentSessionRecord.session_id == session_id)
        .first()
    )


def sync_user_cached_fields(db, student: SqlUser, record: SqlStudentSessionRecord) -> None:
    """users.year/users.semester/users.batch_id/users.section_id are kept as a
    cache of the *current* session's record so existing screens that read
    them directly keep working without a rewrite. Only call this for the
    session that is currently marked is_current."""
    student.year = record.study_year
    student.semester = record.semester
    if record.batch_id:
        student.batch_id = record.batch_id
    if record.section_id:
        student.section_id = record.section_id


def mirror_teacher_allocations(db, teacher_id: str, allocations: list[dict]) -> None:
    """Write a session-aware copy of a teacher's allocations alongside the
    canonical users.assignments JSON blob, so the rollover engine can carry
    them forward without re-parsing the JSON's legacy display-name fields.
    Best-effort: if no current session exists yet, this is a no-op — the
    JSON write (the real source of truth for every existing screen) still
    succeeds either way."""
    current_session = resolve_current_session(db)
    if not current_session:
        return
    db.query(SqlTeacherSessionAllocation).filter(
        SqlTeacherSessionAllocation.teacher_id == teacher_id, SqlTeacherSessionAllocation.session_id == current_session.id
    ).delete(synchronize_session=False)
    for allocation in allocations or []:
        db.add(
            SqlTeacherSessionAllocation(
                id=str(uuid.uuid4()),
                teacher_id=teacher_id,
                session_id=current_session.id,
                program_id=allocation.get("program_id"),
                batch_id=allocation.get("batch_id"),
                section_id=allocation.get("section_id"),
                subject_ids=allocation.get("subject_ids") or [],
            )
        )


async def mirror_teacher_allocations_async(db: AsyncSession, teacher_id: str, allocations: list[dict]) -> None:
    """Async twin of `mirror_teacher_allocations` — same best-effort no-op-if-
    no-current-session behavior, same delete-then-recreate approach. See
    `resolve_current_session_async`'s docstring for why this isn't just a
    conversion of the original."""
    current_session = await resolve_current_session_async(db)
    if not current_session:
        return
    await db.execute(
        delete(SqlTeacherSessionAllocation).where(
            SqlTeacherSessionAllocation.teacher_id == teacher_id, SqlTeacherSessionAllocation.session_id == current_session.id
        )
    )
    for allocation in allocations or []:
        db.add(
            SqlTeacherSessionAllocation(
                id=str(uuid.uuid4()),
                teacher_id=teacher_id,
                session_id=current_session.id,
                program_id=allocation.get("program_id"),
                batch_id=allocation.get("batch_id"),
                section_id=allocation.get("section_id"),
                subject_ids=allocation.get("subject_ids") or [],
            )
        )


def next_term(term: str) -> str:
    return "even" if term == "odd" else "odd"


def next_session_label(current: SqlAcademicSession) -> tuple[str, str, datetime.date, datetime.date]:
    """Compute the (label, term, start_date, end_date) of the session that
    follows `current`. Odd -> Even stays in the same labelled year; Even ->
    Odd rolls the label forward by one year. Mirrors the Jul-Dec / Jan-Jun
    split used when academic_sessions are first seeded (migration 017)."""
    start_year = session_start_year(current)
    if current.term == "odd":
        end_year = start_year + 1
        return (
            f"{start_year}-{end_year}",
            "even",
            datetime.date(end_year, 1, 1),
            datetime.date(end_year, 6, 30),
        )
    next_start_year = start_year + 1
    return (
        f"{next_start_year}-{next_start_year + 1}",
        "odd",
        datetime.date(next_start_year, 7, 1),
        datetime.date(next_start_year, 12, 31),
    )
