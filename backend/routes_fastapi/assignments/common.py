import datetime
import uuid

from models.assignment import SqlAssignment, SqlAssignmentEvaluationParticipant, SqlAssignmentResource, SqlAssignmentRubric, SqlAssignmentSubmission
from models.notification import SqlNotification
from models.sql_models import SqlUser, utcnow
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024


MAX_SUBMISSION_VERSIONS = 3


MAX_EXTERNAL_EVALUATION_BATCH_STUDENTS = 10


ALLOWED_ATTACHMENT_TYPES = {
    "application/pdf",
    "application/zip",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/markdown",
    "image/png",
    "image/jpeg",
    "image/webp",
}


def _now():
    return utcnow()


def _utc_naive(value):
    """Normalize an API datetime for storage in UTC-naive database columns."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(datetime.timezone.utc).replace(tzinfo=None)


def _utc_response(value):
    """Mark stored UTC-naive values explicitly as UTC in API responses."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _normalize_generated_assignment(
    payload: dict,
    total_marks: float = 20,
    rubric_count: int = 5,
    difficulty: str = "intermediate",
    require_readme: bool = True,
) -> dict:
    requested_total_marks = max(0.1, min(10_000, float(total_marks)))
    requested_rubric_count = max(1, min(20, int(rubric_count)))
    rubric = payload.get("rubric") if isinstance(payload.get("rubric"), list) else []
    if len(rubric) != requested_rubric_count:
        raise ValueError(f"AI must return exactly {requested_rubric_count} rubric criteria")
    raw_marks = []
    for item in rubric:
        try:
            raw_marks.append(max(0.1, float(item.get("max_marks", 4))))
        except (TypeError, ValueError):
            raw_marks.append(4.0)
    scale = requested_total_marks / sum(raw_marks)
    marks = [round(value * scale, 2) for value in raw_marks]
    marks[-1] = round(requested_total_marks - sum(marks[:-1]), 2)
    clean_rubric = [
        {
            "id": str(uuid.uuid4()),
            "title": str(item.get("title") or f"Criterion {index + 1}")[:150],
            "description": str(item.get("description") or "")[:2000],
            "max_marks": marks[index],
        }
        for index, item in enumerate(rubric)
    ]
    selected_difficulty = str(difficulty or "intermediate").lower()
    if selected_difficulty not in {"beginner", "intermediate", "advanced"}:
        selected_difficulty = "intermediate"
    requirements = payload.get("repository_requirements") if isinstance(payload.get("repository_requirements"), dict) else {}
    return {
        "title": str(payload.get("title") or "Generated assignment")[:255],
        "short_description": str(payload.get("short_description") or "")[:500],
        "instructions": str(payload.get("instructions") or "")[:50000],
        "learning_outcomes": [str(value)[:300] for value in (payload.get("learning_outcomes") or []) if str(value).strip()][:10],
        "tags": [str(value)[:80] for value in (payload.get("tags") or []) if str(value).strip()][:12],
        "difficulty": selected_difficulty,
        "repository_requirements": {
            "require_readme": bool(require_readme),
            "required_files": [str(value)[:255] for value in (requirements.get("required_files") or []) if str(value).strip()][:20],
        },
        "total_marks": requested_total_marks,
        "rubric": clean_rubric,
    }


def _phase(assignment: SqlAssignment, now=None):
    now = now or _now()
    if assignment.status == "archived":
        return "archived"
    if not assignment.due_at:
        return "closed"
    if assignment.opens_at and now < assignment.opens_at:
        return "scheduled"
    if now < assignment.due_at:
        return "open"
    return "closed"


def _closed(assignment):
    return _phase(assignment) == "closed"


async def _notification(db: AsyncSession, user_id, title, message, notification_type="assignment", action_url=None, dedupe_key=None):
    if dedupe_key:
        existing = (await db.scalars(select(SqlNotification.id).filter_by(user_id=user_id, dedupe_key=dedupe_key))).first()
        if existing:
            return
    db.add(
        SqlNotification(
            id=str(uuid.uuid4()),
            user_id=user_id,
            type=notification_type,
            title=title,
            message=message,
            metadata_json={},
            action_url=action_url,
            dedupe_key=dedupe_key,
        )
    )


async def _rubric(db: AsyncSession, assignment_id):
    return (await db.scalars(select(SqlAssignmentRubric).filter_by(assignment_id=assignment_id).order_by(SqlAssignmentRubric.position))).all()


async def _resources(db: AsyncSession, assignment_id):
    return (await db.scalars(select(SqlAssignmentResource).filter_by(assignment_id=assignment_id).order_by(SqlAssignmentResource.position))).all()


def _serialize_resource(row):
    return {
        "id": row.id,
        "kind": row.kind,
        "label": row.label,
        "url": row.url,
        "filename": row.filename,
        "content_type": row.content_type,
        "size_bytes": row.size_bytes,
    }


def _submission_content_filter():
    """Columns that identify a live repository link or immutable snapshot."""
    return or_(
        SqlAssignmentSubmission.repository_url.is_not(None),
        SqlAssignmentSubmission.active_version_id.is_not(None),
        SqlAssignmentSubmission.pending_version_id.is_not(None),
        SqlAssignmentSubmission.frozen_version_id.is_not(None),
    )


def _submission_has_content(submission):
    return bool(
        submission
        and any(
            (
                submission.repository_url,
                submission.active_version_id,
                submission.pending_version_id,
                submission.frozen_version_id,
            )
        )
    )


async def _assignment_has_submission_content(db: AsyncSession, assignment_id):
    row = (
        await db.scalars(
            select(SqlAssignmentSubmission.id).filter(
                SqlAssignmentSubmission.assignment_id == assignment_id,
                _submission_content_filter(),
            )
        )
    ).first()
    return row is not None


def _advance_saved_grade_revision(grade, *, is_new):
    """A first persisted evaluation is revision 1; later saves advance it once."""
    if is_new:
        grade.revision = 1
    else:
        grade.revision += 1


def _eligible(assignment, user):
    if user.get("role") != "student":
        return False
    return all(
        (not expected or str(user.get(field) or "") == str(expected))
        for field, expected in (
            ("course_id", assignment.target_course_id),
            ("batch_id", assignment.target_batch_id),
            ("section_id", assignment.target_section_id),
        )
    )


async def _eligible_students(db: AsyncSession, assignment):
    query = select(SqlUser).filter(SqlUser.role == "student")
    if assignment.target_course_id:
        query = query.filter(SqlUser.course_id == assignment.target_course_id)
    if assignment.target_batch_id:
        query = query.filter(SqlUser.batch_id == assignment.target_batch_id)
    if assignment.target_section_id:
        query = query.filter(SqlUser.section_id == assignment.target_section_id)
    return (await db.scalars(query)).all()


async def _evaluation_participants(db: AsyncSession, assignment):
    return (await db.scalars(select(SqlAssignmentEvaluationParticipant).filter_by(assignment_id=assignment.id))).all()


async def _assignment_students(db: AsyncSession, assignment):
    """Use the live academic group until evaluation locks, then the frozen cohort."""
    if not assignment.evaluation_locked_at:
        return await _eligible_students(db, assignment)
    participants = await _evaluation_participants(db, assignment)
    if not participants:
        return []
    ids = [row.student_id for row in participants]
    students = (await db.scalars(select(SqlUser).filter(SqlUser.id.in_(ids)))).all()
    by_id = {row.id: row for row in students}
    return [by_id[row.student_id] for row in participants if row.student_id in by_id]


async def _student_has_assignment_access(db: AsyncSession, assignment, user):
    if user.get("role") != "student":
        return False
    if assignment.evaluation_locked_at:
        row = (await db.scalars(select(SqlAssignmentEvaluationParticipant.id).filter_by(assignment_id=assignment.id, student_id=user["_id"]))).first()
        return row is not None
    return _eligible(assignment, user)


async def _submission_map(db: AsyncSession, assignment_id):
    rows = (await db.scalars(select(SqlAssignmentSubmission).filter_by(assignment_id=assignment_id))).all()
    return {row.student_id: row for row in rows}


def _serialize_grade(grade):
    metadata = getattr(grade, "evaluation_metadata", None) or {}
    return {
        "id": grade.id,
        "submission_version_id": grade.submission_version_id,
        "rubric_scores": grade.rubric_scores or {},
        "rubric_feedback": metadata.get("rubric_feedback") or {},
        "total_awarded": grade.total_awarded,
        "evaluation_source": getattr(grade, "evaluation_source", None) or "manual",
        "evaluation_metadata": metadata,
        "is_missing": grade.is_missing,
        "status": grade.status,
        "revision": grade.revision,
        "evaluated_at": grade.evaluated_at,
        "published_at": grade.published_at,
        "withdrawn_at": grade.withdrawn_at,
        "withdrawal_reason": grade.withdrawal_reason,
    }


def _snapshot_grade(grade):
    snapshot = _serialize_grade(grade)
    # Revision snapshots are stored in a database JSON column. FastAPI handles
    # datetime response values, but the database JSON serializer requires
    # primitive values.
    for key in ("evaluated_at", "published_at", "withdrawn_at"):
        value = snapshot.get(key)
        if isinstance(value, (datetime.datetime, datetime.date)):
            snapshot[key] = value.isoformat()
    return snapshot
