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
from core.csrf import register_csrf_middleware
from core.errors import register_error_handlers
from core.logging_setup import configure_logging, set_request_id
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from models import database
from models.database import get_database_status, init_database, is_database_available
from routes_fastapi.admin import router as admin_router
from routes_fastapi.admin_settings import router as admin_settings_router
from routes_fastapi.assignments import router as assignment_router
from routes_fastapi.auth_routes import router as auth_router
from routes_fastapi.notification_routes import router as notification_router
from routes_fastapi.user_routes import router as user_router
from services.object_storage import get_private_storage

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
    yield


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
    return {
        "status": "ready",
        "app": settings.app_id,
        "database_revision": revision["current"],
        "dependencies": {"storage": "ready"},
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
