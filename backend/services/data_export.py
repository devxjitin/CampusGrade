"""Build a session export (Sprint 5, S5-04): one ZIP with `grades.csv` and `audit_log.csv`.

Runs in the worker. CSV cells that a spreadsheet would treat as a formula are prefixed with a quote
(CSV injection), because names and audit details come from users.
"""

from __future__ import annotations

import csv
import datetime
import io
import json
import zipfile

from models.assignment import SqlAssignment, SqlAssignmentGrade
from models.sql_models import AuditLog, SqlAcademicSession, SqlUser
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

GRADE_COLUMNS = [
    "assignment_id", "assignment_title", "student_id", "student_name", "roll_no", "email", "status", "total_awarded", "total_marks",
    "is_missing", "evaluation_source", "evaluated_at", "published_at",
]
AUDIT_COLUMNS = ["timestamp", "actor_id", "action", "target_id", "ip_address", "details"]
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value) -> str:
    text = "" if value is None else value.isoformat() if isinstance(value, datetime.datetime) else str(value)
    return "'" + text if text.startswith(_FORMULA_PREFIXES) else text


def _csv(columns: list[str], rows) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(columns)
    for row in rows:
        writer.writerow([safe_cell(value) for value in row])
    return ("\ufeff" + buffer.getvalue()).encode("utf-8")  # BOM so Excel reads UTF-8 names correctly


async def build_session_export(db: AsyncSession, session_id: str) -> tuple[bytes, str]:
    """Return (zip bytes, filename). Raises LookupError for an unknown session."""
    session = await db.get(SqlAcademicSession, session_id)
    if session is None:
        raise LookupError("Academic session not found")
    grade_rows = (
        await db.execute(
            select(SqlAssignment, SqlAssignmentGrade, SqlUser)
            .join(SqlAssignmentGrade, SqlAssignmentGrade.assignment_id == SqlAssignment.id)
            .join(SqlUser, SqlUser.id == SqlAssignmentGrade.student_id)
            .where(SqlAssignment.session_id == session_id)
            .order_by(SqlAssignment.title, SqlUser.name, SqlUser.id)
        )
    ).all()
    grades = [
        [
            a.id, a.title, u.id, u.name, u.roll_no, u.email, g.status, float(g.total_awarded), float(a.total_marks), g.is_missing,
            g.evaluation_source, g.evaluated_at, g.published_at,
        ]
        for a, g, u in grade_rows
    ]
    window_start = datetime.datetime.combine(session.start_date, datetime.time.min)
    window_end = datetime.datetime.combine(session.end_date + datetime.timedelta(days=1), datetime.time.min)
    audit_rows = (
        await db.scalars(select(AuditLog).where(AuditLog.timestamp >= window_start, AuditLog.timestamp < window_end).order_by(AuditLog.timestamp, AuditLog.id))
    ).all()
    audit = [
        [row.timestamp, row.admin_id, row.action, row.target_id, row.ip_address, json.dumps(row.details, ensure_ascii=False, sort_keys=True) if row.details else ""]
        for row in audit_rows
    ]
    readme = (
        f"CampusGrade export for academic session {session.label} ({session.term}), {session.start_date} to {session.end_date}.\n"
        f"Generated {datetime.datetime.now(datetime.timezone.utc).isoformat()} (UTC).\n"
        f"grades.csv: {len(grades)} grade rows for assignments in this session.\n"
        f"audit_log.csv: {len(audit)} audit entries dated within the session.\n"
        "Contains personal data. Store and share it according to the institution's data policy.\n"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("README.txt", readme)
        archive.writestr("grades.csv", _csv(GRADE_COLUMNS, grades))
        archive.writestr("audit_log.csv", _csv(AUDIT_COLUMNS, audit))
    safe_label = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in f"{session.label}-{session.term}")
    return buffer.getvalue(), f"campusgrade-session-{safe_label}.zip"
