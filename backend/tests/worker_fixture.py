"""A real worker process with test-only handlers, for the kill/restart integration tests (S2-15).

Run as ``python -m tests.worker_fixture`` from ``backend/``. Behaviour is configured through
environment variables so the production worker code stays free of test hooks:

- ``FIXTURE_MARKER_DIR``: directory for marker files.
- ``FIXTURE_PERIODIC_LOG``: if set, replace the periodic tasks with one task that appends a line
  to this file (used to count how many workers ran it).
- ``FIXTURE_NO_PERIODIC=1``: run no periodic tasks at all.
"""

import asyncio
import os
from pathlib import Path

from services import jobs
from worker import periodic, runner
from worker.handlers import register

# Fast timings so a killed worker's job is recovered and retried within seconds.
runner.JOB_TIMEOUT_SECONDS = 2
runner.STALE_GRACE_SECONDS = 1
runner.POLL_INTERVAL_SECONDS = 0.2
jobs.BACKOFF_BASE_SECONDS = 1


@register("test.crash_once")
async def crash_once(payload: dict) -> None:
    """First attempt announces itself and hangs (the test kills the worker); later attempts succeed."""
    marker = Path(os.environ["FIXTURE_MARKER_DIR"]) / f"started-{payload['name']}"
    if marker.exists():
        return
    marker.write_text("started")
    await asyncio.sleep(600)


if os.environ.get("FIXTURE_NO_PERIODIC") == "1":
    periodic.periodic_tasks = lambda: []
elif os.environ.get("FIXTURE_PERIODIC_LOG"):
    log_path = Path(os.environ["FIXTURE_PERIODIC_LOG"])

    async def record_run() -> int:
        with log_path.open("a") as handle:
            handle.write(f"{os.getpid()}\n")
        return 1

    periodic.periodic_tasks = lambda: [periodic.PeriodicTask("fixture_counter", 3600, record_run)]


if __name__ == "__main__":
    asyncio.run(runner.main())
