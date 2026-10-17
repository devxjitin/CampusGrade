"""Email over SMTP (Sprint 4, S4-01). Only the worker calls `send_email`.

Templates are plain Python so a message always has a text part and an HTML part. Every
interpolated value is HTML-escaped in the HTML body.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import parseaddr
from html import escape

from config import get_settings

logger = logging.getLogger("CampusGrade.Email")


def render_email(subject: str, lines: list[str], *, action_label: str | None = None, action_url: str | None = None) -> tuple[str, str, str]:
    """Return (subject, text, html) for a short transactional message."""
    text_parts = list(lines)
    if action_url:
        text_parts += ["", f"{action_label or 'Open'}: {action_url}"]
    text_parts += ["", "-- CampusGrade"]
    paragraphs = "".join(f"<p style=\"margin:0 0 12px\">{escape(line)}</p>" for line in lines)
    button = (
        f"<p style=\"margin:20px 0\"><a href=\"{escape(action_url, quote=True)}\" style=\"background:#1d4ed8;color:#fff;padding:10px 18px;"
        f"border-radius:6px;text-decoration:none\">{escape(action_label or 'Open')}</a></p>"
        f"<p style=\"color:#6b7280;font-size:12px\">If the button does not work, copy this link: {escape(action_url)}</p>"
        if action_url
        else ""
    )
    html = (
        "<div style=\"font-family:Arial,sans-serif;font-size:15px;color:#111827;max-width:560px\">"
        f"<h2 style=\"font-size:18px\">{escape(subject)}</h2>{paragraphs}{button}"
        "<p style=\"color:#6b7280;font-size:12px\">CampusGrade</p></div>"
    )
    return subject, "\n".join(text_parts), html


def password_reset_email(name: str, reset_url: str, minutes: int) -> tuple[str, str, str]:
    return render_email(
        "Reset your CampusGrade password",
        [
            f"Hi {name},",
            "We received a request to reset your password. The link below works once and expires "
            f"in {minutes} minutes.",
            "If you did not ask for this, you can ignore this email; your password stays the same.",
        ],
        action_label="Choose a new password",
        action_url=reset_url,
    )


def _send_sync(to: str, subject: str, text: str, html: str) -> None:
    settings = get_settings()
    assert settings.smtp_host
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        if settings.smtp_starttls:
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_user and settings.smtp_password:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(message, from_addr=parseaddr(settings.smtp_from)[1] or settings.smtp_from)


async def send_email(to: str, subject: str, text: str, html: str) -> bool:
    """Send one message. Returns False (and only logs) when SMTP is not configured.

    Raises on SMTP failure so the job retries with backoff.
    """
    if not get_settings().smtp_host:
        logger.info("SMTP is not configured; email to %s (%s) not sent", to, subject)
        return False
    await asyncio.to_thread(_send_sync, to, subject, text, html)
    logger.info("Sent email to %s (%s)", to, subject)
    return True
