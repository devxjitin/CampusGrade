"""Periodic tasks (Sprint 2, S2-04).

Every worker calls `run_due_periodic()` on each loop. A Postgres transaction-level
advisory lock plus a `last_run` marker in `app_settings` make each task run once per
interval across any number of workers: the lock holder re-checks `last_run` under the
lock, and everyone else skips immediately.
"""

from __future__ import annotations

import datetime
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from config import get_settings
from models import database
from models.settings_store import write_audit_log
from models.sql_models import AppSetting, utcnow
from sqlalchemy import select, text

logger = logging.getLogger("CampusGrade.Periodic")


@dataclass(frozen=True)
class PeriodicTask:
    name: str
    interval_seconds: int
    func: Callable[[], Awaitable[int]]


async def publish_results() -> int:
    # Imported lazily: assignment_routes is large and the worker only needs it here.
    from routes_fastapi.assignment_routes import publish_ready_assignment_results

    async with database.async_session_factory() as db:
        released = await publish_ready_assignment_results(db)
        for assignment in released:
            await write_audit_log(
                db, "system", "assignment.results_published_automatically", assignment.id, {"release_mode": assignment.result_release_mode}
            )
        await db.commit()
    if released:
        logger.info("Published %s assignment result set(s)", len(released))
    return len(released)


async def purge_sessions() -> int:
    from services.session_service import purge_stale_sessions

    async with database.async_session_factory() as db:
        purged = await purge_stale_sessions(db)
        await db.commit()
    return purged or 0


async def rollover_notice() -> int:
    # Never flips the current session on its own; only nudges admins (deduplicated by
    # SqlNotification.dedupe_key) that the current session's end date has passed.
    from services.session_rollover import notify_admins_if_rollover_due

    async with database.async_session_factory() as db:
        count = await db.run_sync(notify_admins_if_rollover_due)
        await db.commit()
    if count:
        logger.info("Notified %s admin(s) that session rollover is due", count)
    return count


async def sync_repositories() -> int:
    from services.github_repository_service import sync_due_repositories

    return await sync_due_repositories()


async def purge_rate_limits() -> int:
    from services.rate_limiter import purge_expired

    return await purge_expired()


def periodic_tasks() -> list[PeriodicTask]:
    sync_interval = max(30, get_settings().repository_sync_interval_seconds // 4)
    return [
        PeriodicTask("publish_results", 15, publish_results),
        PeriodicTask("purge_sessions", 3600, purge_sessions),
        PeriodicTask("rollover_notice", 3600, rollover_notice),
        PeriodicTask("purge_rate_limits", 3600, purge_rate_limits),
        PeriodicTask("sync_repositories", sync_interval, sync_repositories),
    ]


async def run_if_due(task: PeriodicTask) -> bool:
    """Run `task` if its interval elapsed and no other worker holds it. Returns True if it ran."""
    factory = database.async_session_factory
    if factory is None:
        return False
    key = f"periodic:{task.name}"
    async with factory() as db:
        got_lock = (await db.execute(text("SELECT pg_try_advisory_xact_lock(hashtext(:k))"), {"k": key})).scalar()
        if not got_lock:
            return False
        marker = (await db.execute(select(AppSetting).where(AppSetting.setting_type == key))).scalar_one_or_none()
        now = utcnow()
        if marker is not None:
            last_run = datetime.datetime.fromisoformat(marker.payload.get("last_run", "1970-01-01T00:00:00"))
            if (now - last_run).total_seconds() < task.interval_seconds:
                return False
        try:
            await task.func()
        except Exception:
            logger.exception("Periodic task %s failed", task.name)
        # Record the attempt even on failure so a broken task retries on its normal
        # cadence instead of hammering every loop.
        if marker is None:
            db.add(AppSetting(setting_type=key, payload={"last_run": now.isoformat()}))
        else:
            marker.payload = {"last_run": now.isoformat()}
        await db.commit()
    return True


async def run_due_periodic() -> None:
    for task in periodic_tasks():
        await run_if_due(task)
