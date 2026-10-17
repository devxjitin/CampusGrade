"""Admin management endpoints, all Super Admin only (`Permission.ADMIN_MANAGE`):

- `GET /admin/admins` — list every admin (`super_admin` + `admin`) and, for an `admin`,
  the access they were given.
- `POST /admin/admins` — create an admin account. An `admin` is given an access level per
  resource (batches, sections, subjects, users, assignments, audit log): "view" reads,
  "edit" also creates and changes, "full" also deletes. At least one resource is required
  (an admin with no access could not open anything).
- `PUT /admin/admins/{admin_id}/access` — replace an admin's access wholesale (not merge).

Admins are not limited to particular programs; what they can do is exactly this access.
New accounts have no password: an admin signs in with their email address.
"""

from __future__ import annotations

import uuid
from collections import defaultdict

from core.db import db_session
from core.policy import VIEW_ONLY_RESOURCES, Permission, Resource, require
from fastapi import APIRouter, Depends, HTTPException, Request
from models.settings_store import write_audit_log
from models.sql_models import SqlAdminAccess, SqlUser
from pydantic import BaseModel, EmailStr, Field, field_validator
from services.admin_helpers import _normalize_person_name, _normalize_user_email
from services.identity_service import sync_profile
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/admins", tags=["admin-admins"])

_LEVELS = ("view", "edit", "full")
_RESOURCES = {resource.value: resource for resource in Resource}


def _clean_access(value: dict[str, str]) -> dict[str, str]:
    cleaned: dict[str, str] = {}
    for resource, level in value.items():
        key, grant = str(resource).strip(), str(level).strip().lower()
        if key not in _RESOURCES:
            raise ValueError(f"Unknown resource: {key}")
        if grant not in _LEVELS:
            raise ValueError(f"Access level for {key} must be one of: {', '.join(_LEVELS)}")
        if _RESOURCES[key] in VIEW_ONLY_RESOURCES and grant != "view":
            raise ValueError(f"{key.replace('_', ' ').capitalize()} is read only; only view access can be given")
        cleaned[key] = grant
    return cleaned


class AdminCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    role: str = Field(default="admin", pattern="^(super_admin|admin)$")
    access: dict[str, str] = Field(default_factory=dict, max_length=20)

    @field_validator("access")
    @classmethod
    def _valid_access(cls, value: dict[str, str]) -> dict[str, str]:
        return _clean_access(value)


class AdminAccessUpdate(BaseModel):
    access: dict[str, str] = Field(default_factory=dict, max_length=20)

    @field_validator("access")
    @classmethod
    def _valid_access(cls, value: dict[str, str]) -> dict[str, str]:
        return _clean_access(value)


def _serialize_admin(user: SqlUser, access: dict[str, str]) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
        "access": access,
    }


@router.get("")
async def list_admins(principal=Depends(require(Permission.ADMIN_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    admins = (await db.scalars(select(SqlUser).where(SqlUser.role.in_(("super_admin", "admin"))).order_by(SqlUser.name))).all()
    rows = (await db.execute(select(SqlAdminAccess.user_id, SqlAdminAccess.resource, SqlAdminAccess.level))).all()
    access_by_user: dict[str, dict[str, str]] = defaultdict(dict)
    for user_id, resource, level in rows:
        access_by_user[user_id][resource] = level
    return {"admins": [_serialize_admin(admin, access_by_user.get(admin.id, {})) for admin in admins]}


@router.post("")
async def create_admin(
    body: AdminCreate, request: Request, principal=Depends(require(Permission.ADMIN_MANAGE)), db: AsyncSession = Depends(db_session)
):
    email = _normalize_user_email(body.email)
    name = _normalize_person_name(body.name)
    if (await db.scalars(select(SqlUser.id).where(func.lower(SqlUser.email) == email.lower()))).first():
        raise HTTPException(status_code=400, detail="Email already exists")
    if body.role == "admin" and not body.access:
        raise HTTPException(status_code=400, detail="An admin needs access to at least one area")

    new_user = SqlUser(
        id=str(uuid.uuid4()),
        name=name,
        email=email,
        role=body.role,
        is_active=True,
        created_by=principal.user_id,
    )
    db.add(new_user)
    await sync_profile(db, new_user)
    # SqlAdminAccess intentionally has no ORM relationship to SqlUser.
    # Flush the account/profile first so PostgreSQL can satisfy the access FK.
    await db.flush()
    granted = body.access if body.role == "admin" else {}
    for resource, level in granted.items():
        db.add(SqlAdminAccess(user_id=new_user.id, resource=resource, level=level))
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Duplicate admin data is not allowed") from exc

    await write_audit_log(db,
        principal.user_id,
        "admin.created",
        target_id=new_user.id,
        details={"name": name, "email": email, "role": body.role, "access": granted},
        ip_address=request.client.host if request.client else None,
    )
    return {
        "message": "Admin created",
        "user": {"id": new_user.id, "name": name, "email": email, "role": body.role, "access": granted},
    }


@router.put("/{admin_id}/access")
async def replace_admin_access(
    admin_id: str, body: AdminAccessUpdate, request: Request, principal=Depends(require(Permission.ADMIN_MANAGE)), db: AsyncSession = Depends(db_session)
):
    admin_user = (await db.scalars(select(SqlUser).where(SqlUser.id == admin_id))).first()
    if not admin_user:
        raise HTTPException(status_code=404, detail="Admin not found")
    if admin_user.role != "admin":
        raise HTTPException(status_code=400, detail="Access can only be set for an admin; a Super Admin always has full access")
    if not body.access:
        raise HTTPException(status_code=400, detail="An admin needs access to at least one area")

    await db.execute(delete(SqlAdminAccess).where(SqlAdminAccess.user_id == admin_id))
    for resource, level in body.access.items():
        db.add(SqlAdminAccess(user_id=admin_id, resource=resource, level=level))
    # Access is read from the database on every request, so the change applies immediately.
    await db.flush()

    await write_audit_log(db,
        principal.user_id,
        "admin.access_replaced",
        target_id=admin_id,
        details={"access": body.access},
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "Access updated", "access": body.access}
