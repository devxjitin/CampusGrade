import datetime
import uuid
from enum import Enum

import jwt
from config import get_settings
from core.db import db_session
from fastapi import Depends, HTTPException, Request
from services.identity_service import load_authenticated_user
from sqlalchemy.ext.asyncio import AsyncSession


def _session_version(value) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


ACCESS_COOKIE_NAME = "campusgrade_access"


def get_bearer_token(request: Request):
    """Read the access token from the httpOnly `campusgrade_access` cookie, else the `Authorization` header (non-browser API clients)."""
    cookie_token = request.cookies.get(ACCESS_COOKIE_NAME)
    if cookie_token:
        return cookie_token

    auth_header = request.headers.get("Authorization", "")
    parts = auth_header.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    raise HTTPException(status_code=401, detail="Authentication token is missing")


async def get_current_user(
    request: Request,
    token: str = Depends(get_bearer_token),
    db: AsyncSession = Depends(db_session),
):
    try:
        app_id = request.app.state.app_id
        payload = jwt.decode(token, request.app.state.secret_key, algorithms=["HS256"], issuer=app_id, audience=app_id)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token has expired. Please log in again.") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Token is invalid") from exc

    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    session_id = payload.get("sid")
    user = await load_authenticated_user(db, user_id, str(session_id) if session_id else None)
    if not user:
        raise HTTPException(status_code=401, detail="User not found - token invalid")

    if _session_version(payload.get("session_version")) != _session_version(user.get("session_version")):
        raise HTTPException(status_code=401, detail="Your session is no longer valid. Please log in again.")

    if user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Your account has been suspended. Contact administration.")

    if user.get("must_change_password") and request.url.path not in {
        "/change-password",
        "/logout",
        "/auth/refresh",
    }:
        raise HTTPException(
            status_code=403,
            detail="You must change your temporary password before continuing.",
        )

    # Tokens issued before device-session support remain valid only until they
    # expire. New tokens are bound to a refresh-token session and can be
    # revoked immediately from Settings.
    if session_id and not user.get("_session_active"):
        raise HTTPException(status_code=401, detail="This device session has been revoked. Please log in again.")
    user["_session_id"] = str(session_id) if session_id else None
    return user


def require_roles(*roles):
    def dependency(current_user=Depends(get_current_user)):
        if current_user.get("role") not in roles:
            raise HTTPException(status_code=403, detail=f"Access denied. Required role(s): {', '.join(roles)}")
        return current_user

    return dependency


class Permission(str, Enum):
    MANAGE_USERS = "manage_users"
    CREATE_ASSIGNMENT = "create_assignment"
    GRADE_ASSIGNMENT = "grade_assignment"
    VIEW_ASSIGNMENT_REPORTS = "view_assignment_reports"


ROLE_PERMISSIONS = {
    # Sprint 5, the original implementation plan: "admin" split into "super_admin"/
    # "admin". This legacy `Permission`/`require_permission` pair has
    # no real caller left (confirmed by grep in Sprint 3 — every actual route
    # uses `require_roles`, now `core.policy.require`) but is kept
    # functionally in sync rather than left to silently drift.
    "super_admin": set(Permission),
    "admin": set(Permission),
    "teacher": {Permission.CREATE_ASSIGNMENT, Permission.GRADE_ASSIGNMENT, Permission.VIEW_ASSIGNMENT_REPORTS},
    "student": set(),
}

def require_permission(permission: Permission):
    def dependency(user=Depends(get_current_user)):
        if permission not in ROLE_PERMISSIONS.get(user.get("role"), set()):
            raise HTTPException(status_code=403, detail="Permission denied")
        return user

    return dependency

def issue_token(user_id: str, secret_key: str, session_version: int = 0, expires_minutes: int = 15, token_type: str = "access", session_id: str | None = None):
    # Previously read APP_ID via its own independent environment lookup, separate
    # from app.py's app.state.app_id (which, before Sprint 1, was hardcoded
    # and ignored the APP_ID env var entirely). Both now resolve through the
    # same Settings object, closing that latent inconsistency.
    app_id = get_settings().app_id
    return jwt.encode(
        {
            "user_id": str(user_id),
            "iss": app_id,
            "aud": app_id,
            "session_version": _session_version(session_version),
            "jti": str(uuid.uuid4()), "typ": token_type, "sid": session_id,
            "iat": datetime.datetime.now(datetime.timezone.utc),
            "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=expires_minutes),
        },
        secret_key,
        algorithm="HS256",
    )
