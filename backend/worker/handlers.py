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


@register("email.password_reset")
async def send_password_reset_email(payload: dict) -> None:
    from config import get_settings
    from models import database
    from models.password_reset import SqlPasswordResetToken
    from models.sql_models import utcnow
    from services import email_service, password_reset_service
    from services.identity_service import get_user_by_id

    factory = database.async_session_factory
    assert factory is not None
    async with factory() as db:
        token = await db.get(SqlPasswordResetToken, payload["token_id"])
        if token is None or token.used_at is not None or token.expires_at <= utcnow():
            return  # superseded, used or expired: nothing worth sending
        user = await get_user_by_id(db, token.user_id)
    if not user or user.get("is_active") is False:
        return
    settings = get_settings()
    reset_url = f"{settings.app_base_url.rstrip('/')}/reset-password?token={password_reset_service.raw_token_for(payload['token_id'])}"
    subject, text, html = email_service.password_reset_email(user["name"], reset_url, settings.password_reset_minutes)
    await email_service.send_email(user["email"], subject, text, html)


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
