import logging
from collections.abc import AsyncGenerator

from config import get_settings
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

logger = logging.getLogger("CampusGrade.SQL")


class Base(DeclarativeBase):
    """Base class shared by every SQLAlchemy model."""


DATABASE_URL = get_settings().database_url.strip()

async_engine = None
async_session_factory = None
database_available = False


def _async_database_url(url: str) -> str:
    """Return the SQLAlchemy async-driver equivalent of a configured URL."""
    if url.startswith("postgresql+psycopg://"):
        return "postgresql+asyncpg://" + url.removeprefix("postgresql+psycopg://")
    if url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + url.removeprefix("postgresql://")
    if url.startswith("sqlite://"):
        return "sqlite+aiosqlite://" + url.removeprefix("sqlite://")
    return url


if DATABASE_URL:
    try:
        # Tests re-import this module for every test, each with its own event loop, while
        # modules like core.db keep the first engine. Pooled asyncpg connections are bound
        # to the loop that opened them, so tests use a pool-less engine (APP_ENV=test).
        _pool_options = {"poolclass": NullPool} if get_settings().app_env == "test" else {"pool_pre_ping": True}
        async_engine = create_async_engine(_async_database_url(DATABASE_URL), **_pool_options)
        async_session_factory = async_sessionmaker(
            async_engine,
            class_=AsyncSession,
            autoflush=False,
            expire_on_commit=False,
        )
    except (ImportError, ModuleNotFoundError) as exc:
        logger.warning("Database driver is unavailable: %s", exc)


async def init_database() -> None:
    """Initialize and validate PostgreSQL connection without crashing app startup."""
    global database_available
    if async_engine is None:
        logger.warning("DATABASE_URL not set; PostgreSQL features are disabled")
        database_available = False
        return
    try:
        async with async_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        database_available = True
        logger.info("Connected to PostgreSQL successfully")
    except Exception as exc:
        database_available = False
        logger.error("PostgreSQL connection failed: %s", exc)


def is_database_available() -> bool:
    return database_available and async_engine is not None and async_session_factory is not None


def get_database_status() -> str:
    return "connected" if is_database_available() else "disconnected"


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield a transactional async database session for new FastAPI routes."""
    if async_session_factory is None:
        raise RuntimeError(
            "Async database support is unavailable; install the configured async driver."
        )
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
