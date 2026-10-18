"""Super Admin data export: a session's grades + audit log (Sprint 5, S5-04).

The request only enqueues a worker job. The finished ZIP is fetched with a short-lived presigned URL
(or streamed by the API when the storage backend cannot presign).
"""

import asyncio
import uuid

from core.db import db_session
from core.errors import Conflict, NotFound
from core.policy import Permission, require
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from models.data_export import EXPORT_READY, SqlDataExport
from models.settings_store import write_audit_log
from models.sql_models import SqlAcademicSession
from pydantic import BaseModel
from services import jobs as job_service
from services.object_storage import get_private_storage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(tags=["admin-exports"])

EXPORT_JOB = "export.session"
EXPORT_NAMESPACE = "exports"


class ExportRequest(BaseModel):
    session_id: str


def _serialize(row: SqlDataExport, session_label: str | None = None) -> dict:
    return {
        "id": row.id,
        "session_id": row.session_id,
        "session_label": session_label,
        "status": row.status,
        "filename": row.filename,
        "size_bytes": row.size_bytes,
        "error": row.error,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
    }


@router.post("/exports", status_code=202)
async def request_export(
    body: ExportRequest, request: Request, principal=Depends(require(Permission.DATA_EXPORT)), db: AsyncSession = Depends(db_session)
):
    session = await db.get(SqlAcademicSession, body.session_id)
    if session is None:
        raise NotFound("Academic session not found")
    row = SqlDataExport(id=str(uuid.uuid4()), session_id=session.id, requested_by=principal.user_id)
    db.add(row)
    await db.flush()
    await job_service.enqueue(db, EXPORT_JOB, {"export_id": row.id}, max_attempts=3)
    await write_audit_log(db, principal.user_id, "data.export_requested", row.id, {"session_id": session.id}, request.client.host if request.client else None)
    return _serialize(row, f"{session.label} ({session.term})")


@router.get("/exports")
async def list_exports(principal=Depends(require(Permission.DATA_EXPORT)), db: AsyncSession = Depends(db_session)):
    rows = (await db.scalars(select(SqlDataExport).order_by(SqlDataExport.created_at.desc()).limit(50))).all()
    labels = {s.id: f"{s.label} ({s.term})" for s in (await db.scalars(select(SqlAcademicSession))).all()}
    return {"exports": [_serialize(row, labels.get(row.session_id)) for row in rows]}


async def _ready_export(db: AsyncSession, export_id: str) -> SqlDataExport:
    row = await db.get(SqlDataExport, export_id)
    if row is None:
        raise NotFound("Export not found")
    if row.status != EXPORT_READY or not row.object_key:
        raise Conflict("This export is not ready yet")
    return row


@router.get("/exports/{export_id}/url")
async def export_download_url(
    export_id: str, request: Request, principal=Depends(require(Permission.DATA_EXPORT)), db: AsyncSession = Depends(db_session)
):
    """Five-minute presigned link. `url` is null when the backend cannot presign; use `/file` then."""
    row = await _ready_export(db, export_id)
    assert row.object_key
    url = await asyncio.to_thread(
        get_private_storage(EXPORT_NAMESPACE).presign_get, row.object_key, filename=row.filename or "export.zip", content_type="application/zip", expires=300
    )
    await write_audit_log(db, principal.user_id, "data.export_downloaded", row.id, None, request.client.host if request.client else None)
    return {"url": url}


@router.get("/exports/{export_id}/file")
async def export_download_file(
    export_id: str, request: Request, principal=Depends(require(Permission.DATA_EXPORT)), db: AsyncSession = Depends(db_session)
):
    row = await _ready_export(db, export_id)
    assert row.object_key
    data = await get_private_storage(EXPORT_NAMESPACE).aget_bytes(row.object_key)
    await write_audit_log(db, principal.user_id, "data.export_downloaded", row.id, None, request.client.host if request.client else None)
    return Response(data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{row.filename or "export.zip"}"'})
