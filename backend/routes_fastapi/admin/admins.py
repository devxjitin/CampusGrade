"""Admin management endpoints (Sprint 5, the original implementation plan).

The three endpoints the plan names for Sprint 5's role split, all
super-admin only (`Permission.ADMIN_MANAGE`):

- `GET /admin/admins` — list every admin (`super_admin` + `program_admin`)
  and, for a program admin, which programs they're scoped to.
- `POST /admin/admins` — create a new admin account. Defaults to
  `program_admin`; a `program_admin` must be given at least one program
  scope (an admin with no scope would see nothing on every scoped list
  query, which is a bug waiting to be filed, not a usable account).
- `PUT /admin/admins/{admin_id}/scopes` — replace a program admin's scopes
  wholesale (not merge) — this is "what this admin can see now", the same
  replace-not-patch shape the plan's snippet describes.

New accounts get a random temporary password via
`admin_helpers._generate_temporary_password()` (the same one every other
admin-created account uses since Sprint 4 deleted the predictable
`firstname@last2digits` generators) and `must_change_password=True`.
"""

from __future__ import annotations

import uuid
from collections import defaultdict

from core.db import db_session
from core.policy import Permission, require
from fastapi import APIRouter, Depends, HTTPException, Request
from models.settings_store import write_audit_log
from models.sql_models import SqlAdminProgramScope, SqlCourse, SqlUser
from pydantic import BaseModel, EmailStr, Field, field_validator
from services.admin_helpers import _generate_temporary_password, _normalize_person_name, _normalize_user_email
from services.identity_service import sync_profile
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from utils.security_utils import encrypt_password

router = APIRouter(prefix="/admins", tags=["admin-admins"])


class AdminCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    role: str = Field(default="program_admin", pattern="^(super_admin|program_admin)$")
    program_ids: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("program_ids")
    @classmethod
    def _dedupe(cls, value: list[str]) -> list[str]:
        return sorted({str(item).strip() for item in value if str(item).strip()})


class AdminScopesUpdate(BaseModel):
    program_ids: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("program_ids")
    @classmethod
    def _dedupe(cls, value: list[str]) -> list[str]:
        return sorted({str(item).strip() for item in value if str(item).strip()})


def _serialize_admin(user: SqlUser, program_ids: list[str]) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
        "program_ids": program_ids,
    }


async def _validate_program_ids(db: AsyncSession, program_ids: list[str]) -> None:
    if not program_ids:
        return
    found = set((await db.scalars(select(SqlCourse.id).where(SqlCourse.id.in_(program_ids)))).all())
    missing = set(program_ids) - found
    if missing:
        raise HTTPException(status_code=404, detail=f"Unknown program id(s): {', '.join(sorted(missing))}")


@router.get("")
async def list_admins(principal=Depends(require(Permission.ADMIN_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    admins = (
        await db.scalars(select(SqlUser).where(SqlUser.role.in_(("super_admin", "program_admin"))).order_by(SqlUser.name))
    ).all()
    scope_rows = (await db.execute(select(SqlAdminProgramScope.user_id, SqlAdminProgramScope.program_id))).all()
    scopes_by_user: dict[str, list[str]] = defaultdict(list)
    for user_id, program_id in scope_rows:
        scopes_by_user[user_id].append(program_id)
    return {"admins": [_serialize_admin(admin, sorted(scopes_by_user.get(admin.id, []))) for admin in admins]}


@router.post("")
async def create_admin(
    body: AdminCreate, request: Request, principal=Depends(require(Permission.ADMIN_MANAGE)), db: AsyncSession = Depends(db_session)
):
    email = _normalize_user_email(body.email)
    name = _normalize_person_name(body.name)
    if (await db.scalars(select(SqlUser.id).where(func.lower(SqlUser.email) == email.lower()))).first():
        raise HTTPException(status_code=400, detail="Email already exists")
    if body.role == "program_admin" and not body.program_ids:
        raise HTTPException(status_code=400, detail="A program admin needs at least one program scope")
    await _validate_program_ids(db, body.program_ids)

    temporary_password = _generate_temporary_password()
    new_user = SqlUser(
        id=str(uuid.uuid4()),
        name=name,
        email=email,
        password=encrypt_password(temporary_password),
        role=body.role,
        is_active=True,
        must_change_password=True,
        login_attempts=0,
        created_by=principal.user_id,
    )
    db.add(new_user)
    await sync_profile(db, new_user)
    # SqlAdminProgramScope intentionally has no ORM relationship to SqlUser.
    # Flush the account/profile first so PostgreSQL can satisfy the scope FK.
    await db.flush()
    if body.role == "program_admin":
        for program_id in body.program_ids:
            db.add(SqlAdminProgramScope(user_id=new_user.id, program_id=program_id))
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Duplicate admin data is not allowed") from exc

    await write_audit_log(db,
        principal.user_id,
        "admin.created",
        target_id=new_user.id,
        details={"name": name, "email": email, "role": body.role, "program_ids": body.program_ids},
        ip_address=request.client.host if request.client else None,
    )
    return {
        "message": "Admin created",
        "temporary_password": temporary_password,
        "user": {"id": new_user.id, "name": name, "email": email, "role": body.role, "program_ids": body.program_ids},
    }


@router.put("/{admin_id}/scopes")
async def replace_admin_scopes(
    admin_id: str, body: AdminScopesUpdate, request: Request, principal=Depends(require(Permission.ADMIN_MANAGE)), db: AsyncSession = Depends(db_session)
):
    admin_user = (await db.scalars(select(SqlUser).where(SqlUser.id == admin_id))).first()
    if not admin_user:
        raise HTTPException(status_code=404, detail="Admin not found")
    if admin_user.role != "program_admin":
        raise HTTPException(status_code=400, detail="Scopes can only be set for a program admin")
    await _validate_program_ids(db, body.program_ids)

    await db.execute(delete(SqlAdminProgramScope).where(SqlAdminProgramScope.user_id == admin_id))
    for program_id in body.program_ids:
        db.add(SqlAdminProgramScope(user_id=admin_id, program_id=program_id))
    await db.flush()

    await write_audit_log(db,
        principal.user_id,
        "admin.scopes_replaced",
        target_id=admin_id,
        details={"program_ids": body.program_ids},
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "Scopes updated", "program_ids": body.program_ids}
