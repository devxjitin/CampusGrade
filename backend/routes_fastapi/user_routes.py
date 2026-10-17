import logging

from core.db import db_session
from fastapi import APIRouter, Depends, HTTPException, Response
from models.database import is_database_available
from models.sql_models import SqlUser
from models.user_preferences import SqlUserPreference
from schemas.common import MessageResponse
from schemas.preferences import NOTIFICATION_KEYS, PreferenceUpdate
from schemas.user import UserResponse, UserUpdate
from services.identity_service import update_user_fields
from services.session_service import list_sessions, revoke_other_sessions, revoke_session
from services.user_service import UserService
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from routes_fastapi.deps import get_current_user

logger = logging.getLogger("CampusGrade.User")
router = APIRouter(tags=["user"])
user_service = UserService()

DEFAULT_NOTIFICATION_PREFERENCES = {key: True for key in NOTIFICATION_KEYS}


async def _preference_payload(user_id: str, db: AsyncSession) -> dict:
    if not is_database_available():
        raise HTTPException(status_code=503, detail="Preference storage is unavailable")
    row = (
        await db.scalars(select(SqlUserPreference).where(SqlUserPreference.user_id == str(user_id)))
    ).first()
    values = {**DEFAULT_NOTIFICATION_PREFERENCES, **(row.notification_preferences or {})} if row else dict(DEFAULT_NOTIFICATION_PREFERENCES)
    return {"notification_preferences": values, "schema_version": row.schema_version if row else 1}


@router.get("/me/preferences")
async def get_preferences(current_user=Depends(get_current_user), db: AsyncSession = Depends(db_session)):
    return await _preference_payload(current_user["_id"], db)


@router.patch("/me/preferences")
async def update_preferences(payload: PreferenceUpdate, current_user=Depends(get_current_user), db: AsyncSession = Depends(db_session)):
    invalid = set(payload.notification_preferences) - NOTIFICATION_KEYS
    if invalid:
        raise HTTPException(status_code=422, detail=f"Unknown notification preference: {sorted(invalid)[0]}")
    if not is_database_available():
        raise HTTPException(status_code=503, detail="Preference storage is unavailable")
    row = (
        await db.scalars(select(SqlUserPreference).where(SqlUserPreference.user_id == current_user["_id"]))
    ).first()
    current = {**DEFAULT_NOTIFICATION_PREFERENCES, **(row.notification_preferences or {})} if row else dict(DEFAULT_NOTIFICATION_PREFERENCES)
    current.update(payload.notification_preferences)
    if row is None:
        row = SqlUserPreference(user_id=current_user["_id"], notification_preferences=current)
        db.add(row)
    else:
        row.notification_preferences = current
    await db.flush()
    return {"message": "Notification preferences updated", "notification_preferences": current, "schema_version": row.schema_version}


@router.get("/me/sessions")
async def get_sessions(current_user=Depends(get_current_user), db: AsyncSession = Depends(db_session)):
    return {"sessions": await list_sessions(db, current_user["_id"], current_user.get("_session_id"))}


@router.delete("/me/sessions/{session_id}")
async def delete_session(session_id: str, response: Response, current_user=Depends(get_current_user), db: AsyncSession = Depends(db_session)):
    if not await revoke_session(db, current_user["_id"], session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    if session_id == current_user.get("_session_id"):
        response.delete_cookie("campusgrade_refresh", path="/")
    return {"message": "Session revoked", "current_session_revoked": session_id == current_user.get("_session_id")}


@router.post("/me/sessions/revoke-others")
async def delete_other_sessions(current_user=Depends(get_current_user), db: AsyncSession = Depends(db_session)):
    count = await revoke_other_sessions(db, current_user["_id"], current_user.get("_session_id"))
    return {"message": "Other sessions revoked", "count": count}


@router.get("/profile", response_model=UserResponse)
def profile(current_user=Depends(get_current_user)):
    return {
        "id": str(current_user["_id"]),
        "name": current_user["name"],
        "bio": current_user.get("bio") or "",
        "email": current_user["email"],
        "role": current_user["role"],
        "avatar": current_user.get("avatar"),
        "course": current_user.get("course"),
        "batch": current_user.get("batch"),
        "roll_no": current_user.get("roll_no"),
        "assignments": current_user.get("assignments") or [],
        "achievements": current_user.get("achievements") or [],
        "github_repositories": current_user.get("github_repositories") or [],
        # The database permits NULL for optional profile fields while the API
        # deliberately presents stable empty values to the client.
        "github_username": current_user.get("github_username") or "",
        "leetcode_username": current_user.get("leetcode_username") or "",
        "last_login": current_user.get("last_login").isoformat() + "Z" if current_user.get("last_login") else None,
        "created_at": current_user.get("created_at").isoformat() + "Z" if current_user.get("created_at") else None,
    }


@router.get("/me/teachers")
async def assigned_teachers(current_user=Depends(get_current_user), db: AsyncSession = Depends(db_session)):
    """List teachers explicitly allocated by administration to this student's cohort."""
    if current_user["role"] != "student":
        raise HTTPException(status_code=403, detail="This view is only available to students")
    if not is_database_available():
        raise HTTPException(status_code=503, detail="Teacher directory is unavailable")
    course_id = current_user.get("course_id")
    batch_id = current_user.get("batch_id")
    section_id = current_user.get("section_id")
    teachers = []
    rows = (
        await db.scalars(
            select(SqlUser).where(SqlUser.role == "teacher", SqlUser.is_active.is_(True)).order_by(SqlUser.name)
        )
    ).all()
    for teacher in rows:
        scopes = []
        for allocation in teacher.assignments or []:
            if allocation.get("program_id") != course_id or allocation.get("batch_id") != batch_id or allocation.get("section_id") != section_id:
                continue
            scopes.append({
                "program": allocation.get("program") or allocation.get("course"),
                "batch": allocation.get("batch"),
                "section": allocation.get("section"),
                "subjects": allocation.get("subjects") or [],
            })
        if scopes:
            teachers.append({
                "id": teacher.id,
                "name": teacher.name,
                "email": teacher.email,
                "teacher_id": teacher.teacher_id,
                "designation": teacher.designation,
                "contact_number": teacher.contact_number,
                "bio": teacher.bio,
                "avatar": teacher.avatar,
                "allocations": scopes,
            })
    return {"teachers": teachers, "cohort": {"course": current_user.get("course"), "batch": current_user.get("batch"), "section_id": section_id}}


@router.get("/me/teaching-scope")
async def teaching_scope(current_user=Depends(get_current_user), db: AsyncSession = Depends(db_session)):
    """Return the administrator-assigned teaching scope and unique student roster size."""
    if current_user["role"] != "teacher":
        raise HTTPException(status_code=403, detail="This view is only available to teachers")
    if not is_database_available():
        raise HTTPException(status_code=503, detail="Teaching scope is unavailable")
    allocations = current_user.get("assignments") or []
    program_ids = {item.get("program_id") for item in allocations if item.get("program_id")}
    batch_ids = {item.get("batch_id") for item in allocations if item.get("batch_id")}
    section_ids = {item.get("section_id") for item in allocations if item.get("section_id")}
    subject_names = {subject for item in allocations for subject in (item.get("subjects") or []) if subject}
    student_ids = set()
    rows = (
        await db.scalars(select(SqlUser).where(SqlUser.role == "student", SqlUser.is_active.is_(True)))
    ).all()
    for student in rows:
        if any(
            allocation.get("program_id") == student.course_id
            and allocation.get("batch_id") == student.batch_id
            and allocation.get("section_id") == student.section_id
            for allocation in allocations
        ):
            student_ids.add(student.id)
    return {
        "students": len(student_ids),
        "programs": len(program_ids),
        "batches": len(batch_ids),
        "sections": len(section_ids),
        "subjects": len(subject_names),
        "allocations": len(allocations),
    }


@router.patch("/profile", response_model=MessageResponse)
async def update_profile(
    body: UserUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(db_session),
):
    update_data = user_service.profile_update_fields(body, current_user["role"])

    if update_data:
        await update_user_fields(db, current_user["_id"], update_data)

    return {"message": "Profile updated successfully"}
