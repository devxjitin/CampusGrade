"""Notification emails (Sprint 4, S4-04/S4-05): enqueue from the request/worker, send from the worker.

Callers enqueue `email.notification` inside their own transaction. The user's opt-out is
checked when the job runs, so a preference change takes effect for mail that is already queued.
"""

from __future__ import annotations

from models.user_preferences import SqlUserPreference
from schemas.preferences import EMAIL_KEYS
from sqlalchemy.ext.asyncio import AsyncSession

from services import jobs

NOTIFICATION_JOB = "email.notification"


async def enqueue_notification_email(
    db: AsyncSession, user_id: str, preference_key: str, subject: str, lines: list[str], path: str | None = None
) -> None:
    assert preference_key in EMAIL_KEYS, preference_key
    await jobs.enqueue(
        db, NOTIFICATION_JOB, {"user_id": user_id, "preference_key": preference_key, "subject": subject, "lines": lines, "path": path}
    )


async def email_enabled(db: AsyncSession, user_id: str, preference_key: str) -> bool:
    row = await db.get(SqlUserPreference, str(user_id))
    return bool((row.notification_preferences or {}).get(preference_key, True)) if row else True
