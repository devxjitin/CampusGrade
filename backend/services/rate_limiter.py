"""Postgres-backed rate limiter shared by every API replica (Sprint 2, S2-08).

Fixed-window counters: one atomic upsert per request. A client can burst up to twice the
limit across a window boundary, which is acceptable for login/refresh abuse protection.
Counting uses its own short transaction so a throttled or failing request still counts.
"""

from __future__ import annotations

import datetime
import time

from models import database
from sqlalchemy import text

_UPSERT = text(
    """
    INSERT INTO rate_limit_counters (key, window_id, count, expires_at)
    VALUES (:key, :window_id, 1, :expires_at)
    ON CONFLICT (key, window_id) DO UPDATE SET count = rate_limit_counters.count + 1
    RETURNING count
    """
)


async def hit(key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    """Record one event for `key`. Returns (allowed, retry_after_seconds)."""
    factory = database.async_session_factory
    if factory is None:
        return True, 0  # no database configured (unit tests); nothing to share
    now = time.time()
    window_id = int(now // window_seconds)
    window_end = (window_id + 1) * window_seconds
    expires_at = datetime.datetime.fromtimestamp(window_end, datetime.timezone.utc).replace(tzinfo=None)
    async with factory() as db:
        count = (await db.execute(_UPSERT, {"key": key[:200], "window_id": window_id, "expires_at": expires_at})).scalar_one()
        await db.commit()
    if count > limit:
        return False, max(1, int(window_end - now))
    return True, 0


async def purge_expired() -> int:
    factory = database.async_session_factory
    if factory is None:
        return 0
    cutoff = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(hours=1)
    async with factory() as db:
        result = await db.execute(text("DELETE FROM rate_limit_counters WHERE expires_at < :cutoff"), {"cutoff": cutoff})
        await db.commit()
    return result.rowcount or 0
