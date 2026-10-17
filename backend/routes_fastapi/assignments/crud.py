import asyncio
import datetime
import re
import uuid

from core.db import db_session
from core.policy import Permission, require_roles, require_user
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from models.assignment import SqlAssignment, SqlAssignmentResource
from models.settings_store import write_audit_log
from pydantic import BaseModel, Field
from schemas.assignment import AssignmentCreate, AssignmentUpdate
from services.assignment_storage import get_assignment_storage
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .common import (
    ALLOWED_ATTACHMENT_TYPES,
    MAX_ATTACHMENT_BYTES,
    _assignment_has_submission_content,
    _now,
    _resources,
    _serialize_resource,
    _student_has_assignment_access,
)
from .payloads import _assignment_payload, _serialize_assignment, _submission_payload, _teacher_assignment
from .workflow import (
    _notify_assignment_published,
    _notify_assignment_updated,
    _student_assignment,
    _sync_rubric_and_links,
    _teacher_dashboard_summary,
    _validate_assignment_subject,
)

router = APIRouter()


@router.get("/teacher")
async def teacher_assignments(teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    rows = (await db.scalars(select(SqlAssignment).filter_by(created_by=teacher["_id"]).order_by(SqlAssignment.created_at.desc()))).all()
    data = []
    for row in rows:
        item = await _serialize_assignment(db, row, False)
        item["graded_count"] = item["published_grade_count"]
        data.append(item)
    return {"assignments": data, "summary": await _teacher_dashboard_summary(db, teacher, data)}


@router.get("/teacher/records")
async def teacher_assignment_records(teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    rows = (await db.scalars(select(SqlAssignment).filter_by(created_by=teacher["_id"]).order_by(SqlAssignment.due_at.desc()))).all()
    result = []
    for row in rows:
        item = await _serialize_assignment(db, row, False)
        if item["workflow_status"] in {"completed", "archived"}:
            result.append(item)
    return {"assignments": result}


@router.post("/teacher")
async def create_assignment(
    body: AssignmentCreate,
    request: Request,
    teacher=Depends(require_user(Permission.ASSIGNMENT_CREATE)),
    db: AsyncSession = Depends(db_session),
):
    await _validate_assignment_subject(db, body, teacher)
    from services.academic_calendar import resolve_current_session_async

    current_session = await resolve_current_session_async(db)
    row = SqlAssignment(
        id=str(uuid.uuid4()),
        title=body.title,
        instructions=body.instructions,
        total_marks=body.total_marks,
        due_at=body.due_at,
        status="published",
        created_by=teacher["_id"],
        result_release_mode=body.result_release_mode,
        session_id=current_session.id if current_session else None,
    )
    _assignment_payload(row, body)
    db.add(row)
    await db.flush()
    await _sync_rubric_and_links(db, row, body)
    await _notify_assignment_published(db, row)
    await db.commit()
    await write_audit_log(db, teacher["_id"], "assignment.created", row.id, {"title": row.title}, request.client.host if request.client else None)
    return {"message": "Assignment created", "assignment": await _serialize_assignment(db, row)}


@router.get("/teacher/{assignment_id}")
async def teacher_assignment_detail(assignment_id: str, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    return {"assignment": await _serialize_assignment(db, await _teacher_assignment(db, assignment_id, teacher))}


@router.put("/teacher/{assignment_id}")
async def update_assignment(
    assignment_id: str, body: AssignmentUpdate, request: Request, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)
):
    await _validate_assignment_subject(db, body, teacher)
    row = (
        await db.scalars(select(SqlAssignment).filter(SqlAssignment.id == assignment_id, SqlAssignment.created_by == teacher["_id"]).with_for_update())
    ).first()
    if not row:
        raise HTTPException(404, "Assignment not found")
    has_submissions = await _assignment_has_submission_content(db, row.id)
    if has_submissions:
        raise HTTPException(409, "Assignment cannot be edited after the first student submission")
    _assignment_payload(row, body)
    await _sync_rubric_and_links(db, row, body)
    await _notify_assignment_updated(db, row)
    await db.commit()
    await write_audit_log(db, teacher["_id"], "assignment.updated", row.id, {"title": row.title}, request.client.host if request.client else None)
    return {"message": "Assignment updated", "assignment": await _serialize_assignment(db, row)}


@router.delete("/teacher/{assignment_id}")
async def delete_or_archive_assignment(assignment_id: str, request: Request, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    row = await _teacher_assignment(db, assignment_id, teacher, lock=True)
    if await _assignment_has_submission_content(db, row.id):
        raise HTTPException(409, "Only an administrator can delete an assignment after a student submits")
    keys = [item.storage_key for item in await _resources(db, row.id) if item.storage_key]
    await db.delete(row)
    await db.commit()
    for key in keys:
        try:
            await get_assignment_storage().adelete(key)
        except Exception:
            pass
    await write_audit_log(db, teacher["_id"], "assignment.deleted", assignment_id, {}, request.client.host if request.client else None)
    return {"message": "Assignment deleted"}


@router.post("/teacher/{assignment_id}/attachments")
async def upload_attachment(
    assignment_id: str, file: UploadFile = File(...), teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)
):
    content = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(413, "Attachment exceeds 25 MB")
    if file.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(400, "Unsupported attachment type")
    storage = get_assignment_storage()
    row = await _teacher_assignment(db, assignment_id, teacher, lock=True)
    if await _assignment_has_submission_content(db, row.id):
        raise HTTPException(409, "Resources are locked after the first submission")
    attachment_count = await db.scalar(select(func.count(SqlAssignmentResource.id)).filter_by(assignment_id=row.id, kind="attachment"))
    if attachment_count >= 10:
        raise HTTPException(400, "Maximum 10 attachments")
    resource_id = str(uuid.uuid4())
    key = f"attachments/{row.id}/{resource_id}/{file.filename}"
    await storage.aput_bytes(key, content, file.content_type or "application/octet-stream")
    resource = SqlAssignmentResource(
        id=resource_id,
        assignment_id=row.id,
        kind="attachment",
        label=file.filename or "Attachment",
        storage_key=key,
        filename=file.filename,
        content_type=file.content_type,
        size_bytes=len(content),
        position=100,
    )
    db.add(resource)
    await _notify_assignment_updated(db, row)
    await db.commit()
    return {"resource": _serialize_resource(resource)}


class AttachmentPresignInput(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str
    size_bytes: int = Field(gt=0)


class AttachmentCompleteInput(BaseModel):
    resource_id: str = Field(min_length=36, max_length=36)
    filename: str = Field(min_length=1, max_length=255)
    content_type: str


def _attachment_key(assignment_id: str, resource_id: str, filename: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("._") or "attachment"
    return f"attachments/{assignment_id}/{resource_id}/{safe[:150]}"


async def _assert_can_add_attachment(db: AsyncSession, row) -> None:
    if await _assignment_has_submission_content(db, row.id):
        raise HTTPException(409, "Resources are locked after the first submission")
    attachment_count = await db.scalar(select(func.count(SqlAssignmentResource.id)).filter_by(assignment_id=row.id, kind="attachment"))
    if attachment_count >= 10:
        raise HTTPException(400, "Maximum 10 attachments")


@router.post("/teacher/{assignment_id}/attachments/presign")
async def presign_attachment_upload(
    assignment_id: str, body: AttachmentPresignInput, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)
):
    """Direct-to-storage upload. `upload_url` is null when the backend cannot presign
    (local dev storage); the client then falls back to the multipart endpoint."""
    if body.size_bytes > MAX_ATTACHMENT_BYTES:
        raise HTTPException(413, "Attachment exceeds 25 MB")
    if body.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(400, "Unsupported attachment type")
    row = await _teacher_assignment(db, assignment_id, teacher)
    await _assert_can_add_attachment(db, row)
    resource_id = str(uuid.uuid4())
    key = _attachment_key(row.id, resource_id, body.filename)
    url = await asyncio.to_thread(get_assignment_storage().presign_put, key, content_type=body.content_type)
    return {"resource_id": resource_id, "upload_url": url, "headers": {"Content-Type": body.content_type}}


@router.post("/teacher/{assignment_id}/attachments/complete")
async def complete_attachment_upload(
    assignment_id: str, body: AttachmentCompleteInput, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)
):
    if body.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(400, "Unsupported attachment type")
    row = await _teacher_assignment(db, assignment_id, teacher, lock=True)
    await _assert_can_add_attachment(db, row)
    key = _attachment_key(row.id, body.resource_id, body.filename)
    storage = get_assignment_storage()
    size = await storage.asize(key)
    if size is None:
        raise HTTPException(400, "Upload not found; try again")
    if size > MAX_ATTACHMENT_BYTES:
        await storage.adelete(key)
        raise HTTPException(413, "Attachment exceeds 25 MB")
    resource = SqlAssignmentResource(
        id=body.resource_id,
        assignment_id=row.id,
        kind="attachment",
        label=body.filename,
        storage_key=key,
        filename=body.filename,
        content_type=body.content_type,
        size_bytes=size,
        position=100,
    )
    db.add(resource)
    await _notify_assignment_updated(db, row)
    await db.commit()
    return {"resource": _serialize_resource(resource)}


@router.delete("/teacher/{assignment_id}/attachments/{resource_id}")
async def delete_attachment(assignment_id: str, resource_id: str, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    row = await _teacher_assignment(db, assignment_id, teacher, lock=True)
    if await _assignment_has_submission_content(db, row.id):
        raise HTTPException(409, "Resources are locked after the first submission")
    resource = (await db.scalars(select(SqlAssignmentResource).filter_by(id=resource_id, assignment_id=row.id, kind="attachment"))).first()
    if not resource:
        raise HTTPException(404, "Attachment not found")
    key = resource.storage_key
    await db.delete(resource)
    await _notify_assignment_updated(db, row)
    await db.commit()
    if key:
        await get_assignment_storage().adelete(key)
    return {"message": "Attachment deleted"}


@router.get("/student")
async def student_assignments(student=Depends(require_roles("student")), db: AsyncSession = Depends(db_session)):
    rows = (await db.scalars(select(SqlAssignment).filter(SqlAssignment.status == "published").order_by(SqlAssignment.due_at))).all()
    result = []
    for row in rows:
        if await _student_has_assignment_access(db, row, student):
            item = await _serialize_assignment(db, row, False)
            item.update(await _submission_payload(db, row, student["_id"]))
            result.append(item)
    return {"assignments": result}


@router.get("/student/{assignment_id}")
async def student_assignment_detail(assignment_id: str, student=Depends(require_roles("student")), db: AsyncSession = Depends(db_session)):
    row = await _student_assignment(db, assignment_id, student)
    data = await _serialize_assignment(db, row)
    data.update(await _submission_payload(db, row, student["_id"]))
    return {"assignment": data}


@router.get("/student/{assignment_id}/resources/{resource_id}")
async def download_student_resource(assignment_id: str, resource_id: str, student=Depends(require_roles("student")), db: AsyncSession = Depends(db_session)):
    assignment = await _student_assignment(db, assignment_id, student)
    resource = (await db.scalars(select(SqlAssignmentResource).filter_by(id=resource_id, assignment_id=assignment.id, kind="attachment"))).first()
    if not resource or not resource.storage_key:
        raise HTTPException(404, "Attachment not found")
    data = await get_assignment_storage().aget_bytes(resource.storage_key)
    safe_name = (resource.filename or "attachment").replace('"', "")
    return Response(
        content=data, media_type=resource.content_type or "application/octet-stream", headers={"Content-Disposition": f'attachment; filename="{safe_name}"'}
    )


@router.get("/student/{assignment_id}/resources/{resource_id}/url")
async def student_resource_download_url(assignment_id: str, resource_id: str, student=Depends(require_roles("student")), db: AsyncSession = Depends(db_session)):
    """Five-minute presigned link served straight from object storage. `url` is null
    when the backend cannot presign; use the streaming endpoint then."""
    assignment = await _student_assignment(db, assignment_id, student)
    resource = (await db.scalars(select(SqlAssignmentResource).filter_by(id=resource_id, assignment_id=assignment.id, kind="attachment"))).first()
    if not resource or not resource.storage_key:
        raise HTTPException(404, "Attachment not found")
    url = await asyncio.to_thread(
        get_assignment_storage().presign_get,
        resource.storage_key,
        filename=resource.filename or "attachment",
        content_type=resource.content_type or "application/octet-stream",
        expires=300,
    )
    return {"url": url}


@router.get("/student-tools/dashboard")
async def student_assignment_dashboard(student=Depends(require_roles("student")), db: AsyncSession = Depends(db_session)):
    items = []
    rows = (await db.scalars(select(SqlAssignment).filter(SqlAssignment.status == "published").order_by(SqlAssignment.due_at))).all()
    for row in rows:
        if await _student_has_assignment_access(db, row, student):
            item = await _serialize_assignment(db, row, False)
            item.update(await _submission_payload(db, row, student["_id"]))
            items.append(item)
    now = _now()
    due_soon = [
        item for item in items if item["phase"] == "open" and item["due_at"] and (item["due_at"] - now).total_seconds() <= 172800 and not item["submission"]
    ]
    return {
        "summary": {
            "total": len(items),
            "open": sum(item["phase"] == "open" for item in items),
            "submitted": sum(bool(item["submission"]) for item in items),
            "results": sum(bool(item["grade"]) for item in items),
        },
        "due_soon": due_soon[:6],
        "recent_results": [item for item in reversed(items) if item["grade"]][:5],
        "recent_submissions": [item for item in reversed(items) if item["submission"]][:5],
    }


@router.get("/student-tools/subjects")
async def student_assignment_subjects(student=Depends(require_roles("student")), db: AsyncSession = Depends(db_session)):
    groups = {}
    rows = (await db.scalars(select(SqlAssignment).filter(SqlAssignment.status == "published").order_by(SqlAssignment.due_at))).all()
    for row in rows:
        if not await _student_has_assignment_access(db, row, student):
            continue
        item = await _serialize_assignment(db, row, False)
        item.update(await _submission_payload(db, row, student["_id"]))
        subject = item.get("subject_record") or {"id": f"legacy:{item.get('subject') or 'general'}", "name": item.get("subject") or "General", "code": ""}
        group = groups.setdefault(subject["id"], {"subject": subject, "assignments": [], "summary": {"total": 0, "open": 0, "submitted": 0, "results": 0}})
        group["assignments"].append(item)
        group["summary"]["total"] += 1
        group["summary"]["open"] += int(item["phase"] == "open")
        group["summary"]["submitted"] += int(bool(item["submission"]))
        group["summary"]["results"] += int(bool(item["grade"]))
    return {"subjects": list(groups.values())}


@router.get("/teacher-tools/analytics")
async def teacher_assignment_analytics(teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    rows = (await db.scalars(select(SqlAssignment).filter_by(created_by=teacher["_id"]))).all()
    items = [await _serialize_assignment(db, row, False) for row in rows]
    by_subject = {}
    for item in items:
        key = (item.get("subject_record") or {}).get("name") or item.get("subject") or "General"
        stats = by_subject.setdefault(key, {"subject": key, "assignments": 0, "eligible": 0, "submitted": 0, "published": 0})
        stats["assignments"] += 1
        stats["eligible"] += item["eligible_count"]
        stats["submitted"] += item["submission_count"]
        stats["published"] += item["published_grade_count"]
    return {
        "subjects": list(by_subject.values()),
        "workflow": {
            status: sum(item["workflow_status"] == status for item in items)
            for status in ("scheduled", "open", "awaiting_grading", "results_partial", "completed", "archived")
        },
    }


def _parse_dashboard_date(value: str | None, *, end=False):
    if not value:
        return None
    try:
        parsed = datetime.date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(400, "Dates must use YYYY-MM-DD") from exc
    return datetime.datetime.combine(parsed, datetime.time.max if end else datetime.time.min)
