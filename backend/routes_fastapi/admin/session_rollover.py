"""Session rollover endpoints: preview, execute, undo, history.

See the original academic-sessions plan Part 4 and
backend/services/session_rollover.py for the actual logic — this module is
just the thin HTTP wrapper, following the pattern of the other files in
routes_fastapi/admin/.
"""
from core.db import db_session
from core.policy import Permission, require
from fastapi import APIRouter, Depends, HTTPException
from models.sql_models import SqlAcademicSession, SqlRolloverRun
from services import session_rollover
from services.academic_calendar import resolve_current_session_async
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(tags=["admin-session-rollover"])


@router.get("/session-rollover/preview")
async def preview_rollover(principal=Depends(require(Permission.ROLLOVER_EXECUTE)), db: AsyncSession = Depends(db_session)):
    del principal
    current = await resolve_current_session_async(db)
    if not current:
        raise HTTPException(400, "No current academic session is set")
    result = await session_rollover.preview(db, current)
    return {
        "from_session": result.from_session,
        "to_session": result.to_session,
        "to_session_exists": result.to_session_exists,
        "promote_count": result.promote_count,
        "graduate_count": result.graduate_count,
        "new_batches": result.new_batches,
        "new_sections_count": result.new_sections_count,
        "teacher_allocation_count": result.teacher_allocation_count,
        "warnings": result.warnings,
    }


@router.post("/session-rollover/execute")
async def execute_rollover(principal=Depends(require(Permission.ROLLOVER_EXECUTE)), db: AsyncSession = Depends(db_session)):
    current = await resolve_current_session_async(db)
    if not current:
        raise HTTPException(400, "No current academic session is set")
    return await session_rollover.execute(db, current, principal.user_id)


@router.post("/session-rollover/{run_id}/undo")
async def undo_rollover(run_id: str, principal=Depends(require(Permission.ROLLOVER_EXECUTE)), db: AsyncSession = Depends(db_session)):
    del principal
    return await session_rollover.undo(db, run_id)


@router.get("/session-rollover/history")
async def rollover_history(principal=Depends(require(Permission.ROLLOVER_EXECUTE)), db: AsyncSession = Depends(db_session)):
    del principal
    runs = (await db.scalars(select(SqlRolloverRun).order_by(SqlRolloverRun.executed_at.desc()).limit(50))).all()
    sessions = {row.id: row for row in (await db.scalars(select(SqlAcademicSession))).all()}
    return {
        "runs": [
            {
                "id": run.id,
                "from_session": sessions[run.from_session_id].label + " (" + sessions[run.from_session_id].term + ")" if run.from_session_id and run.from_session_id in sessions else None,
                "to_session": sessions[run.to_session_id].label + " (" + sessions[run.to_session_id].term + ")" if run.to_session_id in sessions else None,
                "executed_at": run.executed_at.isoformat() if run.executed_at else None,
                "counts": run.counts,
                "undone_at": run.undone_at.isoformat() if run.undone_at else None,
            }
            for run in runs
        ]
    }
