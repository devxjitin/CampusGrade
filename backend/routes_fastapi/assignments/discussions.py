import uuid

from core.db import db_session
from core.policy import require_roles
from fastapi import APIRouter, Depends, HTTPException
from models.assignment import SqlAssignment, SqlAssignmentAnnouncement, SqlAssignmentThread, SqlAssignmentThreadMessage
from schemas.assignment import AnnouncementInput, ThreadInput, ThreadMessageInput, ThreadStatusInput
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .common import _assignment_students, _notification, _now
from .payloads import _serialize_thread, _teacher_assignment
from .workflow import _student_assignment

router = APIRouter()


@router.post("/teacher/{assignment_id}/announcements")
async def create_announcement(assignment_id: str, body: AnnouncementInput, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    assignment = await _teacher_assignment(db, assignment_id, teacher)
    row = SqlAssignmentAnnouncement(id=str(uuid.uuid4()), assignment_id=assignment.id, author_id=teacher["_id"], title=body.title, body=body.body)
    db.add(row)
    for student in await _assignment_students(db, assignment):
        await _notification(db, student.id, body.title, body.body[:500], "assignment_announcement", f"/assignments/{assignment.id}")
    await db.commit()
    return {"message": "Announcement posted", "announcement": {"id": row.id, "title": row.title, "body": row.body, "created_at": row.created_at}}


@router.post("/student-tools/{assignment_id}/threads")
async def create_student_thread(assignment_id: str, body: ThreadInput, student=Depends(require_roles("student")), db: AsyncSession = Depends(db_session)):
    assignment = await _student_assignment(db, assignment_id, student)
    thread = SqlAssignmentThread(id=str(uuid.uuid4()), assignment_id=assignment.id, student_id=student["_id"], subject=body.subject)
    db.add(thread)
    await db.flush()
    db.add(SqlAssignmentThreadMessage(id=str(uuid.uuid4()), thread_id=thread.id, author_id=student["_id"], body=body.message))
    await _notification(
        db,
        assignment.created_by,
        "New assignment question",
        f"{student.get('name', 'A student')} asked about {assignment.title}.",
        "assignment_question",
        f"/assignments/{assignment.id}/review",
    )
    await db.commit()
    return {"message": "Question sent", "thread": await _serialize_thread(db, thread)}


@router.get("/student-tools/threads")
async def student_threads(student=Depends(require_roles("student")), db: AsyncSession = Depends(db_session)):
    rows = (await db.scalars(select(SqlAssignmentThread).filter_by(student_id=student["_id"]).order_by(SqlAssignmentThread.updated_at.desc()))).all()
    return {"threads": [await _serialize_thread(db, row) for row in rows]}


@router.get("/teacher-tools/threads")
async def teacher_threads(teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    rows = (
        await db.scalars(
            select(SqlAssignmentThread).join(SqlAssignment).filter(SqlAssignment.created_by == teacher["_id"]).order_by(SqlAssignmentThread.updated_at.desc())
        )
    ).all()
    return {"threads": [await _serialize_thread(db, row) for row in rows]}


@router.post("/discussion/threads/{thread_id}/messages")
async def reply_thread(thread_id: str, body: ThreadMessageInput, user=Depends(require_roles("student", "teacher")), db: AsyncSession = Depends(db_session)):
    thread = (await db.scalars(select(SqlAssignmentThread).filter_by(id=thread_id))).first()
    if not thread:
        raise HTTPException(404, "Discussion not found")
    assignment = (await db.scalars(select(SqlAssignment).filter_by(id=thread.assignment_id))).first()
    if user["role"] == "student" and thread.student_id != user["_id"]:
        raise HTTPException(403, "Discussion access denied")
    if user["role"] == "teacher" and assignment.created_by != user["_id"]:
        raise HTTPException(403, "Discussion access denied")
    db.add(SqlAssignmentThreadMessage(id=str(uuid.uuid4()), thread_id=thread.id, author_id=user["_id"], body=body.message))
    thread.updated_at = _now()
    recipient = assignment.created_by if user["role"] == "student" else thread.student_id
    await _notification(db, recipient, "Assignment discussion reply", f"New reply: {thread.subject}", "assignment_reply", f"/assignments/{assignment.id}")
    await db.commit()
    return {"message": "Reply sent", "thread": await _serialize_thread(db, thread)}


@router.patch("/teacher-tools/threads/{thread_id}")
async def update_thread_status(thread_id: str, body: ThreadStatusInput, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    thread = (
        await db.scalars(
            select(SqlAssignmentThread).join(SqlAssignment).filter(SqlAssignmentThread.id == thread_id, SqlAssignment.created_by == teacher["_id"])
        )
    ).first()
    if not thread:
        raise HTTPException(404, "Discussion not found")
    thread.status = body.status
    await db.commit()
    return {"message": "Discussion updated"}
