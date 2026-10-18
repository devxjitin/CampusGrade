import uuid

from core.db import db_session
from core.policy import require_roles
from fastapi import APIRouter, Depends
from models.assignment import SqlAssignmentAnnouncement
from schemas.assignment import AnnouncementInput
from sqlalchemy.ext.asyncio import AsyncSession

from .common import _assignment_students, _notification
from .payloads import _teacher_assignment

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
