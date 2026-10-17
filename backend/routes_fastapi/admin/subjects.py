"""Subject CRUD endpoints after Program became the top-level owner."""

import uuid

from core.db import db_session
from core.policy import Access, Resource, require_access
from fastapi import APIRouter, Depends, HTTPException
from models.sql_models import SqlBatch, SqlCourse, SqlStudentSubjectEnrollment, SqlSubject
from schemas.academic import SubjectCreate, SubjectUpdate
from services.admin_helpers import (
    _build_batch_label,
    _normalize_subject_code,
    _normalize_subject_credits,
    _normalize_subject_fk,
    _normalize_subject_name,
    _normalize_subject_year,
)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from routes_fastapi.admin.courses import compute_teacher_allocation_counts_async

router = APIRouter(tags=["admin-subjects"])


async def _validate_subject_links_async(db: AsyncSession, course_id: str | None, batch_id: str | None) -> None:
    if course_id and not (await db.scalars(select(SqlCourse.id).where(SqlCourse.id == course_id))).first():
        raise HTTPException(status_code=404, detail="Program not found")
    if batch_id:
        batch = (await db.scalars(select(SqlBatch).where(SqlBatch.id == batch_id))).first()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if course_id and batch.course_id != course_id:
            raise HTTPException(status_code=400, detail="Batch does not belong to selected program")


@router.get("/subjects")
async def get_subjects(
    course_id: str | None = None,
    batch_id: str | None = None,
    session_id: str | None = None,
    principal=Depends(require_access(Resource.SUBJECTS, Access.VIEW)),
    db: AsyncSession = Depends(db_session),
):
    query = select(SqlSubject)
    if course_id:
        query = query.where(SqlSubject.course_id == course_id)
    if batch_id:
        query = query.where(SqlSubject.batch_id == batch_id)
    subjects = (await db.scalars(query.order_by(SqlSubject.name.asc(), SqlSubject.code.asc()))).all()

    course_map = {
        program.id: {"name": program.name, "code": program.code}
        for program in (await db.scalars(select(SqlCourse))).all()
    }
    batch_map = {
        batch.id: {"label": _build_batch_label(batch.start_year, batch.end_year, batch.name), "course_id": batch.course_id}
        for batch in (await db.scalars(select(SqlBatch))).all()
    }
    enrollment_query = select(SqlStudentSubjectEnrollment.subject_id, func.count(SqlStudentSubjectEnrollment.id))
    if session_id:
        enrollment_query = enrollment_query.where(SqlStudentSubjectEnrollment.session_id == session_id)
    enrollment_rows = (await db.execute(enrollment_query.group_by(SqlStudentSubjectEnrollment.subject_id))).all()
    student_counts = dict(enrollment_rows)
    teacher_counts = await compute_teacher_allocation_counts_async(db)

    return {
        "subjects": [
            {
                "id": subject.id,
                "name": subject.name,
                "code": subject.code,
                "course_id": subject.course_id,
                "course_name": (course_map.get(subject.course_id) or {}).get("name"),
                "course_code": (course_map.get(subject.course_id) or {}).get("code"),
                "batch_id": subject.batch_id,
                "batch_label": (batch_map.get(subject.batch_id) or {}).get("label"),
                "year": subject.year,
                "credits": subject.credits,
                "enrollment_type": subject.enrollment_type,
                "total_students": student_counts.get(subject.id, 0),
                "total_teachers": len(teacher_counts["subject"].get(subject.id, ())),
            }
            for subject in subjects
        ]
    }


def _subject_values(data: dict, current: SqlSubject | None = None) -> dict:
    return {
        "name": _normalize_subject_name(data.get("name", current.name if current else None)),
        "code": _normalize_subject_code(data.get("code", current.code if current else None)),
        "course_id": _normalize_subject_fk(data.get("course_id", current.course_id if current else None), "Program", required=True),
        "batch_id": _normalize_subject_fk(data.get("batch_id", current.batch_id if current else None), "Batch", required=False),
        "credits": _normalize_subject_credits(data.get("credits", current.credits if current else 3)),
        "year": _normalize_subject_year(data.get("year", current.year if current else 1), default_year=current.year if current else 1),
        "enrollment_type": str(data.get("enrollment_type", current.enrollment_type if current else "compulsory") or "compulsory").lower(),
    }


async def _assert_subject_unique(db: AsyncSession, values: dict, subject_id: str | None = None) -> None:
    common = [SqlSubject.course_id == values["course_id"]]
    if subject_id:
        common.append(SqlSubject.id != subject_id)
    if (await db.scalars(select(SqlSubject.id).where(*common, func.lower(SqlSubject.name) == values["name"].lower()))).first():
        raise HTTPException(status_code=400, detail="Subject name already exists in this program")
    if (await db.scalars(select(SqlSubject.id).where(*common, func.lower(SqlSubject.code) == values["code"].lower()))).first():
        raise HTTPException(status_code=400, detail="Subject code already exists in this program")


@router.post("/subjects")
async def create_subject(
    body: SubjectCreate,
    principal=Depends(require_access(Resource.SUBJECTS, Access.EDIT)),
    db: AsyncSession = Depends(db_session),
):
    del principal
    values = _subject_values(body.model_dump())
    if values["enrollment_type"] not in {"compulsory", "optional"}:
        raise HTTPException(status_code=400, detail="Subject enrollment type must be compulsory or optional")
    await _validate_subject_links_async(db, values["course_id"], values["batch_id"])
    await _assert_subject_unique(db, values)
    subject = SqlSubject(id=str(uuid.uuid4()), **values)
    db.add(subject)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Duplicate subject is not allowed in the selected program") from exc
    return {"message": "Subject created", "id": subject.id}


@router.put("/subjects/{subject_id}")
async def update_subject(
    subject_id: str,
    body: SubjectUpdate,
    principal=Depends(require_access(Resource.SUBJECTS, Access.EDIT)),
    db: AsyncSession = Depends(db_session),
):
    del principal
    subject = (await db.scalars(select(SqlSubject).where(SqlSubject.id == subject_id))).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    values = _subject_values(body.model_dump(exclude_unset=True), subject)
    if values["enrollment_type"] not in {"compulsory", "optional"}:
        raise HTTPException(status_code=400, detail="Subject enrollment type must be compulsory or optional")
    await _validate_subject_links_async(db, values["course_id"], values["batch_id"])
    await _assert_subject_unique(db, values, subject_id)
    for key, value in values.items():
        setattr(subject, key, value)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Duplicate subject is not allowed in the selected program") from exc
    return {"message": "Subject updated"}


@router.delete("/subjects/{subject_id}")
async def delete_subject(
    subject_id: str,
    principal=Depends(require_access(Resource.SUBJECTS, Access.FULL)),
    db: AsyncSession = Depends(db_session),
):
    del principal
    subject = (await db.scalars(select(SqlSubject).where(SqlSubject.id == subject_id))).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    await db.delete(subject)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete this subject while it is still used") from exc
    return {"message": "Subject deleted"}
