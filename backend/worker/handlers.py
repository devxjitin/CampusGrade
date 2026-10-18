"""Job handler registry. Handlers take the job payload and raise to signal failure."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

Handler = Callable[[dict], Awaitable[None]]

HANDLERS: dict[str, Handler] = {}


def register(job_type: str) -> Callable[[Handler], Handler]:
    def decorator(func: Handler) -> Handler:
        HANDLERS[job_type] = func
        return func

    return decorator


@register("repository.analyze")
async def analyze_repository(payload: dict) -> None:
    from services.github_repository_service import analyze_repository_version

    await analyze_repository_version(payload["version_id"])


@register("repository.extract_final")
async def extract_final_repository(payload: dict) -> None:
    from services.github_repository_service import extract_final_snapshot

    await extract_final_snapshot(payload["submission_id"])


@register("email.notification")
async def send_notification_email(payload: dict) -> None:
    from config import get_settings
    from models import database
    from services import email_service
    from services.identity_service import get_user_by_id
    from services.notification_email import email_enabled

    factory = database.async_session_factory
    assert factory is not None
    async with factory() as db:
        user = await get_user_by_id(db, payload["user_id"])
        if not user or user.get("is_active") is False or not user.get("email"):
            return
        if not await email_enabled(db, payload["user_id"], payload["preference_key"]):
            return
    path = payload.get("path")
    url = f"{get_settings().app_base_url.rstrip('/')}{path}" if path else None
    subject, text, html = email_service.render_email(
        payload["subject"], [f"Hi {user['name']},", *payload["lines"]], action_label="Open in CampusGrade", action_url=url
    )
    await email_service.send_email(user["email"], subject, text, html)


@register("export.session")
async def build_session_export_job(payload: dict) -> None:
    """Build the ZIP, store it privately and mark the export ready (or failed after the last retry)."""
    from models import database
    from models.data_export import EXPORT_FAILED, EXPORT_READY, SqlDataExport
    from models.sql_models import utcnow
    from services.data_export import build_session_export
    from services.object_storage import get_private_storage

    factory = database.async_session_factory
    assert factory is not None
    async with factory() as db:
        row = await db.get(SqlDataExport, payload["export_id"])
        if row is None or row.status == EXPORT_READY:
            return
        try:
            data, filename = await build_session_export(db, row.session_id)
            key = f"{row.id}.zip"
            await get_private_storage("exports").aput_bytes(key, data, "application/zip")
        except LookupError as exc:  # the session was deleted: retrying cannot help
            row.status, row.error, row.finished_at = EXPORT_FAILED, str(exc), utcnow()
            await db.commit()
            return
        row.status, row.object_key, row.filename, row.size_bytes, row.error, row.finished_at = EXPORT_READY, key, filename, len(data), None, utcnow()
        await db.commit()
