"""Self-service password reset (Sprint 4, S4-02/S4-03).

A reset token is `<token id>.<hmac>`: the HMAC is derived from `secret_key`, so the job payload
only needs the token id (the raw token never sits in the `jobs` table) while the database stores
just the SHA-256 of the token. Tokens are single-use and expire after `password_reset_minutes`.
"""

from __future__ import annotations

import datetime
import hashlib
import hmac
import secrets
import uuid

from config import get_settings
from models.password_reset import SqlPasswordResetToken
from models.settings_store import write_audit_log
from models.sql_models import utcnow
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from utils.security_utils import hash_password
from utils.validators import validate_password

from services import jobs
from services.identity_service import get_user_by_email, get_user_by_id, update_user_fields
from services.session_service import revoke_all_sessions

RESET_JOB = "email.password_reset"


class InvalidResetToken(Exception):
    """The token is unknown, expired or already used."""


def _raw_token(token_id: str) -> str:
    mac = hmac.new(get_settings().secret_key.encode(), f"password-reset:{token_id}".encode(), hashlib.sha256).hexdigest()
    return f"{token_id}.{mac}"


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def raw_token_for(token_id: str) -> str:
    return _raw_token(token_id)


async def request_reset(db: AsyncSession, email: str, ip_address: str | None = None) -> bool:
    """Create a token and enqueue the email. Returns whether an account matched (never sent to the caller)."""
    user = await get_user_by_email(db, email)
    if not user or user.get("is_active") is False:
        return False
    now = utcnow()
    # Only the newest link works.
    await db.execute(
        update(SqlPasswordResetToken)
        .where(SqlPasswordResetToken.user_id == user["_id"], SqlPasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
    token_id = uuid.uuid4().hex
    db.add(
        SqlPasswordResetToken(
            id=token_id,
            user_id=user["_id"],
            token_hash=_hash(_raw_token(token_id)),
            expires_at=now + datetime.timedelta(minutes=get_settings().password_reset_minutes),
        )
    )
    await jobs.enqueue(db, RESET_JOB, {"token_id": token_id})
    await write_audit_log(db, user["_id"], "user.password_reset_requested", user["_id"], None, ip_address)
    return True


async def reset_password(db: AsyncSession, raw_token: str, new_password: str, ip_address: str | None = None) -> None:
    token_id, _, _ = (raw_token or "").partition(".")
    row = (
        await db.scalars(select(SqlPasswordResetToken).where(SqlPasswordResetToken.id == token_id).with_for_update())
    ).first()
    now = utcnow()
    if (
        row is None
        or row.used_at is not None
        or row.expires_at <= now
        or not secrets.compare_digest(row.token_hash, _hash(raw_token))
    ):
        raise InvalidResetToken()
    valid, error = validate_password(new_password)
    if not valid:
        raise ValueError(error)
    user = await get_user_by_id(db, row.user_id)
    if user is None:
        raise InvalidResetToken()
    row.used_at = now
    await update_user_fields(
        db,
        row.user_id,
        {
            "password": hash_password(new_password),
            "session_version": int(user.get("session_version") or 0) + 1,
            "must_change_password": False,
        },
    )
    await revoke_all_sessions(db, row.user_id)
    await db.execute(
        update(SqlPasswordResetToken)
        .where(SqlPasswordResetToken.user_id == row.user_id, SqlPasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
    await write_audit_log(db, row.user_id, "user.password_reset_completed", row.user_id, None, ip_address)

