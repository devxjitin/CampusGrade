"""Academic session CRUD endpoints (topbar session switcher, Option A).

Follows the same thin-module pattern as the other files in this package
(courses.py, batches.py, ...): its own APIRouter, registered in
routes_fastapi/admin/__init__.py, mounted under /admin by app.py.
"""
import uuid

from core.db import db_session
from core.policy import Permission, require
from fastapi import APIRouter, Depends, HTTPException
from models.sql_models import SqlAcademicSession
from schemas.academic import AcademicSessionCreate, AcademicSessionUpdate
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(tags=["admin-academic-sessions"])


@router.get("/academic-sessions")
async def get_academic_sessions(principal=Depends(require(Permission.SESSION_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    sessions = (
        await db.scalars(select(SqlAcademicSession).order_by(SqlAcademicSession.start_date.desc()))
    ).all()
    return {
        "sessions": [
            {
                "id": s.id,
                "label": s.label,
                "term": s.term,
                "display_name": f"{s.label} ({s.term.capitalize()})",
                "start_date": s.start_date.isoformat(),
                "end_date": s.end_date.isoformat(),
                "is_current": s.is_current,
            }
            for s in sessions
        ]
    }


@router.post("/academic-sessions")
async def create_academic_session(body: AcademicSessionCreate, principal=Depends(require(Permission.SESSION_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    data = body.model_dump()
    if data["is_current"]:
        await db.execute(update(SqlAcademicSession).values(is_current=False))
    new_session = SqlAcademicSession(
        id=str(uuid.uuid4()),
        label=data["label"].strip(),
        term=data["term"],
        start_date=data["start_date"],
        end_date=data["end_date"],
        is_current=data["is_current"],
    )
    db.add(new_session)
    try:
        # Flush (not commit) so a constraint violation surfaces here, inside
        # the try/except, rather than at db_session's teardown commit — by
        # then the response would already be built and this handler would
        # never see the IntegrityError to convert it to a 400.
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="This label and term combination already exists") from exc
    return {"message": "Academic session created", "id": new_session.id}


@router.put("/academic-sessions/{session_id}")
async def update_academic_session(session_id: str, body: AcademicSessionUpdate, principal=Depends(require(Permission.SESSION_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    data = body.model_dump(exclude_unset=True)
    record = (
        await db.scalars(select(SqlAcademicSession).where(SqlAcademicSession.id == session_id))
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Academic session not found")
    if data.get("is_current"):
        await db.execute(
            update(SqlAcademicSession).where(SqlAcademicSession.id != session_id).values(is_current=False)
        )
    if "label" in data:
        record.label = str(data["label"]).strip()
    if "term" in data:
        record.term = data["term"]
    if "start_date" in data:
        record.start_date = data["start_date"]
    if "end_date" in data:
        record.end_date = data["end_date"]
    if "is_current" in data:
        record.is_current = data["is_current"]
    if record.end_date < record.start_date:
        raise HTTPException(status_code=400, detail="end_date must not be before start_date")
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="This label and term combination already exists") from exc
    return {"message": "Academic session updated"}


@router.delete("/academic-sessions/{session_id}")
async def delete_academic_session(session_id: str, principal=Depends(require(Permission.SESSION_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    record = (
        await db.scalars(select(SqlAcademicSession).where(SqlAcademicSession.id == session_id))
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Academic session not found")
    await db.delete(record)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete this academic session") from exc
    return {"message": "Academic session deleted"}
