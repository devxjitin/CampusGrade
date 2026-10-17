"""Job queue primitives (Sprint 2, S2-01..S2-03)."""

import asyncio
import datetime

import pytest
from services import jobs
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from tests.conftest import requires_docker


def test_backoff_is_exponential_and_capped():
    assert jobs.backoff_seconds(1) == 30
    assert jobs.backoff_seconds(2) == 60
    assert jobs.backoff_seconds(3) == 120
    assert jobs.backoff_seconds(20) == jobs.BACKOFF_CAP_SECONDS


def _run_with_session(database_url, coro_factory):
    async def runner():
        url = database_url.replace("postgresql+psycopg://", "postgresql+asyncpg://")
        engine = create_async_engine(url)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with factory() as db:
                await db.execute(text("DELETE FROM jobs"))
                await db.commit()
            return await coro_factory(factory)
        finally:
            await engine.dispose()

    return asyncio.run(runner())


@requires_docker
def test_enqueue_is_transactional(database_url):
    async def scenario(factory):
        async with factory() as db:
            await jobs.enqueue(db, "demo", {"a": 1})
            await db.rollback()
        async with factory() as db:
            assert await jobs.claim_next(db, "w1") is None

    _run_with_session(database_url, scenario)


@requires_docker
def test_claim_is_exclusive_and_failures_back_off_until_dead(database_url):
    async def scenario(factory):
        async with factory() as db:
            await jobs.enqueue(db, "demo", max_attempts=2)
            await db.commit()

        async with factory() as db1, factory() as db2:
            first = await jobs.claim_next(db1, "w1")
            assert first is not None and first.attempts == 1
            assert await jobs.claim_next(db2, "w2") is None  # locked by w1, skipped
            await jobs.mark_failed(db1, first, "boom")
            await db1.commit()
            assert first.status == "failed"
            assert first.run_after > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

        async with factory() as db:
            await db.execute(text("UPDATE jobs SET run_after = now() - interval '1 second'"))
            await db.commit()
            second = await jobs.claim_next(db, "w1")
            assert second is not None and second.attempts == 2
            await jobs.mark_failed(db, second, "boom again")
            assert second.status == "dead" and second.finished_at is not None
            await jobs.retry_dead(db, second)
            assert second.status == "queued" and second.attempts == 0

    _run_with_session(database_url, scenario)


@requires_docker
def test_stale_running_job_is_requeued(database_url):
    async def scenario(factory):
        async with factory() as db:
            await jobs.enqueue(db, "demo")
            await db.commit()
        async with factory() as db:
            claimed = await jobs.claim_next(db, "dead-worker")
            claimed.locked_at = claimed.locked_at - datetime.timedelta(hours=1)
            await db.commit()
        async with factory() as db:
            assert await jobs.requeue_stale(db, datetime.timedelta(minutes=11)) == 1
            await db.commit()

    _run_with_session(database_url, scenario)


@pytest.mark.parametrize("attempts", [0, 1])
def test_backoff_never_negative(attempts):
    assert jobs.backoff_seconds(attempts) >= 30
