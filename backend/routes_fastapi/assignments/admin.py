import datetime
import json

from core.db import db_session
from core.policy import Access, Resource, require_access
from core.scoping import scope_to_programs
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from models.assignment import SqlAssignment, SqlAssignmentSubmission, SqlAssignmentSubmissionVersion
from models.settings_store import write_audit_log
from models.sql_models import SqlCourse, SqlUser
from schemas.assignment import AdminAssignmentActionInput
from services.assignment_storage import get_assignment_storage
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .common import _closed, _notification, _now, _phase, _resources, _utc_response
from .crud import _parse_dashboard_date
from .payloads import _serialize_assignment, _serialize_version
from .submissions import _assignment_roster_payload, _version_for_assignment
from .workflow import _assignment_stats

router = APIRouter()


@router.get("/admin-tools/dashboard")
async def admin_assignment_dashboard(
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    program_id: str | None = None,
    session_id: str | None = None,
    principal=Depends(require_access(Resource.ASSIGNMENTS, Access.VIEW)),
    db: AsyncSession = Depends(db_session),
):
    from models.sql_models import SqlAcademicSession

    from routes_fastapi.admin_settings import read_assignment_monitoring_settings_async

    settings = await read_assignment_monitoring_settings_async(db)
    # An explicit academic session (topbar switcher) takes priority over
    # the plain from/to query params, which in turn take priority over
    # the institution-wide default date-range settings.
    session_start = session_end = None
    if session_id:
        academic_session = (await db.scalars(select(SqlAcademicSession).filter(SqlAcademicSession.id == session_id))).first()
        if not academic_session:
            raise HTTPException(404, "Academic session not found")
        session_start = academic_session.start_date.isoformat()
        session_end = academic_session.end_date.isoformat()
    start = _parse_dashboard_date(from_date or session_start or settings["academic_year_start"])
    end = _parse_dashboard_date(to_date or session_end or settings["academic_year_end"], end=True)
    if start > end:
        raise HTTPException(400, "Date range end must follow its start")
    if session_id and not from_date and not to_date:
        # Prefer the real session_id tag; fall back to the date range for
        # older rows that predate session tagging and were never backfilled.
        query = select(SqlAssignment).filter(
            or_(SqlAssignment.session_id == session_id, and_(SqlAssignment.session_id.is_(None), SqlAssignment.due_at >= start, SqlAssignment.due_at <= end))
        )
    else:
        query = select(SqlAssignment).filter(SqlAssignment.due_at >= start, SqlAssignment.due_at <= end)
    # Sprint 5, the original implementation plan "Done when": unconditional, same
    # reasoning as admin/batches.py::get_batches — a program admin can't
    # widen their own scope by passing (or omitting) program_id.
    query = scope_to_programs(query, principal, SqlAssignment.target_course_id)
    if program_id:
        query = query.filter(SqlAssignment.target_course_id == program_id)
    assignments = (await db.scalars(query.order_by(SqlAssignment.due_at.desc()))).all()
    teachers = {row.id: row for row in (await db.scalars(select(SqlUser).filter_by(role="teacher"))).all()}
    programs = {row.id: row for row in (await db.scalars(select(SqlCourse))).all()}
    program_rows, teacher_rows, pending_rows = {}, {}, []
    total_submitted = total_missed = total_closed = total_pending = total_overdue = 0
    for assignment in assignments:
        stats = await _assignment_stats(db, assignment)
        submitted = stats["submission_count"] if stats["closed_eligible_count"] else 0
        missed = stats["missed_count"]
        total_submitted += submitted
        total_missed += missed
        total_closed += stats["closed_eligible_count"]
        total_pending += stats["pending_grade_count"]
        total_overdue += stats["overdue_ungraded_submission_count"]
        program = programs.get(assignment.target_course_id)
        program_key = assignment.target_course_id or "unassigned"
        p = program_rows.setdefault(
            program_key,
            {
                "program_id": assignment.target_course_id,
                "program_name": program.name if program else "Unassigned",
                "assignments": 0,
                "closed_eligible": 0,
                "submissions": 0,
                "missed": 0,
                "pending_evaluations": 0,
                "overdue_evaluations": 0,
            },
        )
        teacher = teachers.get(assignment.created_by)
        t = teacher_rows.setdefault(
            assignment.created_by,
            {
                "teacher_id": assignment.created_by,
                "teacher_name": teacher.name if teacher else "Former/Unknown teacher",
                "assignments": 0,
                "closed_eligible": 0,
                "submissions": 0,
                "missed": 0,
                "pending_evaluations": 0,
                "overdue_evaluations": 0,
            },
        )
        for aggregate in (p, t):
            aggregate["assignments"] += 1
            aggregate["closed_eligible"] += stats["closed_eligible_count"]
            aggregate["submissions"] += submitted
            aggregate["missed"] += missed
            aggregate["pending_evaluations"] += stats["pending_grade_count"]
            aggregate["overdue_evaluations"] += stats["overdue_ungraded_submission_count"]
        if stats["pending_grade_count"]:
            pending_rows.append(
                {
                    "assignment_id": assignment.id,
                    "title": assignment.title,
                    "teacher_id": assignment.created_by,
                    "teacher_name": t["teacher_name"],
                    "due_at": _utc_response(assignment.due_at),
                    "overdue_since": _utc_response(assignment.due_at + datetime.timedelta(hours=24)) if assignment.due_at else None,
                    "pending_evaluations": stats["pending_grade_count"],
                    "overdue_evaluations": stats["overdue_ungraded_submission_count"],
                }
            )
    for aggregate in [*program_rows.values(), *teacher_rows.values()]:
        denominator = aggregate["closed_eligible"]
        aggregate["submission_rate"] = round(aggregate["submissions"] / denominator * 100, 2) if denominator else None
        aggregate["missed_rate"] = round(aggregate["missed"] / denominator * 100, 2) if denominator else None
    return {
        "range": {"from": start.date().isoformat(), "to": end.date().isoformat()},
        "settings": settings,
        "summary": {
            "assignments": len(assignments),
            "open_assignments": sum(_phase(row) == "open" for row in assignments),
            "closed_eligible": total_closed,
            "submissions": total_submitted,
            "missed": total_missed,
            "submission_rate": round(total_submitted / total_closed * 100, 2) if total_closed else None,
            "pending_evaluations": total_pending,
            "overdue_evaluations": total_overdue,
        },
        "programs": sorted(program_rows.values(), key=lambda row: row["program_name"]),
        "teachers": sorted(teacher_rows.values(), key=lambda row: (-row["overdue_evaluations"], row["teacher_name"])),
        "pending_grading": sorted(
            pending_rows, key=lambda row: (-row["overdue_evaluations"], row["due_at"] or datetime.datetime.max.replace(tzinfo=datetime.timezone.utc))
        ),
    }


@router.post("/admin-tools/{assignment_id}/action")
async def admin_assignment_action(
    assignment_id: str,
    body: AdminAssignmentActionInput,
    request: Request,
    principal=Depends(require_access(Resource.ASSIGNMENTS, Access.EDIT)),
    db: AsyncSession = Depends(db_session),
):
    assignment = (await db.scalars(select(SqlAssignment).filter_by(id=assignment_id))).first()
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    if body.action in {"lock", "archive", "reassign"} and len(body.reason.strip()) < 3:
        raise HTTPException(400, "Provide a reason for this governance action")
    details = {"action": body.action, "reason": body.reason, "previous_teacher": assignment.created_by}
    if body.action == "reassign":
        teacher = (await db.scalars(select(SqlUser).filter_by(id=body.teacher_id, role="teacher"))).first()
        if not teacher:
            raise HTTPException(404, "Teacher not found")
        assignment.created_by = teacher.id
        await _notification(
            db,
            teacher.id,
            "Assignment reassigned",
            f"You are now responsible for {assignment.title}.",
            "assignment_admin",
            f"/assignments/{assignment.id}/review",
        )
    elif body.action == "lock":
        assignment.submission_locked_at, assignment.submission_locked_by, assignment.submission_lock_reason = _now(), principal.user_id, body.reason
    elif body.action == "unlock":
        if _closed(assignment):
            raise HTTPException(409, "A passed deadline cannot be reopened")
        if assignment.evaluation_locked_at:
            raise HTTPException(409, "Evaluation has started, so repository changes cannot be reopened")
        assignment.submission_locked_at = assignment.submission_locked_by = assignment.submission_lock_reason = None
    elif body.action == "archive":
        assignment.status = "archived"
    elif body.action == "remind":
        await _notification(
            db,
            assignment.created_by,
            "Assignment grading reminder",
            f"{assignment.title} has submitted work waiting for marks.",
            "assignment_overdue",
            f"/assignments/{assignment.id}/review",
            f"admin-reminder:{assignment.id}:{_now().date().isoformat()}",
        )
    await db.commit()
    await write_audit_log(db, principal.user_id, f"assignment.{body.action}", assignment.id, details, request.client.host if request.client else None)
    return {"message": "Assignment governance action completed", "assignment": await _serialize_assignment(db, assignment, False)}


@router.get("/admin")
async def admin_assignments(
    q: str | None = None,
    program_id: str | None = None,
    teacher_id: str | None = None,
    subject_id: str | None = None,
    batch_id: str | None = None,
    section_id: str | None = None,
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    session_id: str | None = None,
    status: str | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=500),
    principal=Depends(require_access(Resource.ASSIGNMENTS, Access.VIEW)),
    db: AsyncSession = Depends(db_session),
):
    query = scope_to_programs(select(SqlAssignment), principal, SqlAssignment.target_course_id)
    if q:
        matching_teacher_ids = (await db.scalars(select(SqlUser.id).filter(SqlUser.role == "teacher", SqlUser.name.ilike(f"%{q}%")))).all()
        query = query.filter(
            or_(SqlAssignment.title.ilike(f"%{q}%"), SqlAssignment.subject.ilike(f"%{q}%"), SqlAssignment.created_by.in_(matching_teacher_ids))
        )
    if program_id:
        query = query.filter(SqlAssignment.target_course_id == program_id)
    if teacher_id:
        query = query.filter(SqlAssignment.created_by == teacher_id)
    if subject_id:
        query = query.filter(SqlAssignment.subject_id == subject_id)
    if batch_id:
        query = query.filter(SqlAssignment.target_batch_id == batch_id)
    if section_id:
        query = query.filter(SqlAssignment.target_section_id == section_id)
    session_start = session_end = None
    if session_id:
        from models.sql_models import SqlAcademicSession

        academic_session = (await db.scalars(select(SqlAcademicSession).filter(SqlAcademicSession.id == session_id))).first()
        if not academic_session:
            raise HTTPException(404, "Academic session not found")
        session_start = academic_session.start_date.isoformat()
        session_end = academic_session.end_date.isoformat()
    start_date = _parse_dashboard_date(from_date or session_start) if (from_date or session_start) else None
    end_date = _parse_dashboard_date(to_date or session_end, end=True) if (to_date or session_end) else None
    if start_date and end_date and start_date > end_date:
        raise HTTPException(400, "Date range end must follow its start")
    if session_id and not from_date and not to_date:
        # Prefer the real session_id tag; fall back to the date range for
        # older rows that predate session tagging and were never backfilled.
        query = query.filter(
            or_(
                SqlAssignment.session_id == session_id,
                and_(SqlAssignment.session_id.is_(None), SqlAssignment.due_at >= start_date, SqlAssignment.due_at <= end_date),
            )
        )
    else:
        if start_date:
            query = query.filter(SqlAssignment.due_at >= start_date)
        if end_date:
            query = query.filter(SqlAssignment.due_at <= end_date)
    rows = []
    assignments = (await db.scalars(query.order_by(SqlAssignment.created_at.desc()))).all()
    for assignment in assignments:
        item = await _serialize_assignment(db, assignment, False)
        creator = (await db.scalars(select(SqlUser).filter_by(id=assignment.created_by))).first()
        item["teacher_name"] = creator.name if creator else "Former/Unknown teacher"
        item["failed_count"] = await db.scalar(
            select(func.count(SqlAssignmentSubmissionVersion.id))
            .join(SqlAssignmentSubmission)
            .filter(SqlAssignmentSubmission.assignment_id == assignment.id, SqlAssignmentSubmissionVersion.analysis_status == "failed")
        )
        rows.append(item)
    if status:
        rows = [item for item in rows if status in {item.get("workflow_status"), item.get("phase"), item.get("status")}]
    total = len(rows)
    start = (page - 1) * per_page
    return {"assignments": rows[start : start + per_page], "total": total, "page": page, "per_page": per_page}


@router.get("/admin/overview")
async def admin_assignment_overview(principal=Depends(require_access(Resource.ASSIGNMENTS, Access.VIEW)), db: AsyncSession = Depends(db_session)):
    assignments = (await db.scalars(scope_to_programs(select(SqlAssignment), principal, SqlAssignment.target_course_id))).all()
    serialized = [await _serialize_assignment(db, row, False) for row in assignments]
    versions = (await db.scalars(select(SqlAssignmentSubmissionVersion))).all()
    total_submissions = await db.scalar(select(func.count(SqlAssignmentSubmission.id)))
    return {
        "overview": {
            "total_assignments": len(assignments),
            "active_assignments": sum(item["workflow_status"] in {"scheduled", "open", "awaiting_grading", "results_partial"} for item in serialized),
            "completed_assignments": sum(item["workflow_status"] == "completed" for item in serialized),
            "total_submissions": total_submissions,
            "pending_grades": sum(item["pending_grade_count"] for item in serialized),
            "analysis_failures": sum(item.analysis_status == "failed" for item in versions),
        }
    }


@router.get("/admin/{assignment_id}")
async def admin_assignment_detail(assignment_id: str, principal=Depends(require_access(Resource.ASSIGNMENTS, Access.VIEW)), db: AsyncSession = Depends(db_session)):
    assignment = (await db.scalars(select(SqlAssignment).filter_by(id=assignment_id))).first()
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    payload = await _assignment_roster_payload(db, assignment)
    creator = (await db.scalars(select(SqlUser).filter_by(id=assignment.created_by))).first()
    payload["assignment"]["teacher_name"] = creator.name if creator else "Unknown"
    return payload


@router.get("/admin/{assignment_id}/repository/{version_id}")
async def admin_repository_detail(
    assignment_id: str, version_id: str, principal=Depends(require_access(Resource.ASSIGNMENTS, Access.VIEW)), db: AsyncSession = Depends(db_session)
):
    assignment = (await db.scalars(select(SqlAssignment).filter_by(id=assignment_id))).first()
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    version = await _version_for_assignment(db, assignment, version_id)
    manifest = json.loads(await get_assignment_storage().aget_bytes(version.manifest_key)) if version.manifest_key and version.analysis_status == "ready" else []
    return {"version": _serialize_version(version), "manifest": manifest}


@router.delete("/admin/{assignment_id}")
async def admin_delete_assignment(
    assignment_id: str, request: Request, principal=Depends(require_access(Resource.ASSIGNMENTS, Access.FULL)), db: AsyncSession = Depends(db_session)
):
    assignment = (await db.scalars(select(SqlAssignment).filter_by(id=assignment_id))).first()
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    keys = [row.storage_key for row in await _resources(db, assignment.id) if row.storage_key]
    versions = (
        await db.scalars(select(SqlAssignmentSubmissionVersion).join(SqlAssignmentSubmission).filter(SqlAssignmentSubmission.assignment_id == assignment.id))
    ).all()
    keys.extend(key for row in versions for key in (row.archive_key, row.manifest_key) if key)
    submission_count = await db.scalar(select(func.count(SqlAssignmentSubmission.id)).filter_by(assignment_id=assignment.id))
    details = {"title": assignment.title, "submission_count": submission_count, "reason": "Administrator confirmed permanent deletion in the portal"}
    await db.delete(assignment)
    await db.commit()
    cleanup_failures = 0
    for key in set(keys):
        try:
            await get_assignment_storage().adelete(key)
        except Exception:
            cleanup_failures += 1
    await write_audit_log(
        db,
        principal.user_id,
        "assignment.admin_deleted",
        assignment_id,
        {**details, "storage_cleanup_failures": cleanup_failures},
        request.client.host if request.client else None,
    )
    return {"message": "Assignment permanently deleted", "storage_cleanup_failures": cleanup_failures}
