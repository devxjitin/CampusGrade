import logging
import secrets

from config import get_settings
from core.db import db_session
from core.principal import Principal, require_principal
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from schemas.auth import ForgotPasswordRequest, LoginRequest, LoginResponse, ResetPasswordRequest
from schemas.common import MessageResponse
from services import password_reset_service, rate_limiter
from services.auth_service import AuthService
from services.identity_service import get_user_by_id
from services.session_service import REFRESH_DAYS, create_session, revoke_session, rotate_session
from sqlalchemy.ext.asyncio import AsyncSession
from utils.validators import sanitize_string

from routes_fastapi.deps import ACCESS_COOKIE_NAME, get_current_user, issue_token

logger = logging.getLogger("CampusGrade.Auth")
router = APIRouter(tags=["auth"])
auth_service = AuthService()

# Sprint 6, the original implementation plan.
ACCESS_TOKEN_MINUTES = 15
CSRF_COOKIE_NAME = "campusgrade_csrf"


async def _enforce_rate_limit(request: Request, scope: str, limit: int, message: str):
    client_ip = request.client.host if request.client else "unknown"
    allowed, retry_after = await rate_limiter.hit(f"{scope}:{client_ip}", limit, 60)
    if not allowed:
        raise HTTPException(status_code=429, detail=message, headers={"Retry-After": str(retry_after)})


async def _enforce_login_rate_limit(request: Request):
    await _enforce_rate_limit(request, "login", 10, "Too many login attempts. Please try again shortly.")


async def _enforce_refresh_rate_limit(request: Request):
    await _enforce_rate_limit(request, "refresh", 30, "Too many session refreshes. Please try again shortly.")


async def _enforce_forgot_password_rate_limit(request: Request):
    await _enforce_rate_limit(request, "forgot-password", 5, "Too many reset requests. Please try again shortly.")


async def _enforce_reset_password_rate_limit(request: Request):
    await _enforce_rate_limit(request, "reset-password", 10, "Too many attempts. Please try again shortly.")


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
    await _enforce_login_rate_limit(request)

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


@router.post("/auth/forgot-password", response_model=MessageResponse)
async def forgot_password(body: ForgotPasswordRequest, request: Request, db: AsyncSession = Depends(db_session)):
    """Always answers 200 with the same text, so the response never reveals whether an email has an account."""
    await _enforce_forgot_password_rate_limit(request)
    email = sanitize_string(body.email, 254).lower().strip()
    client_ip = request.client.host if request.client else None
    await password_reset_service.request_reset(db, email, client_ip)
    return {"message": "If that email belongs to an account, a reset link has been sent."}


@router.post("/auth/reset-password", response_model=MessageResponse)
async def reset_password(body: ResetPasswordRequest, request: Request, db: AsyncSession = Depends(db_session)):
    await _enforce_reset_password_rate_limit(request)
    client_ip = request.client.host if request.client else None
    try:
        await password_reset_service.reset_password(db, body.token.strip(), body.new_password, client_ip)
    except password_reset_service.InvalidResetToken:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired. Request a new one.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": "Password updated. You can now sign in."}


@router.post("/auth/refresh", response_model=LoginResponse)
async def refresh_session(request: Request, response: Response, db: AsyncSession = Depends(db_session)):
    await _enforce_refresh_rate_limit(request)
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
