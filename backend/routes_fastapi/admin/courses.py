"""Program CRUD endpoints (the API keeps legacy ``/courses`` paths until Sprint 9)."""

import uuid
from collections import defaultdict

from core.db import db_session
from core.policy import Permission, require
from fastapi import APIRouter, Depends, HTTPException
from models.sql_models import SqlBatch, SqlCourse, SqlStudentProfile, SqlSubject, SqlUser
from schemas.academic import CourseCreate, CourseUpdate
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from routes_fastapi.admin_routes import _normalize_course_code, _normalize_course_year, _normalize_program_name

router = APIRouter(tags=["admin-programs"])


async def compute_teacher_allocation_counts_async(db: AsyncSession) -> dict:
    """Count distinct teachers allocated to each academic scope."""
    program_teachers, batch_teachers, section_teachers, subject_teachers = (
        defaultdict(set),
        defaultdict(set),
        defaultdict(set),
        defaultdict(set),
    )
    teachers = (
        await db.execute(select(SqlUser.id, SqlUser.assignments).where(SqlUser.role == "teacher", SqlUser.is_active.is_(True)))
    ).all()
    for teacher_id, allocations in teachers:
        for allocation in allocations or []:
            if allocation.get("program_id"):
                program_teachers[allocation["program_id"]].add(teacher_id)
            if allocation.get("batch_id"):
                batch_teachers[allocation["batch_id"]].add(teacher_id)
            if allocation.get("section_id"):
                section_teachers[allocation["section_id"]].add(teacher_id)
            for subject_id in allocation.get("subject_ids") or []:
                subject_teachers[subject_id].add(teacher_id)
    return {"program": program_teachers, "batch": batch_teachers, "section": section_teachers, "subject": subject_teachers}


@router.get("/courses")
async def get_courses(
    year: int | None = None,
    principal=Depends(require(Permission.PROGRAM_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    del principal
    query = select(SqlCourse)
    if year is not None:
        query = query.where(SqlCourse.year == year)
    courses = (await db.scalars(query.order_by(SqlCourse.name.asc(), SqlCourse.code.asc()))).all()

    # Sprint 8: real FK count, replacing the former free-text alias matching.
    student_rows = (
        await db.execute(select(SqlStudentProfile.program_id, func.count()).group_by(SqlStudentProfile.program_id))
    ).all()
    student_counts = dict(student_rows)
    subject_counts = dict(
        (await db.execute(select(SqlSubject.course_id, func.count()).where(SqlSubject.course_id.is_not(None)).group_by(SqlSubject.course_id))).all()
    )
    batch_counts = dict((await db.execute(select(SqlBatch.course_id, func.count()).group_by(SqlBatch.course_id))).all())
    teacher_counts = await compute_teacher_allocation_counts_async(db)

    return {
        "courses": [
            {
                "id": program.id,
                "name": program.name,
                "code": program.code,
                "duration_years": program.duration_years,
                "year": program.year,
                "display_name": f"{program.name} ({program.code})" if program.code else program.name,
                "total_students": student_counts.get(program.id, 0),
                "total_subjects": subject_counts.get(program.id, 0),
                "total_batches": batch_counts.get(program.id, 0),
                "total_teachers": len(teacher_counts["program"].get(program.id, ())),
            }
            for program in courses
        ]
    }


@router.post("/courses")
async def create_course(
    body: CourseCreate,
    principal=Depends(require(Permission.PROGRAM_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    del principal
    data = body.model_dump()
    name = _normalize_program_name(data.get("name"))
    code = _normalize_course_code(data.get("code"))
    year = _normalize_course_year(data.get("year", 1))
    duration_years = int(data.get("duration_years", 4))
    if duration_years < 1 or duration_years > 12:
        raise HTTPException(status_code=400, detail="duration_years must be between 1 and 12")
    if (await db.scalars(select(SqlCourse.id).where(func.lower(SqlCourse.code) == code.lower()))).first():
        raise HTTPException(status_code=400, detail="Program code already exists")
    if (await db.scalars(select(SqlCourse.id).where(func.lower(SqlCourse.name) == name.lower()))).first():
        raise HTTPException(status_code=400, detail="Program already exists")

    program = SqlCourse(id=str(uuid.uuid4()), name=name, code=code, duration_years=duration_years, year=year)
    db.add(program)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Program with the same name/code already exists") from exc
    return {"message": "Program created", "id": program.id}


@router.put("/courses/{course_id}")
async def update_course(
    course_id: str,
    body: CourseUpdate,
    principal=Depends(require(Permission.PROGRAM_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    del principal
    data = body.model_dump(exclude_unset=True)
    program = (await db.scalars(select(SqlCourse).where(SqlCourse.id == course_id))).first()
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    next_name = _normalize_program_name(data.get("name", program.name))
    next_code = _normalize_course_code(data.get("code", program.code))
    next_year = _normalize_course_year(data.get("year", program.year))
    next_duration = int(data.get("duration_years", program.duration_years))
    if next_duration < 1 or next_duration > 12:
        raise HTTPException(status_code=400, detail="duration_years must be between 1 and 12")
    if (
        await db.scalars(select(SqlCourse.id).where(SqlCourse.id != course_id, func.lower(SqlCourse.code) == next_code.lower()))
    ).first():
        raise HTTPException(status_code=400, detail="Program code already exists")
    if (
        await db.scalars(select(SqlCourse.id).where(SqlCourse.id != course_id, func.lower(SqlCourse.name) == next_name.lower()))
    ).first():
        raise HTTPException(status_code=400, detail="Program already exists")

    program.name = next_name
    program.code = next_code
    program.year = next_year
    program.duration_years = next_duration
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Program with the same name/code already exists") from exc
    return {"message": "Program updated"}


@router.delete("/courses/{course_id}")
async def delete_course(
    course_id: str,
    principal=Depends(require(Permission.PROGRAM_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    del principal
    program = (await db.scalars(select(SqlCourse).where(SqlCourse.id == course_id))).first()
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    await db.delete(program)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete this program while it is still used") from exc
    return {"message": "Program deleted"}
