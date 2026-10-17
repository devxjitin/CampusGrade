"""Dual-write for the new identity profile tables (Sprint 4, the original implementation plan).

`SqlUser`'s old columns (`name`, `contact_number`, `avatar`, `bio`,
`github_username`, `roll_no`, `course_id`, `teacher_id`, `designation`, ...)
remain the source of truth this sprint — nothing reads `user_profiles`/
`student_profiles`/`teacher_profiles` yet. This module exists so there is
exactly **one** place that writes both, per the plan ("Centralise this in
`identity/service.py::upsert_user()` so there is exactly one place to
delete later"): `sync_profile(db, user)` derives every profile-table value
from the `SqlUser` row that was just created or edited, and upserts the
matching profile row(s) alongside it, in the same (still-uncommitted)
transaction the caller is already in.

Call this once, right after `db.add(user)` (new account) or after editing
an existing `SqlUser`'s profile-ish fields — before the route's own
`await db.flush()`/commit, so a single failed transaction can't leave the
old columns and the new tables disagreeing.
"""

from __future__ import annotations

import datetime

from models.refresh_token import SqlRefreshToken
from models.sql_models import (
    SqlAdminAccess,
    SqlBatch,
    SqlStudentProfile,
    SqlTeacherProfile,
    SqlTeacherSessionAllocation,
    SqlUser,
    SqlUserProfile,
    utcnow,
)
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

# Stored admin_access.level -> number (matches core.policy.Access).
ACCESS_LEVELS = {"view": 1, "edit": 2, "full": 3}


def normalize_user(user: SqlUser | None) -> dict | None:
    """Preserve the public legacy user shape while storage is normalized."""
    if user is None:
        return None
    return {
        "_id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "course": user.course,
        "batch": user.batch,
        "course_id": user.course_id,
        "batch_id": user.batch_id,
        "section_id": user.section_id,
        "roll_no": user.roll_no,
        "assignments": user.assignments or [],
        "achievements": user.achievements or [],
        "github_repositories": user.github_repositories or [],
        "github_username": user.github_username,
        "leetcode_username": user.leetcode_username,
        "avatar": user.avatar,
        "bio": user.bio,
        "is_active": user.is_active,
        "session_version": user.session_version or 0,
        "last_login": user.last_login,
        "created_at": user.created_at,
        "created_by": user.created_by,
    }


async def get_user_by_id(db: AsyncSession, user_id: str) -> dict | None:
    return normalize_user(await db.get(SqlUser, str(user_id)))


async def get_user_by_email(db: AsyncSession, identifier: str) -> dict | None:
    normalized = str(identifier or "").strip().lower()
    row = (await db.scalars(select(SqlUser).where(func.lower(SqlUser.email) == normalized))).first()
    return normalize_user(row)


async def load_authenticated_user(db: AsyncSession, user_id: str, session_id: str | None) -> dict | None:
    """Load the account, device session, and authorization scopes once."""
    session_join = (
        and_(SqlRefreshToken.id == session_id, SqlRefreshToken.user_id == SqlUser.id)
        if session_id
        else SqlRefreshToken.id.is_(None)
    )
    rows = (
        await db.execute(
            select(
                SqlUser,
                SqlAdminAccess.resource,
                SqlAdminAccess.level,
                SqlTeacherSessionAllocation.subject_ids,
                SqlRefreshToken.id,
                SqlRefreshToken.revoked_at,
                SqlRefreshToken.expires_at,
            )
            .outerjoin(SqlAdminAccess, SqlAdminAccess.user_id == SqlUser.id)
            .outerjoin(SqlTeacherSessionAllocation, SqlTeacherSessionAllocation.teacher_id == SqlUser.id)
            .outerjoin(SqlRefreshToken, session_join)
            .where(SqlUser.id == str(user_id))
        )
    ).all()
    if not rows:
        return None
    user = normalize_user(rows[0][0])
    assert user is not None
    user["_access"] = {row[1]: ACCESS_LEVELS.get(row[2], 0) for row in rows if row[1]}
    user["_offering_ids"] = frozenset(subject_id for row in rows for subject_id in (row[3] or []))
    if session_id:
        refresh_id, revoked_at, expires_at = rows[0][4], rows[0][5], rows[0][6]
        user["_session_active"] = bool(
            refresh_id and revoked_at is None and expires_at is not None and expires_at > datetime.datetime.utcnow()
        )
    else:
        user["_session_active"] = True
    return user


async def update_user_fields(db: AsyncSession, user_id: str, fields: dict) -> bool:
    row = await db.get(SqlUser, str(user_id))
    if row is None:
        return False
    for key, value in fields.items():
        if hasattr(row, key):
            setattr(row, key, value)
    await sync_profile(db, row)
    await db.flush()
    return True


async def sync_profile(db: AsyncSession, user: SqlUser) -> None:
    """Upsert `user_profiles`, and `student_profiles`/`teacher_profiles` if
    `user.role` calls for it, from `user`'s current column values.

    Safe to call for a brand-new `SqlUser` that hasn't been flushed yet
    (SQLAlchemy's unit of work orders the `users` insert before these
    profile-table inserts by FK dependency) or for an existing one whose
    profile-relevant columns were just edited.
    """
    now = utcnow()

    profile = await db.get(SqlUserProfile, user.id)
    if profile is None:
        db.add(
            SqlUserProfile(
                user_id=user.id,
                full_name=user.name,
                phone=user.contact_number,
                avatar_key=user.avatar,
                bio=user.bio,
                github_username=user.github_username,
                created_at=now,
                updated_at=now,
            )
        )
    else:
        profile.full_name = user.name
        profile.phone = user.contact_number
        profile.avatar_key = user.avatar
        profile.bio = user.bio
        profile.github_username = user.github_username
        profile.updated_at = now

    if user.role == "student" and user.roll_no and user.course_id:
        admission_year = None
        if user.batch_id:
            batch = await db.get(SqlBatch, user.batch_id)
            if batch is not None:
                admission_year = batch.start_year
        if admission_year is None:
            admission_year = (user.created_at or now).year

        student_profile = await db.get(SqlStudentProfile, user.id)
        if student_profile is None:
            db.add(
                SqlStudentProfile(
                    user_id=user.id,
                    roll_no=user.roll_no,
                    program_id=user.course_id,
                    admission_year=admission_year,
                    enrollment_status="active",
                )
            )
        else:
            student_profile.roll_no = user.roll_no
            student_profile.program_id = user.course_id
            student_profile.admission_year = admission_year

    if user.role == "teacher":
        # Mirrors the migration's fallback for a teacher row with no
        # `teacher_id` set — see `migrations/versions/20260728_21_identity_profile_tables.py`.
        employee_code = user.teacher_id or f"T-{user.id[:8]}"
        teacher_profile = await db.get(SqlTeacherProfile, user.id)
        if teacher_profile is None:
            db.add(SqlTeacherProfile(user_id=user.id, employee_code=employee_code, designation=user.designation))
        else:
            teacher_profile.employee_code = employee_code
            teacher_profile.designation = user.designation
