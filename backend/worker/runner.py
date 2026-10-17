"""Worker loop: claim jobs, run them with a timeout, retry with backoff, stop cleanly on SIGTERM."""

from __future__ import annotations

import asyncio
import datetime
import logging
import os
import signal
import socket
import tempfile
import threading
import time
import uuid
from pathlib import Path

from config import get_settings
from core.logging_setup import configure_logging
from models import database
from models.job import Job
from services import jobs

from worker.handlers import HANDLERS
from worker.periodic import run_due_periodic

logger = logging.getLogger("CampusGrade.Worker")

JOB_TIMEOUT_SECONDS = 600
POLL_INTERVAL_SECONDS = 2.0
HEARTBEAT_FILE = Path(tempfile.gettempdir()) / "campusgrade-worker-heartbeat"
HEARTBEAT_INTERVAL_SECONDS = 10
HEARTBEAT_MAX_AGE_SECONDS = 60


def start_heartbeat(stop: threading.Event) -> threading.Thread:
    """Touch the heartbeat file from a thread so a long, loop-blocking job does not look dead.

    The compose health check fails when the file is older than HEARTBEAT_MAX_AGE_SECONDS,
    i.e. when the process hangs entirely or exits.
    """

    def beat() -> None:
        while not stop.is_set():
            try:
                HEARTBEAT_FILE.write_text(str(time.time()))
            except OSError:
                logger.warning("Could not write heartbeat file %s", HEARTBEAT_FILE)
            stop.wait(HEARTBEAT_INTERVAL_SECONDS)

    thread = threading.Thread(target=beat, name="worker-heartbeat", daemon=True)
    thread.start()
    return thread


def new_worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"


async def run_one(worker_id: str) -> bool:
    """Claim and run a single job. Returns False when nothing was due."""
    factory = database.async_session_factory
    if factory is None:
        raise RuntimeError("Database is not configured")
    async with factory() as db:
        job = await jobs.claim_next(db, worker_id)
        if job is None:
            return False
        job_id, job_type, payload = job.id, job.type, dict(job.payload or {})
        await db.commit()  # persist the claim so a crash leaves a visible running row

    error: str | None = None
    handler = HANDLERS.get(job_type)
    if handler is None:
        error = f"No handler registered for job type {job_type!r}"
    else:
        try:
            await asyncio.wait_for(handler(payload), timeout=JOB_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            error = f"Timed out after {JOB_TIMEOUT_SECONDS}s"
        except Exception as exc:  # noqa: BLE001 - any handler failure is recorded and retried
            logger.exception("Job %s (%s) failed", job_id, job_type)
            error = f"{type(exc).__name__}: {exc}"

    async with factory() as db:
        job = await db.get(Job, job_id)
        if job is not None:
            if error is None:
                await jobs.mark_succeeded(db, job)
            else:
                await jobs.mark_failed(db, job, error)
            await db.commit()
    return True


async def recover_stale() -> None:
    factory = database.async_session_factory
    if factory is None:
        return
    async with factory() as db:
        recovered = await jobs.requeue_stale(db, datetime.timedelta(seconds=JOB_TIMEOUT_SECONDS + 60))
        await db.commit()
        if recovered:
            logger.warning("Recovered %s job(s) from a dead worker", recovered)


async def main() -> None:
    settings = get_settings()
    configure_logging(level="DEBUG" if settings.app_env == "development" else "INFO")
    await database.init_database()
    if not database.is_database_available():
        raise RuntimeError("CampusGrade database is unavailable")

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows event loop
            signal.signal(sig, lambda *_: loop.call_soon_threadsafe(stop.set))

    worker_id = new_worker_id()
    heartbeat_stop = threading.Event()
    start_heartbeat(heartbeat_stop)
    logger.info("Worker %s started", worker_id)
    while not stop.is_set():
        try:
            await recover_stale()
            await run_due_periodic()
            worked = await run_one(worker_id)
        except Exception:
            logger.exception("Worker loop error")
            worked = False
        if not worked:
            try:
                await asyncio.wait_for(stop.wait(), timeout=POLL_INTERVAL_SECONDS)
            except asyncio.TimeoutError:
                pass
    heartbeat_stop.set()
    logger.info("Worker %s stopped", worker_id)
