import logging
import secrets

from config import get_settings
from core.db import db_session
from core.principal import Principal, require_principal
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from schemas.auth import LoginRequest, LoginResponse
from schemas.common import MessageResponse
from services.auth_service import AuthService
from services.identity_service import get_user_by_id
from services.session_service import REFRESH_DAYS, create_session, revoke_session, rotate_session
from sqlalchemy.ext.asyncio import AsyncSession
from utils.rate_limit import SlidingWindowRateLimiter
from utils.validators import sanitize_string

from routes_fastapi.deps import ACCESS_COOKIE_NAME, get_current_user, issue_token

logger = logging.getLogger("CampusGrade.Auth")
router = APIRouter(tags=["auth"])
login_limiter = SlidingWindowRateLimiter(limit=10, window_seconds=60)
auth_service = AuthService()

# Sprint 6, the original implementation plan.
ACCESS_TOKEN_MINUTES = 15
CSRF_COOKIE_NAME = "campusgrade_csrf"


def _enforce_login_rate_limit(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    allowed, retry_after = login_limiter.allow(client_ip)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please try again shortly.",
            headers={"Retry-After": str(retry_after)},
        )


def _build_user_response(user):
    return {
        "id": str(user["_id"]),
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "course": user.get("course"),
        "batch": user.get("batch"),
        "roll_no": user.get("roll_no"),
        "assignments": user.get("assignments", []),
        "avatar": user.get("avatar"),
        "must_change_password": bool(user.get("must_change_password")),
    }


def _set_refresh_cookie(response: Response, raw_token: str):
    response.set_cookie(
        key="campusgrade_refresh", value=raw_token, httponly=True,
        secure=get_settings().cookie_secure, samesite="lax", max_age=REFRESH_DAYS * 24 * 60 * 60,
        path="/",
    )


def _clear_refresh_cookie(response: Response):
    response.delete_cookie("campusgrade_refresh", path="/")


def _set_access_cookie(response: Response, access_token: str):
    """Sprint 6, the original implementation plan: `httponly`, `secure` (from
    settings), `samesite="lax"`, path `/` — unlike the refresh cookie, the
    access token has to be readable on every route, not just `/auth/...`."""
    response.set_cookie(
        key=ACCESS_COOKIE_NAME, value=access_token, httponly=True,
        secure=get_settings().cookie_secure, samesite="lax", max_age=ACCESS_TOKEN_MINUTES * 60,
        path="/",
    )


def _clear_access_cookie(response: Response):
    response.delete_cookie(ACCESS_COOKIE_NAME, path="/")


def _set_csrf_cookie(response: Response) -> str:
    """The readable half of the double-submit CSRF check (see
    `core/csrf.py`'s middleware) — deliberately **not** `httponly`, since
    the frontend has to read it and echo it back as the `X-CSRF-Token`
    header on every mutating request."""
    csrf_token = secrets.token_urlsafe(32)
    response.set_cookie(
        key=CSRF_COOKIE_NAME, value=csrf_token, httponly=False,
        secure=get_settings().cookie_secure, samesite="lax", max_age=REFRESH_DAYS * 24 * 60 * 60,
        path="/",
    )
    return csrf_token


def _clear_csrf_cookie(response: Response):
    response.delete_cookie(CSRF_COOKIE_NAME, path="/")


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request, response: Response, role: str | None = None, db: AsyncSession = Depends(db_session)):
    _enforce_login_rate_limit(request)

    identifier = sanitize_string(str(body.email), 254).lower().strip()
    password = body.password

    user = await auth_service.authenticate(identifier, password, db)
    # Sprint 5, the original implementation plan: both admin roles count as "staff"
    # for the sign-in page split, same as the single "admin" role did before.
    if role == "staff" and user["role"] not in {"teacher", "super_admin", "program_admin"}:
        raise HTTPException(status_code=403, detail="Use the student sign-in page for this account.")
    if role and role != "staff" and user["role"] != role:
        raise HTTPException(status_code=403, detail=f"Use the {user['role']} sign-in page for this account.")

    try:
        refresh_token, device_session = await create_session(db, user["_id"], request)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    token = issue_token(user["_id"], request.app.state.secret_key, user.get("session_version", 0), session_id=device_session.id)
    _set_refresh_cookie(response, refresh_token)
    _set_access_cookie(response, token)
    _set_csrf_cookie(response)
    # `token` stays in the JSON body too — Sprint 6, the original implementation plan
    # "accept both for one sprint": the not-yet-updated frontend still reads
    # it from here and sends it as an `Authorization` header, which
    # `get_bearer_token` still accepts as a fallback. Removed in Sprint 10.
    return {"message": "Login successful", "token": token, "user": _build_user_response(user), "session_id": device_session.id}


@router.post("/auth/refresh", response_model=LoginResponse)
async def refresh_session(request: Request, response: Response, db: AsyncSession = Depends(db_session)):
    rotated = await rotate_session(db, request.cookies.get("campusgrade_refresh", ""), request)
    if not rotated:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Your session has expired. Please log in again.")
    refresh_token, device_session = rotated
    user = await get_user_by_id(db, device_session.user_id)
    if not user or user.get("is_active") is False:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Your account is unavailable.")
    token = issue_token(user["_id"], request.app.state.secret_key, user.get("session_version", 0), session_id=device_session.id)
    _set_refresh_cookie(response, refresh_token)
    _set_access_cookie(response, token)
    _set_csrf_cookie(response)
    return {"message": "Session refreshed", "token": token, "user": _build_user_response(user), "session_id": device_session.id}


@router.post("/logout", response_model=MessageResponse)
async def logout(response: Response, current_user=Depends(get_current_user), db: AsyncSession = Depends(db_session)):
    session_id = current_user.get("_session_id")
    if session_id:
        await revoke_session(db, current_user["_id"], session_id)
    _clear_refresh_cookie(response)
    _clear_access_cookie(response)
    _clear_csrf_cookie(response)
    logger.info("Device session closed: %s", current_user.get("email"))
    return {"message": "Logged out successfully"}


@router.get("/auth/me")
async def read_current_principal(principal: Principal = Depends(require_principal)):
    """Sprint 6, the original implementation plan: "returns the Principal as JSON. The
    frontend uses this instead of decoding a JWT client-side." Frozensets
    aren't JSON-serialisable, so `program_ids`/`offering_ids` go out as
    sorted lists; `"*"` (`core.principal.ALL_PROGRAMS`) means "every
    program" for a super admin, same meaning it has internally."""
    return {
        "user_id": principal.user_id,
        "role": principal.role.value,
        "status": principal.status,
        "program_ids": sorted(principal.program_ids),
        "offering_ids": sorted(principal.offering_ids),
        "must_change_password": principal.must_change_password,
    }
