"""Integration tests with real worker processes (Sprint 2, S2-15).

They exercise what unit tests cannot: a worker killed mid-job, and two workers racing for the
same periodic task. Each worker is a separate OS process running `tests.worker_fixture`.
"""

import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tests.conftest import requires_docker

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _start_worker(database_url: str, **extra_env: str) -> subprocess.Popen:
    env = {
        **os.environ,
        "DATABASE_URL": database_url,
        "SECRET_KEY": "test-secret-of-at-least-thirty-two-characters-ok",
        "APP_ENV": "test",
        "PYTHONPATH": str(BACKEND_DIR),
        **extra_env,
    }
    return subprocess.Popen(
        [sys.executable, "-m", "tests.worker_fixture"], cwd=BACKEND_DIR, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )


def _stop(*processes: subprocess.Popen) -> None:
    for process in processes:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)


def _query(database_url: str, statement: str, params: dict | None = None):
    async def run():
        engine = create_async_engine(database_url.replace("postgresql+psycopg://", "postgresql+asyncpg://"))
        try:
            async with engine.begin() as connection:
                result = await connection.execute(text(statement), params or {})
                return result.fetchall() if result.returns_rows else None
        finally:
            await engine.dispose()

    return asyncio.run(run())


def _wait_for(predicate, timeout: float, message: str) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.25)
    pytest.fail(message)


@requires_docker
def test_job_is_retried_after_the_worker_is_killed_mid_run(database_url, tmp_path):
    _query(database_url, "DELETE FROM jobs")
    _query(database_url, "INSERT INTO jobs (type, payload, max_attempts) VALUES ('test.crash_once', '{\"name\": \"a\"}', 3)")
    env = {"FIXTURE_MARKER_DIR": str(tmp_path), "FIXTURE_NO_PERIODIC": "1"}

    first = _start_worker(database_url, **env)
    second = None
    try:
        _wait_for(lambda: (tmp_path / "started-a").exists(), 30, "first worker never started the job")
        assert _query(database_url, "SELECT status, attempts FROM jobs")[0] == ("running", 1)
        first.kill()  # no chance to mark the job failed: simulates `docker compose kill worker`
        first.wait(timeout=10)

        second = _start_worker(database_url, **env)
        _wait_for(
            lambda: _query(database_url, "SELECT status FROM jobs")[0][0] == "succeeded",
            60,
            f"job was not retried to success: {_query(database_url, 'SELECT status, attempts, last_error FROM jobs')}",
        )
    finally:
        _stop(first, *([second] if second else []))

    status, attempts, last_error = _query(database_url, "SELECT status, attempts, last_error FROM jobs")[0]
    assert (status, attempts) == ("succeeded", 2)
    assert last_error is None  # cleared by the successful retry


@requires_docker
def test_periodic_task_runs_exactly_once_with_two_workers(database_url, tmp_path):
    _query(database_url, "DELETE FROM app_settings WHERE setting_type = 'periodic:fixture_counter'")
    log = tmp_path / "periodic.log"
    env = {"FIXTURE_PERIODIC_LOG": str(log), "FIXTURE_MARKER_DIR": str(tmp_path)}

    workers = [_start_worker(database_url, **env), _start_worker(database_url, **env)]
    try:
        _wait_for(log.exists, 30, "no worker ran the periodic task")
        time.sleep(4)  # give the other worker many loop iterations to (wrongly) run it again
    finally:
        _stop(*workers)

    assert len(log.read_text().split()) == 1
