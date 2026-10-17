"""Periodic tasks run exactly once per interval across workers (Sprint 2, S2-04)."""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from worker import periodic

from tests.conftest import requires_docker


@requires_docker
def test_task_runs_once_when_two_workers_race(database_url, monkeypatch):
    calls = []

    async def slow_task() -> int:
        calls.append(1)
        await asyncio.sleep(0.3)
        return 1

    async def scenario():
        engine = create_async_engine(database_url.replace("postgresql+psycopg://", "postgresql+asyncpg://"))
        factory = async_sessionmaker(engine, expire_on_commit=False)
        monkeypatch.setattr(periodic.database, "async_session_factory", factory)
        try:
            async with factory() as db:
                await db.execute(text("DELETE FROM app_settings WHERE setting_type = 'periodic:test_once'"))
                await db.commit()
            task = periodic.PeriodicTask("test_once", 3600, slow_task)
            first_round = await asyncio.gather(periodic.run_if_due(task), periodic.run_if_due(task))
            second_round = await periodic.run_if_due(task)  # within the interval
            return first_round, second_round
        finally:
            await engine.dispose()

    first_round, second_round = asyncio.run(scenario())
    assert sorted(first_round) == [False, True]
    assert second_round is False
    assert len(calls) == 1
