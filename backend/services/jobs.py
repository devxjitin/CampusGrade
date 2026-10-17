"""Postgres job queue primitives (Sprint 2, S2-02/S2-03).

`enqueue` only adds the row to the caller's session, so the job commits or rolls
back together with the business change that caused it (transactional enqueue).
Workers claim rows with ``FOR UPDATE SKIP LOCKED`` so several can run safely.
"""

from __future__ import annotations

import datetime

from models.job import JOB_DEAD, JOB_FAILED, JOB_QUEUED, JOB_RUNNING, JOB_SUCCEEDED, Job
from models.sql_models import utcnow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

BACKOFF_BASE_SECONDS = 30
BACKOFF_CAP_SECONDS = 3600


def backoff_seconds(attempts: int) -> int:
    """Exponential backoff after the given number of failed attempts (1 -> 30s, 2 -> 60s, ...)."""
    return min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * 2 ** max(attempts - 1, 0))


async def enqueue(
    db: AsyncSession,
    job_type: str,
    payload: dict | None = None,
    *,
    max_attempts: int = 5,
    run_after: datetime.datetime | None = None,
) -> Job:
    job = Job(type=job_type, payload=payload or {}, max_attempts=max_attempts, run_after=run_after or utcnow())
    db.add(job)
    await db.flush()
    return job


def enqueue_sync(db, job_type: str, payload: dict | None = None, *, max_attempts: int = 5) -> Job:
    """`enqueue` for helpers that still run on a sync Session (via `AsyncSession.run_sync`)."""
    job = Job(type=job_type, payload=payload or {}, max_attempts=max_attempts, run_after=utcnow())
    db.add(job)
    return job


async def claim_next(db: AsyncSession, worker_id: str, job_types: list[str] | None = None) -> Job | None:
    """Claim one due job; the caller must commit to keep the lock record."""
    query = (
        select(Job)
        .where(Job.status.in_([JOB_QUEUED, JOB_FAILED]), Job.run_after <= utcnow())
        .order_by(Job.run_after, Job.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if job_types:
        query = query.where(Job.type.in_(job_types))
    job = (await db.execute(query)).scalar_one_or_none()
    if job is None:
        return None
    job.status = JOB_RUNNING
    job.attempts += 1
    job.locked_by = worker_id
    job.locked_at = utcnow()
    await db.flush()
    return job


async def mark_succeeded(db: AsyncSession, job: Job) -> None:
    job.status = JOB_SUCCEEDED
    job.finished_at = utcnow()
    job.locked_by = None
    job.locked_at = None
    job.last_error = None
    await db.flush()


async def mark_failed(db: AsyncSession, job: Job, error: str) -> None:
    job.last_error = error[:4000]
    job.locked_by = None
    job.locked_at = None
    if job.attempts >= job.max_attempts:
        job.status = JOB_DEAD
        job.finished_at = utcnow()
    else:
        job.status = JOB_FAILED
        job.run_after = utcnow() + datetime.timedelta(seconds=backoff_seconds(job.attempts))
    await db.flush()


async def requeue_stale(db: AsyncSession, stale_after: datetime.timedelta) -> int:
    """Recover jobs whose worker died mid-run (locked longer than the per-job timeout)."""
    cutoff = utcnow() - stale_after
    rows = (
        (await db.execute(select(Job).where(Job.status == JOB_RUNNING, Job.locked_at < cutoff).with_for_update(skip_locked=True)))
        .scalars()
        .all()
    )
    for job in rows:
        await mark_failed(db, job, "Worker stopped before the job finished (lock expired)")
    return len(rows)


async def retry_dead(db: AsyncSession, job: Job) -> None:
    """Super Admin retry (S2-09): give a dead job a fresh set of attempts."""
    job.status = JOB_QUEUED
    job.attempts = 0
    job.run_after = utcnow()
    job.finished_at = None
    await db.flush()
