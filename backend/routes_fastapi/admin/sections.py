"""Section CRUD endpoints."""
import uuid
from collections import defaultdict

from core.db import db_session
from core.policy import Permission, require
from core.scoping import scope_to_programs
from fastapi import APIRouter, Depends, HTTPException
from models.sql_models import SqlBatch, SqlCourse, SqlSection, SqlStudentSessionRecord, SqlUser
from schemas.academic import SectionCreate, SectionUpdate
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from routes_fastapi.admin.courses import compute_teacher_allocation_counts_async
from routes_fastapi.admin_routes import _build_batch_label, _normalize_section_name

router = APIRouter(tags=["admin-sections"])


async def _validate_section_links_async(db: AsyncSession, course_id: str, batch_id: str) -> None:
    """Async twin of admin_routes.py's `_validate_section_links` (a private,
    session-taking-but-pure lookup helper local to that file — not a
    cross-file service, so safe to duplicate, same as `_build_teacher_assignments_async`)."""
    if not (await db.scalars(select(SqlCourse).where(SqlCourse.id == course_id))).first():
        raise HTTPException(status_code=404, detail="Program not found")
    batch = (await db.scalars(select(SqlBatch).where(SqlBatch.id == batch_id))).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.course_id != course_id:
        raise HTTPException(status_code=400, detail="Batch does not belong to selected program")


@router.get("/sections")
async def get_sections(
    course_id: str | None = None, batch_id: str | None = None, session_id: str | None = None,
    principal=Depends(require(Permission.SECTION_MANAGE)), db: AsyncSession = Depends(db_session),
):
    # See admin/batches.py's get_batches for why this is unconditional.
    query = scope_to_programs(select(SqlSection), principal, SqlSection.course_id)
    if course_id:
        query = query.where(SqlSection.course_id == course_id)
    if batch_id:
        query = query.where(SqlSection.batch_id == batch_id)
    sections = (await db.scalars(query.order_by(SqlSection.name.asc()))).all()

    course_map = {course.id: {"name": course.name, "code": course.code} for course in (await db.scalars(select(SqlCourse))).all()}
    batch_map = {
        batch.id: _build_batch_label(batch.start_year, batch.end_year, batch.name)
        for batch in (await db.scalars(select(SqlBatch))).all()
    }
    if session_id:
        section_student_counts = defaultdict(int)
        rows = (
            await db.execute(
                select(SqlStudentSessionRecord.section_id).where(
                    SqlStudentSessionRecord.session_id == session_id,
                    SqlStudentSessionRecord.status == "active",
                    SqlStudentSessionRecord.section_id.is_not(None),
                )
            )
        ).all()
        for (record_section_id,) in rows:
            section_student_counts[record_section_id] += 1
    else:
        rows = (
            await db.execute(
                select(SqlUser.section_id, func.count(SqlUser.id))
                .where(SqlUser.role == "student", SqlUser.section_id.is_not(None))
                .group_by(SqlUser.section_id)
            )
        ).all()
        section_student_counts = {section_id: count for section_id, count in rows if section_id}

    teacher_counts = await compute_teacher_allocation_counts_async(db)

    return {
        "sections": [
            {
                "id": section.id,
                "course_id": section.course_id,
                "course_name": (course_map.get(section.course_id) or {}).get("name"),
                "course_code": (course_map.get(section.course_id) or {}).get("code"),
                "batch_id": section.batch_id,
                "batch_label": batch_map.get(section.batch_id),
                "name": section.name,
                "total_students": section_student_counts.get(section.id, 0),
                "total_teachers": len(teacher_counts["section"].get(section.id, ())),
            }
            for section in sections
        ]
    }


@router.post("/sections")
async def create_section(body: SectionCreate, principal=Depends(require(Permission.SECTION_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    data = body.model_dump()
    name = _normalize_section_name(data.get("name"))
    course_id = str(data.get("course_id") or "").strip()
    batch_id = str(data.get("batch_id") or "").strip()
    if not course_id:
        raise HTTPException(status_code=400, detail="Program is required")
    if not batch_id:
        raise HTTPException(status_code=400, detail="Batch is required")

    await _validate_section_links_async(db, course_id, batch_id)

    if (
        await db.scalars(
            select(SqlSection).where(
                SqlSection.course_id == course_id, SqlSection.batch_id == batch_id, func.lower(SqlSection.name) == name.lower()
            )
        )
    ).first():
        raise HTTPException(status_code=400, detail="Section already exists for this program and batch")

    section = SqlSection(id=str(uuid.uuid4()), course_id=course_id, batch_id=batch_id, name=name)
    db.add(section)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Section already exists for this program and batch") from exc
    return {"message": "Section created", "id": section.id}


@router.put("/sections/{section_id}")
async def update_section(section_id: str, body: SectionUpdate, principal=Depends(require(Permission.SECTION_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    data = body.model_dump(exclude_unset=True)
    section = (await db.scalars(select(SqlSection).where(SqlSection.id == section_id))).first()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    next_name = _normalize_section_name(data.get("name", section.name))
    next_course_id = str(data.get("course_id", section.course_id) or "").strip()
    next_batch_id = str(data.get("batch_id", section.batch_id) or "").strip()
    if not next_course_id:
        raise HTTPException(status_code=400, detail="Program is required")
    if not next_batch_id:
        raise HTTPException(status_code=400, detail="Batch is required")

    await _validate_section_links_async(db, next_course_id, next_batch_id)

    if (
        await db.scalars(
            select(SqlSection).where(
                SqlSection.id != section_id, SqlSection.course_id == next_course_id,
                SqlSection.batch_id == next_batch_id, func.lower(SqlSection.name) == next_name.lower(),
            )
        )
    ).first():
        raise HTTPException(status_code=400, detail="Section already exists for this program and batch")

    section.course_id = next_course_id
    section.batch_id = next_batch_id
    section.name = next_name
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Section already exists for this program and batch") from exc
    return {"message": "Section updated"}


@router.delete("/sections/{section_id}")
async def delete_section(section_id: str, principal=Depends(require(Permission.SECTION_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    section = (await db.scalars(select(SqlSection).where(SqlSection.id == section_id))).first()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    await db.delete(section)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete this section while it is still used by other records") from exc
    return {"message": "Section deleted"}
