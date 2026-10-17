"""Batch CRUD endpoints."""
import uuid
from collections import defaultdict

from core.db import db_session
from core.policy import Permission, require
from core.scoping import scope_to_programs
from fastapi import APIRouter, Depends, HTTPException
from models.sql_models import SqlBatch, SqlCourse, SqlSection, SqlStudentSessionRecord, SqlSubject, SqlUser
from schemas.academic import BatchCreate, BatchUpdate
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from routes_fastapi.admin.courses import compute_teacher_allocation_counts_async
from routes_fastapi.admin_routes import (
    _build_batch_aliases,
    _build_batch_label,
    _build_course_aliases,
    _normalize_batch_lookup_text,
    _normalize_batch_name,
    _normalize_batch_year,
    _normalize_lookup_text,
)

router = APIRouter(tags=["admin-batches"])

# Same audit as admin/courses.py: every import from admin_routes.py above is
# a pure string/number helper with no `db`/`session` parameter.


@router.get("/batches")
async def get_batches(
    course_id: str | None = None,
    session_id: str | None = None,
    principal=Depends(require(Permission.BATCH_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    # Sprint 5, the original implementation plan "Done when": a program admin scoped
    # to one program must not see another program's batches, even if they
    # pass someone else's course_id — scope_to_programs is applied
    # unconditionally, not just as a fallback when course_id is absent.
    query = scope_to_programs(select(SqlBatch), principal, SqlBatch.course_id)
    if course_id:
        query = query.where(SqlBatch.course_id == course_id)
    batches = (await db.scalars(query.order_by(SqlBatch.start_year.desc(), SqlBatch.end_year.desc()))).all()

    all_courses = (await db.scalars(select(SqlCourse))).all()
    course_map = {course.id: {"name": course.name, "code": course.code} for course in all_courses}
    course_aliases_by_id = {course.id: _build_course_aliases(course.name, course.code) for course in all_courses}

    batch_alias_to_ids = defaultdict(set)
    batch_course_map = {}
    for batch in batches:
        batch_course_map[batch.id] = batch.course_id
        for alias in _build_batch_aliases(batch):
            batch_alias_to_ids[alias].add(batch.id)

    student_rows = (await db.execute(select(SqlUser.course, SqlUser.batch).where(SqlUser.role == "student"))).all()
    batch_student_counts = defaultdict(int)
    for student_course, student_batch in student_rows:
        batch_key = _normalize_batch_lookup_text(student_batch)
        if not batch_key:
            continue
        candidate_batch_ids = set(batch_alias_to_ids.get(batch_key, set()))
        if not candidate_batch_ids:
            continue
        matched_batch_id = None
        if len(candidate_batch_ids) == 1:
            matched_batch_id = next(iter(candidate_batch_ids))
        else:
            student_course_key = _normalize_lookup_text(student_course)
            if student_course_key:
                narrowed_batch_ids = [
                    batch_id_key
                    for batch_id_key in candidate_batch_ids
                    if student_course_key in course_aliases_by_id.get(batch_course_map.get(batch_id_key), set())
                ]
                if len(narrowed_batch_ids) == 1:
                    matched_batch_id = narrowed_batch_ids[0]
            if not matched_batch_id:
                candidate_course_ids = {batch_course_map.get(batch_id_key) for batch_id_key in candidate_batch_ids}
                if len(candidate_course_ids) == 1:
                    matched_batch_id = next(iter(candidate_batch_ids))
        if matched_batch_id:
            batch_student_counts[matched_batch_id] += 1

    if session_id:
        batch_student_counts = defaultdict(int)
        rows = (
            await db.execute(
                select(SqlStudentSessionRecord.batch_id).where(
                    SqlStudentSessionRecord.session_id == session_id,
                    SqlStudentSessionRecord.status == "active",
                    SqlStudentSessionRecord.batch_id.is_not(None),
                )
            )
        ).all()
        for (record_batch_id,) in rows:
            batch_student_counts[record_batch_id] += 1

    batch_section_counts = defaultdict(int)
    for (section_batch_id,) in (await db.execute(select(SqlSection.batch_id))).all():
        batch_section_counts[section_batch_id] += 1

    batch_subject_counts = defaultdict(int)
    for (subject_batch_id,) in (await db.execute(select(SqlSubject.batch_id).where(SqlSubject.batch_id.is_not(None)))).all():
        batch_subject_counts[subject_batch_id] += 1

    teacher_counts = await compute_teacher_allocation_counts_async(db)

    def _label(b):
        return _build_batch_label(b.start_year, b.end_year, b.name)

    return {
        "batches": [
            {
                "id": b.id,
                "course_id": b.course_id,
                "course_name": (course_map.get(b.course_id) or {}).get("name"),
                "course_code": (course_map.get(b.course_id) or {}).get("code"),
                "name": b.name,
                "start_year": b.start_year,
                "end_year": b.end_year,
                "label": _label(b),
                "display_name": (
                    f"{(course_map.get(b.course_id) or {}).get('name')} ({(course_map.get(b.course_id) or {}).get('code')}) - {_label(b)}"
                    if (course_map.get(b.course_id) or {}).get("name") and (course_map.get(b.course_id) or {}).get("code")
                    else (
                        f"{(course_map.get(b.course_id) or {}).get('name')} - {_label(b)}"
                        if (course_map.get(b.course_id) or {}).get("name")
                        else _label(b)
                    )
                ),
                "total_students": batch_student_counts.get(b.id, 0),
                "total_sections": batch_section_counts.get(b.id, 0),
                "total_subjects": batch_subject_counts.get(b.id, 0),
                "total_teachers": len(teacher_counts["batch"].get(b.id, ())),
                "status": b.status,
                "auto_created": b.auto_created,
                "intake_open": b.intake_open,
            }
            for b in batches
        ]
    }


@router.post("/batches")
async def create_batch(body: BatchCreate, principal=Depends(require(Permission.BATCH_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    data = body.model_dump()
    course_id = str(data.get("course_id") or "").strip()
    if not course_id:
        raise HTTPException(status_code=400, detail="Program is required")
    if not (await db.scalars(select(SqlCourse).where(SqlCourse.id == course_id))).first():
        raise HTTPException(status_code=404, detail="Program not found")

    start_year = _normalize_batch_year(data.get("start_year"), "Batch start year")
    end_year = _normalize_batch_year(data.get("end_year"), "Batch end year")
    if end_year <= start_year:
        raise HTTPException(status_code=400, detail="Batch end year must be greater than start year")
    name = _normalize_batch_name(data.get("name"))

    if (
        await db.scalars(
            select(SqlBatch).where(SqlBatch.course_id == course_id, SqlBatch.start_year == start_year, SqlBatch.end_year == end_year)
        )
    ).first():
        raise HTTPException(status_code=400, detail="Batch already exists for this program")

    batch = SqlBatch(id=str(uuid.uuid4()), course_id=course_id, name=name, start_year=start_year, end_year=end_year)
    db.add(batch)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Batch already exists for this program") from exc
    return {"message": "Batch created", "id": batch.id}


@router.put("/batches/{batch_id}")
async def update_batch(batch_id: str, body: BatchUpdate, principal=Depends(require(Permission.BATCH_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    data = body.model_dump(exclude_unset=True)
    batch = (await db.scalars(select(SqlBatch).where(SqlBatch.id == batch_id))).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    next_course_id = str(data.get("course_id", batch.course_id) or "").strip()
    if not next_course_id:
        raise HTTPException(status_code=400, detail="Program is required")
    if not (await db.scalars(select(SqlCourse).where(SqlCourse.id == next_course_id))).first():
        raise HTTPException(status_code=404, detail="Program not found")

    next_start_year = _normalize_batch_year(data.get("start_year", batch.start_year), "Batch start year")
    next_end_year = _normalize_batch_year(data.get("end_year", batch.end_year), "Batch end year")
    if next_end_year <= next_start_year:
        raise HTTPException(status_code=400, detail="Batch end year must be greater than start year")
    next_name = _normalize_batch_name(data.get("name", batch.name))

    if (
        await db.scalars(
            select(SqlBatch).where(
                SqlBatch.id != batch_id, SqlBatch.course_id == next_course_id,
                SqlBatch.start_year == next_start_year, SqlBatch.end_year == next_end_year,
            )
        )
    ).first():
        raise HTTPException(status_code=400, detail="Batch already exists for this program")

    batch.course_id = next_course_id
    batch.start_year = next_start_year
    batch.end_year = next_end_year
    batch.name = next_name
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Batch already exists for this program") from exc
    return {"message": "Batch updated"}


@router.delete("/batches/{batch_id}")
async def delete_batch(batch_id: str, principal=Depends(require(Permission.BATCH_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    batch = (await db.scalars(select(SqlBatch).where(SqlBatch.id == batch_id))).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    await db.delete(batch)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete this batch while it is still used by other records") from exc
    return {"message": "Batch deleted"}
