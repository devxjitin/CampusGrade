import datetime
import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.assignment import SqlAssignment
from models.sql_models import AuditLog, SqlUser

logger = logging.getLogger("CampusGrade.SettingsStore")


async def write_audit_log(db: AsyncSession, admin_id, action, target_id=None, details=None, ip_address=None):
    db.add(
        AuditLog(
            admin_id=str(admin_id),
            action=action,
            target_id=str(target_id) if target_id else None,
            details=details,
            ip_address=ip_address,
            timestamp=datetime.datetime.utcnow(),
        )
    )
    await db.flush()


async def get_audit_logs(db: AsyncSession, page, per_page, action=None, actor_id=None, target_id=None, from_at=None, to_at=None):
    page = max(1, int(page))
    per_page = min(100, max(10, int(per_page)))
    skip = (page - 1) * per_page

    conditions = []
    if action:
        conditions.append(AuditLog.action.ilike(f"%{str(action).strip()}%"))
    if actor_id:
        conditions.append(AuditLog.admin_id == str(actor_id))
    if target_id:
        conditions.append(AuditLog.target_id == str(target_id))
    if from_at:
        conditions.append(AuditLog.timestamp >= from_at)
    if to_at:
        conditions.append(AuditLog.timestamp <= to_at)
    total = int((await db.scalar(select(func.count()).select_from(AuditLog).where(*conditions))) or 0)
    rows = (await db.scalars(select(AuditLog).where(*conditions).order_by(AuditLog.timestamp.desc()).offset(skip).limit(per_page))).all()
    actor_ids = {row.admin_id for row in rows if row.admin_id and row.admin_id != "system"}
    for row in rows:
        details = row.details if isinstance(row.details, dict) else {}
        for key in ("student_id", "previous_teacher", "teacher_id"):
            if details.get(key):
                actor_ids.add(str(details[key]))
    user_rows = (await db.scalars(select(SqlUser).where(SqlUser.id.in_(actor_ids or [""])))).all()
    users = {user.id: {"id": user.id, "name": user.name, "email": user.email, "role": user.role} for user in user_rows}

    assignment_ids = set()
    for row in rows:
        details = row.details if isinstance(row.details, dict) else {}
        if row.action.startswith("assignment.") and row.target_id:
            assignment_ids.add(row.target_id)
        if details.get("assignment_id"):
            assignment_ids.add(str(details["assignment_id"]))
    assignment_rows = (await db.scalars(select(SqlAssignment).where(SqlAssignment.id.in_(assignment_ids or [""])))).all()
    assignment_names = {item.id: item.title for item in assignment_rows}

    logs = []
    for row in rows:
        details = row.details if isinstance(row.details, dict) else {}
        actor = users.get(row.admin_id) or _audit_actor_fallback(row.admin_id)
        presentation = _present_audit_event(row.action, details, row.target_id, actor, users, assignment_names)
        logs.append(
            {
                "_id": str(row.id),
                "admin_id": row.admin_id,
                "actor_id": row.admin_id,
                "actor": actor,
                "action": row.action,
                "action_label": presentation["action_label"],
                "summary": presentation["summary"],
                "description": presentation["description"],
                "subject": presentation["subject"],
                "target_id": row.target_id,
                "details": details,
                "ip_address": row.ip_address,
                "timestamp": row.timestamp.isoformat() if row.timestamp else None,
            }
        )
    return {"logs": logs, "total": total, "page": page, "per_page": per_page}


def _audit_actor_fallback(actor_id: str | None) -> dict:
    if actor_id == "system":
        return {"id": "system", "name": "System automation", "email": None, "role": "system"}
    return {"id": actor_id, "name": "Former user", "email": None, "role": None}


def _audit_subject(action: str, details: dict, target_id: str | None, users: dict, assignment_names: dict) -> dict | None:
    if action.startswith("assignment."):
        assignment_id = details.get("assignment_id") or target_id
        title = details.get("title") or assignment_names.get(assignment_id)
        return {"type": "assignment", "id": assignment_id, "label": f"Assignment: {title}" if title else "Assignment"}
    if action in {"Settings updated", "Course subjects updated"}:
        return {"type": "settings", "id": None, "label": "Institution settings"}
    return {"type": "record", "id": target_id, "label": "System record" if not target_id else "Related record"}


def _present_audit_event(action: str, details: dict, target_id: str | None, actor: dict, users: dict, assignment_names: dict) -> dict:
    """Translate stored event codes into a concise admin-facing activity record."""
    subject = _audit_subject(action, details, target_id, users, assignment_names)
    action_labels = {
        "assignment.created": "Created an assignment",
        "assignment.updated": "Updated an assignment",
        "assignment.deleted": "Deleted an assignment",
        "assignment.admin_deleted": "Permanently deleted an assignment",
        "assignment.submitted": "Submitted assignment work",
        "assignment.results_published_automatically": "Automatically published assignment results",
        "assignment.lock": "Locked assignment submissions",
        "assignment.unlock": "Unlocked assignment submissions",
        "assignment.archive": "Archived an assignment",
        "assignment.unpublish": "Unpublished an assignment",
        "assignment.reassign": "Reassigned an assignment",
        "assignment.remind": "Sent a grading reminder",
        "Settings updated": "Updated system settings",
        "Course subjects updated": "Updated course subjects",
    }
    action_label = action_labels.get(action, action.replace("_", " ").replace(".", " ").strip().capitalize())
    subject_label = subject["label"] if subject else "the system"
    description = f"{actor['name']} {action_label[:1].lower() + action_label[1:]} for {subject_label}."
    if action in {"assignment.lock", "assignment.archive", "assignment.unpublish", "assignment.reassign"} and details.get("reason"):
        description += f" Reason: {details['reason']}"
    if action == "assignment.reassign" and details.get("previous_teacher"):
        previous = users.get(str(details["previous_teacher"]))
        if previous:
            description += f" Previous owner: {previous['name']}."
    return {"action_label": action_label, "summary": f"{actor['name']} — {action_label}", "description": description, "subject": subject}
