import asyncio
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from config import get_settings
from config import is_weak_secret as _is_weak_secret  # noqa: F401 - re-exported for backend/tests/test_security.py
from core import redis as redis_core
from core.csrf import register_csrf_middleware
from core.errors import register_error_handlers
from core.logging_setup import configure_logging, set_request_id
from core.redis import close_redis, init_redis
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from models import database
from models.database import async_session_factory, get_database_status, init_database, is_database_available
from models.settings_store import write_audit_log
from routes_fastapi.admin import router as admin_router
from routes_fastapi.admin_settings import router as admin_settings_router
from routes_fastapi.assignment_routes import publish_ready_assignment_results
from routes_fastapi.assignment_routes import router as assignment_router
from routes_fastapi.auth_routes import router as auth_router
from routes_fastapi.notification_routes import router as notification_router
from routes_fastapi.user_routes import router as user_router
from services.object_storage import get_private_storage
from services.session_rollover import notify_admins_if_rollover_due
from services.session_service import purge_stale_sessions

settings = get_settings()
APP_NAME = "CampusGrade"
configure_logging(level="DEBUG" if settings.app_env == "development" else "INFO")
logger = logging.getLogger(APP_NAME)


async def schema_revision_status() -> dict:
    config = Config(os.path.join(os.path.dirname(__file__), "alembic.ini"))
    config.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "migrations"))
    head = ScriptDirectory.from_config(config).get_current_head()
    current = None
    if database.async_engine is not None:
        async with database.async_engine.connect() as connection:
            current = await connection.run_sync(
                lambda sync_connection: MigrationContext.configure(sync_connection).get_current_revision()
            )
    return {"ready": bool(current and current == head), "current": current, "head": head}


async def initialize_database() -> None:
    await init_database()
    if not is_database_available():
        raise RuntimeError("CampusGrade database is unavailable")
    status = await schema_revision_status()
    if not status["ready"]:
        raise RuntimeError(f"Database migration mismatch: current={status['current']} head={status['head']}")


def verify_private_storage() -> None:
    storage = get_private_storage("canvas-grade-health")
    key = f".readiness/{uuid.uuid4()}"
    marker = uuid.uuid4().bytes
    storage.put_bytes(key, marker, "application/octet-stream")
    try:
        if storage.get_bytes(key) != marker:
            raise RuntimeError("Private storage readiness check failed")
    finally:
        storage.delete(key)


@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    await initialize_database()
    verify_private_storage()
    app_instance.state.private_storage_ready = True
    await init_redis()
    stop = asyncio.Event()

    async def publish_assignments() -> int:
        if async_session_factory is None:
            return 0
        async with async_session_factory() as db:
            released = await db.run_sync(publish_ready_assignment_results)
            for assignment in released:
                await write_audit_log(db, "system", "assignment.results_published_automatically", assignment.id, {"release_mode": assignment.result_release_mode})
            await db.commit()
            return len(released)

    async def check_rollover_due() -> int:
        # Never flips the current session on its own — see
        # PLAN_ACADEMIC_SESSIONS_AND_BATCHES.md Part 4 Step 4. This only
        # nudges admins (once, via SqlNotification's dedupe_key) that the
        # current session's end_date has passed and Session rollover is
        # waiting for a confirm click.
        if async_session_factory is None:
            return 0
        async with async_session_factory() as db:
            count = await db.run_sync(notify_admins_if_rollover_due)
            await db.commit()
            return count

    async def scheduler():
        cleanup_tick = 0
        while not stop.is_set():
            try:
                released = await publish_assignments()
                if released:
                    logger.info("Published %s assignment result set(s)", released)
                if cleanup_tick == 0:
                    if async_session_factory is not None:
                        async with async_session_factory() as db:
                            await purge_stale_sessions(db)
                            await db.commit()
                    notified = await check_rollover_due()
                    if notified:
                        logger.info("Notified %s admin(s) that session rollover is due", notified)
                cleanup_tick = (cleanup_tick + 1) % 240
            except Exception:
                logger.exception("CampusGrade scheduled processing failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=15)
            except asyncio.TimeoutError:
                pass

    task = asyncio.create_task(scheduler())
    try:
        yield
    finally:
        stop.set()
        await task
        await close_redis()


app = FastAPI(title="CampusGrade API", version="1.0.0", lifespan=lifespan)
app.state.secret_key = settings.secret_key
app.state.app_id = settings.app_id
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
register_error_handlers(app)
register_csrf_middleware(app)


@app.middleware("http")
async def security_and_request_context(request: Request, call_next):
    supplied = request.headers.get("X-Request-ID", "")
    request.state.request_id = supplied if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", supplied) else str(uuid.uuid4())
    set_request_id(request.state.request_id)
    response = await call_next(request)
    response.headers.update({"X-Request-ID": request.state.request_id, "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin", "Cache-Control": "no-store"})
    return response


@app.get("/health")
async def health():
    return {"status": "healthy", "app": settings.app_id, "database": get_database_status(), "version": "1.0.0"}


@app.get("/ready")
async def ready():
    if not is_database_available():
        raise HTTPException(503, "Database is unavailable")
    revision = await schema_revision_status()
    if not revision["ready"]:
        raise HTTPException(503, {"database_revision": revision})
    if not getattr(app.state, "private_storage_ready", False):
        raise HTTPException(503, "Private storage is unavailable")
    if settings.redis_required:
        if redis_core.redis_pool is None:
            raise HTTPException(503, "Redis is unavailable")
        await redis_core.redis_pool.ping()
    return {
        "status": "ready",
        "app": settings.app_id,
        "database_revision": revision["current"],
        "dependencies": {"storage": "ready", "redis": "connected" if redis_core.redis_pool else "optional"},
    }


app.include_router(auth_router)
app.include_router(admin_settings_router)
app.include_router(user_router)
app.include_router(admin_router, prefix="/admin")
app.include_router(notification_router)
app.include_router(assignment_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=settings.port, reload=settings.fastapi_reload)
