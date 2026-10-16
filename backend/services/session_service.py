"""Refresh-token backed device sessions used by account settings."""

from __future__ import annotations

import datetime
import hashlib
import secrets
import uuid

from config import get_settings
from models.refresh_token import SqlRefreshToken
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

REFRESH_DAYS = 30


def _utcnow() -> datetime.datetime:
    return datetime.datetime.utcnow()


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _device_info(request) -> str:
    value = (request.headers.get("user-agent") or "Unknown device").strip()
    return value[:512] or "Unknown device"


async def create_session(db: AsyncSession, user_id: str, request) -> tuple[str, SqlRefreshToken]:
    raw = secrets.token_urlsafe(48)
    now = _utcnow()
    row = SqlRefreshToken(
        id=str(uuid.uuid4()),
        user_id=str(user_id),
        token_hash=_hash(raw),
        device_info=_device_info(request),
        ip_address=(request.client.host if request.client else None),
        expires_at=now + datetime.timedelta(days=REFRESH_DAYS),
        last_seen_at=now,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return raw, row


async def rotate_session(db: AsyncSession, raw: str, request) -> tuple[str, SqlRefreshToken] | None:
    if not raw:
        return None
    now = _utcnow()
    old = (await db.scalars(select(SqlRefreshToken).where(SqlRefreshToken.token_hash == _hash(raw)).with_for_update())).first()
    if not old or old.revoked_at or old.expires_at <= now:
        return None
    old.revoked_at = now
    replacement_raw = secrets.token_urlsafe(48)
    replacement = SqlRefreshToken(
        id=str(uuid.uuid4()),
        user_id=old.user_id,
        token_hash=_hash(replacement_raw),
        device_info=_device_info(request),
        ip_address=(request.client.host if request.client else None),
        expires_at=now + datetime.timedelta(days=REFRESH_DAYS),
        last_seen_at=now,
    )
    db.add(replacement)
    await db.flush()
    await db.refresh(replacement)
    return replacement_raw, replacement


async def list_sessions(db: AsyncSession, user_id: str, current_session_id: str | None) -> list[dict]:
    now = _utcnow()
    rows = (
        await db.scalars(
            select(SqlRefreshToken)
            .where(
                SqlRefreshToken.user_id == str(user_id),
                SqlRefreshToken.revoked_at.is_(None),
                SqlRefreshToken.expires_at > now,
            )
            .order_by(SqlRefreshToken.last_seen_at.desc(), SqlRefreshToken.created_at.desc())
        )
    ).all()
    return [
        {
            "id": row.id,
            "device_info": row.device_info or "Unknown device",
            "ip_address": row.ip_address,
            "created_at": row.created_at,
            "last_seen_at": row.last_seen_at,
            "expires_at": row.expires_at,
            "current": row.id == current_session_id,
        }
        for row in rows
    ]


async def revoke_session(db: AsyncSession, user_id: str, session_id: str) -> bool:
    row = (
        await db.scalars(
            select(SqlRefreshToken)
            .where(
                SqlRefreshToken.id == str(session_id),
                SqlRefreshToken.user_id == str(user_id),
                SqlRefreshToken.revoked_at.is_(None),
            )
            .with_for_update()
        )
    ).first()
    if not row:
        return False
    row.revoked_at = _utcnow()
    await db.flush()
    return True


async def revoke_other_sessions(db: AsyncSession, user_id: str, current_session_id: str | None = None) -> int:
    conditions = [SqlRefreshToken.user_id == str(user_id), SqlRefreshToken.revoked_at.is_(None)]
    if current_session_id:
        conditions.append(SqlRefreshToken.id != str(current_session_id))
    result = await db.execute(update(SqlRefreshToken).where(*conditions).values(revoked_at=_utcnow()))
    return int(result.rowcount or 0)


async def revoke_all_sessions(db: AsyncSession, user_id: str) -> int:
    return await revoke_other_sessions(db, user_id, None)


async def purge_stale_sessions(db: AsyncSession) -> int:
    """Delete expired sessions and old revocation tombstones."""
    now = _utcnow()
    retention_days = max(1, get_settings().revoked_session_retention_days)
    revoked_cutoff = now - datetime.timedelta(days=retention_days)
    result = await db.execute(
        delete(SqlRefreshToken).where(
            or_(
                SqlRefreshToken.expires_at <= now,
                SqlRefreshToken.revoked_at <= revoked_cutoff,
            )
        )
    )
    return int(result.rowcount or 0)
