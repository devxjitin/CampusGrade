"""Admin user-management and assignment-profile endpoints."""

import datetime
import logging
import uuid

from core.db import db_session
from core.policy import Permission, require_user
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from models.assignment import SqlAssignment, SqlAssignmentGrade, SqlAssignmentSubmission, SqlAssignmentSubmissionVersion
from models.settings_store import write_audit_log
from models.sql_models import (
    SqlBatch,
    SqlCourse,
    SqlSection,
    SqlStudentSessionRecord,
    SqlStudentSubjectEnrollment,
    SqlSubject,
    SqlUser,
)
from schemas.user import AdminUserUpdate, AssignmentsUpdate, StudentCreate, TeacherCreate, TemporaryCredentialResponse, UserStatusUpdate
from services.identity_service import sync_profile
from services.session_service import revoke_all_sessions
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from utils.security_utils import encrypt_password

from routes_fastapi import admin_routes as legacy
from routes_fastapi.admin_settings import read_assignment_monitoring_settings
from routes_fastapi.assignment_routes import _assignment_stats, _submission_has_content

router = APIRouter(tags=["admin-users"])


async def _build_teacher_assignments_async(db: AsyncSession, raw_assignments):
    """Async port of admin_routes.py's `_build_teacher_assignments`. Purely a
    validation/lookup helper (no cross-file service coupling — unlike
    `mirror_teacher_allocations`, which stays out of scope here, see
    CHANGELOG.md), so it was safe to duplicate as an async version rather
    than needing a bridge."""
    if not raw_assignments:
        raise HTTPException(status_code=400, detail="At least one teaching assignment is required")

    normalized = []
    seen = set()
    for raw_assignment in raw_assignments:
        assignment = raw_assignment.model_dump() if hasattr(raw_assignment, "model_dump") else dict(raw_assignment)
        program_id = assignment["program_id"]
        batch_id = assignment["batch_id"]
        section_id = assignment["section_id"]
        subject_ids = assignment["subject_ids"]

        program = (await db.scalars(select(SqlCourse).where(SqlCourse.id == program_id))).first()
        if not program:
            raise HTTPException(status_code=404, detail="Selected program was not found")
        batch = (await db.scalars(select(SqlBatch).where(SqlBatch.id == batch_id))).first()
        if not batch:
            raise HTTPException(status_code=404, detail="Selected batch was not found")
        if batch.course_id != program.id:
            raise HTTPException(status_code=400, detail="Batch does not belong to the selected program")
        section = (await db.scalars(select(SqlSection).where(SqlSection.id == section_id))).first()
        if not section:
            raise HTTPException(status_code=404, detail="Selected section was not found")
        if section.course_id != program.id or section.batch_id != batch.id:
            raise HTTPException(status_code=400, detail="Section does not belong to the selected program and batch")

        subjects = (await db.scalars(select(SqlSubject).where(SqlSubject.id.in_(subject_ids)))).all()
        if len(subjects) != len(subject_ids):
            raise HTTPException(status_code=404, detail="One or more selected courses were not found")
        subjects_by_id = {subject.id: subject for subject in subjects}
        ordered_subjects = [subjects_by_id[subject_id] for subject_id in subject_ids]
        for subject in ordered_subjects:
            if subject.course_id and subject.course_id != program.id:
                raise HTTPException(status_code=400, detail="A selected course is restricted to another program")
            if subject.batch_id and subject.batch_id != batch.id:
                raise HTTPException(status_code=400, detail="A selected course is restricted to another batch")

        scope = (program_id, batch_id, section_id)
        if scope in seen:
            raise HTTPException(status_code=400, detail="Each program, batch, and section scope can only appear once")
        seen.add(scope)
        normalized.append(
            {
                "program_id": program.id,
                "program": program.name,
                "course": program.name,
                "batch_id": batch.id,
                "batch": legacy._build_batch_label(batch.start_year, batch.end_year, batch.name),
                "section_id": section.id,
                "section": section.name,
                "subject_ids": subject_ids,
                "subjects": [subject.name for subject in ordered_subjects],
            }
        )
    return normalized


async def _lock_user_safety_context_async(db: AsyncSession, user_id: str):
    """Async port of admin_routes.py's `_lock_user_safety_context`. Row-locks
    (`with_for_update()`) the same way, for the same reason: this guards the
    "don't remove the last active admin" check against a concurrent request
    doing the same thing. Kept as an exact behavioral mirror of the sync
    version rather than reusing it directly, since the sync version takes a
    sync `Session`."""
    # Sprint 5, the original implementation plan: "super_admin", not "admin" — see the
    # note on `admin_routes.py::_lock_user_safety_context`.
    active_admins = (
        await db.scalars(select(SqlUser).where(SqlUser.role == "super_admin", SqlUser.is_active.is_(True)).order_by(SqlUser.id).with_for_update())
    ).all()
    user = (await db.scalars(select(SqlUser).where(SqlUser.id == user_id).with_for_update())).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user, active_admins


logger = logging.getLogger("CampusGrade.AdminUsers")


def _profile_assignment_status(*, deadline_passed: bool, valid_submission: bool, grade) -> str:
    if deadline_passed and ((grade and grade.is_missing) or not valid_submission):
        return "missed"
    if grade and grade.status == "published":
        return "published"
    if grade:
        return "graded"
    return "submitted" if valid_submission else "not_submitted"


def _monitoring_range(db):
    settings = read_assignment_monitoring_settings(db)
    start = datetime.datetime.combine(datetime.date.fromisoformat(settings["academic_year_start"]), datetime.time.min)
    end = datetime.datetime.combine(datetime.date.fromisoformat(settings["academic_year_end"]), datetime.time.max)
    return settings, start, end


def _assignment_in_range(assignment, start, end) -> bool:
    return bool(assignment.due_at and start <= assignment.due_at <= end)


def _assignment_student_profile_sync(user_id: str, session):
    """Return only assignment participation and grading data for a student."""
    try:
        student = session.query(SqlUser).filter(SqlUser.id == user_id, SqlUser.role == "student").first()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")

        now = datetime.datetime.utcnow()
        settings, range_start, range_end = _monitoring_range(session)
        rows = []
        assignments = session.query(SqlAssignment).filter(SqlAssignment.status == "published").order_by(SqlAssignment.due_at.desc()).all()
        for assignment in assignments:
            if assignment.target_course_id and assignment.target_course_id != student.course_id:
                continue
            if assignment.target_batch_id and assignment.target_batch_id != student.batch_id:
                continue
            if assignment.target_section_id and assignment.target_section_id != student.section_id:
                continue
            submission = session.query(SqlAssignmentSubmission).filter_by(assignment_id=assignment.id, student_id=student.id).first()
            versions = (
                session.query(SqlAssignmentSubmissionVersion)
                .filter_by(submission_id=submission.id)
                .order_by(SqlAssignmentSubmissionVersion.submitted_at.desc())
                .all()
                if submission
                else []
            )
            active_version = next((item for item in versions if item.id == submission.active_version_id), None) if submission else None
            grade = session.query(SqlAssignmentGrade).filter_by(assignment_id=assignment.id, student_id=student.id).first()
            deadline_passed = bool(assignment.due_at and now >= assignment.due_at)
            valid_submission = _submission_has_content(submission)
            status = _profile_assignment_status(deadline_passed=deadline_passed, valid_submission=valid_submission, grade=grade)
            rows.append(
                {
                    "assignment_id": assignment.id,
                    "title": assignment.title,
                    "subject": assignment.subject,
                    "subject_id": assignment.subject_id,
                    "due_at": assignment.due_at.isoformat() + "Z" if assignment.due_at else None,
                    "deadline_passed": deadline_passed,
                    "in_reporting_range": _assignment_in_range(assignment, range_start, range_end),
                    "status": status,
                    "repository_url": active_version.repository_url if active_version else None,
                    "analysis_status": active_version.analysis_status if active_version else None,
                    "version_count": len(versions),
                    "has_valid_submission": valid_submission,
                    "updates_used": max(0, len(versions) - 1),
                    "submitted_at": submission.last_submitted_at.isoformat() + "Z" if submission and valid_submission else None,
                    "marks_obtained": float(grade.total_awarded) if grade else None,
                    "total_marks": float(assignment.total_marks),
                    "percentage": round(float(grade.total_awarded) / float(assignment.total_marks) * 100, 2) if grade and assignment.total_marks else None,
                    "grade_status": grade.status if grade else None,
                    "is_missing": bool(grade and grade.is_missing),
                    "published_at": grade.published_at.isoformat() + "Z" if grade and grade.published_at else None,
                }
            )

        progress_rows = [row for row in rows if row["in_reporting_range"]]
        submitted = [row for row in progress_rows if row["has_valid_submission"]]
        closed = [row for row in progress_rows if row["deadline_passed"]]
        missed = [row for row in closed if row["status"] == "missed"]
        scores = [row["percentage"] for row in progress_rows if row["percentage"] is not None]
        threshold = float(settings["missed_rate_threshold_percent"])
        missed_rate = round(len(missed) / len(closed) * 100, 2) if closed else None
        return {
            "student": {
                "id": student.id,
                "name": student.name,
                "email": student.email,
                "roll_no": student.roll_no,
                "course": student.course,
                "batch": student.batch,
                "contact_number": student.contact_number,
                "is_active": student.is_active,
                "github_username": student.github_username,
            },
            "assignments": rows,
            "assignment_summary": {
                "eligible": len(progress_rows),
                "submitted": len(submitted),
                "closed_eligible": len(closed),
                "missed": len(missed),
                "missed_rate": missed_rate,
                "at_risk": missed_rate is not None and missed_rate > threshold,
                "missed_rate_threshold_percent": threshold,
                "published": sum(row["status"] == "published" for row in rows),
                "average_score": round(sum(scores) / len(scores), 2) if scores else None,
                "on_time_rate": round(len(submitted) / len(progress_rows) * 100, 2) if progress_rows else None,
                "total_updates": sum(row["updates_used"] for row in progress_rows),
            },
            "reporting_range": {"from": settings["academic_year_start"], "to": settings["academic_year_end"]},
        }
    finally:
        pass


def _admin_user_details_sync(user_id: str, session):
    """Return the full safe profile and assignment context for an administrator."""
    try:
        user = session.query(SqlUser).filter(SqlUser.id == user_id).first()
        if not user or user.role not in {"student", "teacher"}:
            raise HTTPException(status_code=404, detail="User not found")

        details = {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "is_active": user.is_active,
            "teacher_id": user.teacher_id,
            "roll_no": user.roll_no,
            "course": user.course,
            "batch": user.batch,
            "section": user.section.name if user.section else None,
            "contact_number": user.contact_number,
            "year": user.year,
            "designation": user.designation,
            "bio": user.bio,
            "avatar": user.avatar,
            "github_username": user.github_username,
            "leetcode_username": user.leetcode_username,
            "github_repositories": user.github_repositories or [],
            "achievements": user.achievements or [],
            "teaching_assignments": user.assignments or [],
            "created_at": user.created_at.isoformat() + "Z" if user.created_at else None,
            "updated_at": user.updated_at.isoformat() + "Z" if user.updated_at else None,
            "last_login": user.last_login.isoformat() + "Z" if user.last_login else None,
        }

        settings, range_start, range_end = _monitoring_range(session)
        details["reporting_range"] = {"from": settings["academic_year_start"], "to": settings["academic_year_end"]}
        if user.role == "teacher":
            assignment_rows = session.query(SqlAssignment).filter(SqlAssignment.created_by == user.id).order_by(SqlAssignment.created_at.desc()).all()
            progress_assignment_rows = [assignment for assignment in assignment_rows if _assignment_in_range(assignment, range_start, range_end)]
            owned_assignments = []
            for assignment in assignment_rows:
                submission_count = session.query(SqlAssignmentSubmission).filter(SqlAssignmentSubmission.assignment_id == assignment.id).count()
                published_grades = (
                    session.query(SqlAssignmentGrade)
                    .filter(
                        SqlAssignmentGrade.assignment_id == assignment.id,
                        SqlAssignmentGrade.status == "published",
                    )
                    .count()
                )
                owned_assignments.append(
                    {
                        "id": assignment.id,
                        "title": assignment.title,
                        "subject": assignment.subject,
                        "status": assignment.status,
                        "due_at": assignment.due_at.isoformat() + "Z" if assignment.due_at else None,
                        "total_marks": assignment.total_marks,
                        "submission_count": submission_count,
                        "published_grade_count": published_grades,
                    }
                )
            subject_progress = {}
            closed_eligible = submissions = missed = pending = overdue = 0
            for assignment in progress_assignment_rows:
                stats = _assignment_stats(session, assignment)
                key = assignment.subject_id or f"legacy:{assignment.subject or 'General'}"
                subject = subject_progress.setdefault(
                    key,
                    {
                        "subject_id": assignment.subject_id,
                        "subject": assignment.subject or "General",
                        "assignments": 0,
                        "closed_eligible": 0,
                        "submissions": 0,
                        "missed": 0,
                        "pending_evaluations": 0,
                        "overdue_evaluations": 0,
                    },
                )
                subject["assignments"] += 1
                subject["closed_eligible"] += stats["closed_eligible_count"]
                subject["submissions"] += stats["submission_count"] if stats["closed_eligible_count"] else 0
                subject["missed"] += stats["missed_count"]
                subject["pending_evaluations"] += stats["pending_grade_count"]
                subject["overdue_evaluations"] += stats["overdue_ungraded_submission_count"]
                closed_eligible += stats["closed_eligible_count"]
                submissions += stats["submission_count"] if stats["closed_eligible_count"] else 0
                missed += stats["missed_count"]
                pending += stats["pending_grade_count"]
                overdue += stats["overdue_ungraded_submission_count"]
            for subject in subject_progress.values():
                denominator = subject["closed_eligible"]
                subject["submission_rate"] = round(subject["submissions"] / denominator * 100, 2) if denominator else None
                subject["missed_rate"] = round(subject["missed"] / denominator * 100, 2) if denominator else None
            details["assignment_summary"] = {
                "created": len(progress_assignment_rows),
                "closed_eligible": closed_eligible,
                "submissions": submissions,
                "missed": missed,
                "submission_rate": round(submissions / closed_eligible * 100, 2) if closed_eligible else None,
                "missed_rate": round(missed / closed_eligible * 100, 2) if closed_eligible else None,
                "pending_evaluations": pending,
                "overdue_evaluations": overdue,
            }
            details["owned_assignments"] = owned_assignments
            details["subject_progress"] = sorted(subject_progress.values(), key=lambda row: row["subject"])
            details["evaluation_overdue"] = overdue > 0
        else:
            activity = _assignment_student_profile_sync(user_id, session)
            details["assignment_summary"] = activity["assignment_summary"]
            details["assignment_activity"] = activity["assignments"]
            details["reporting_range"] = activity["reporting_range"]

        return {"user": details}
    finally:
        pass


@router.get("/users")
async def get_users(
    page: int = 1,
    per_page: int = 20,
    search: str | None = None,
    role: str | None = None,
    session_id: str | None = None,
    admin=Depends(require_user(Permission.USER_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    """Async port of admin_routes.py::get_users — read-only, no shared-helper
    coupling, safe to port on its own. See CHANGELOG.md Sprint 2."""
    del admin
    query = select(SqlUser)
    if role:
        query = query.where(SqlUser.role == role)
    if search:
        pattern = f"%{search}%"
        query = query.where(or_(SqlUser.name.ilike(pattern), SqlUser.email.ilike(pattern), SqlUser.roll_no.ilike(pattern)))

    total_users = await db.scalar(select(func.count()).select_from(query.subquery()))
    total_pages = (total_users + per_page - 1) // per_page

    users = (await db.scalars(query.order_by(SqlUser.created_at.desc()).offset((page - 1) * per_page).limit(per_page))).all()
    section_name_map = {section.id: section.name for section in (await db.scalars(select(SqlSection))).all()}

    session_records_by_student = {}
    if session_id:
        student_ids = [u.id for u in users if u.role == "student"]
        if student_ids:
            records = (
                await db.scalars(
                    select(SqlStudentSessionRecord).where(SqlStudentSessionRecord.session_id == session_id, SqlStudentSessionRecord.student_id.in_(student_ids))
                )
            ).all()
            for record in records:
                session_records_by_student[record.student_id] = record

    user_list = []
    for u in users:
        overdue_evaluations = 0
        if u.role == "teacher":
            cutoff = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(hours=24)
            assignments = (await db.scalars(select(SqlAssignment).where(SqlAssignment.created_by == u.id, SqlAssignment.due_at <= cutoff))).all()
            for assignment in assignments:
                submitted_ids = {
                    row.student_id
                    for row in (
                        await db.scalars(
                            select(SqlAssignmentSubmission).where(
                                SqlAssignmentSubmission.assignment_id == assignment.id,
                                or_(
                                    SqlAssignmentSubmission.active_version_id.is_not(None),
                                    SqlAssignmentSubmission.frozen_version_id.is_not(None),
                                    SqlAssignmentSubmission.pending_version_id.is_not(None),
                                ),
                            )
                        )
                    ).all()
                }
                graded_ids = {
                    row.student_id for row in (await db.scalars(select(SqlAssignmentGrade).where(SqlAssignmentGrade.assignment_id == assignment.id))).all()
                }
                overdue_evaluations += len(submitted_ids - graded_ids)
        record = session_records_by_student.get(u.id) if session_id else None
        section_id_for_view = record.section_id if record else u.section_id
        user_list.append(
            {
                "_id": u.id,
                "name": u.name,
                "email": u.email,
                "role": u.role,
                "teacher_id": u.teacher_id,
                "is_active": u.is_active,
                "assignments": u.assignments,
                "roll_no": u.roll_no,
                "course": u.course,
                "batch": u.batch,
                "section_id": section_id_for_view,
                "section_name": section_name_map.get(section_id_for_view),
                "contact_number": u.contact_number,
                "year": record.study_year if record else u.year,
                "semester": record.semester if record else u.semester,
                "session_status": (record.status if record else ("not_in_session" if session_id and u.role == "student" else None)),
                "designation": u.designation,
                "created_at": u.created_at.isoformat() + "Z" if u.created_at else None,
                "last_login": u.last_login.isoformat() + "Z" if u.last_login else None,
                "bio": u.bio,
                "avatar": u.avatar,
                "overdue_evaluations": overdue_evaluations,
                "evaluation_overdue": overdue_evaluations > 0,
            }
        )

    return {"users": user_list, "page": page, "total": total_users, "total_pages": max(1, total_pages)}


@router.patch("/user/{user_id}")
async def toggle_user_status(
    user_id: str,
    body: UserStatusUpdate,
    request: Request,
    admin=Depends(require_user(Permission.USER_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    """Async port of admin_routes.py::toggle_user_status. Uses the async
    row-locking safety context above; `_assert_admin_continuity` is pure
    logic (no DB access) so it's imported and reused directly from the sync
    module rather than duplicated."""
    data = body.model_dump()
    user, active_admins = await _lock_user_safety_context_async(db, user_id)
    next_active = data["is_active"]
    legacy._assert_admin_continuity(user, active_admins, admin["_id"], next_active=next_active)
    changed = user.is_active != next_active
    if changed:
        user.is_active = next_active
        user.session_version = int(user.session_version or 0) + 1
    await db.flush()
    if changed and not next_active:
        await revoke_all_sessions(db, user.id)
    await write_audit_log(
        db,
        admin["_id"],
        "user.status_changed",
        target_id=user.id,
        details={"is_active": next_active, "changed": changed, "target_role": user.role},
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "User updated successfully"}


@router.patch("/user/{user_id}/reset-password", response_model=TemporaryCredentialResponse)
async def reset_user_password(user_id: str, request: Request, admin=Depends(require_user(Permission.USER_MANAGE)), db: AsyncSession = Depends(db_session)):
    """Async port of admin_routes.py::reset_user_password. No admin-continuity
    logic involved (resetting a password doesn't remove an admin), so this
    one only needed a plain lookup, not the row-locking safety context."""
    user = (await db.scalars(select(SqlUser).where(SqlUser.id == user_id))).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role not in {"student", "teacher"}:
        raise HTTPException(status_code=400, detail="Only student and teacher passwords can be reset here")

    temporary_password = legacy._generate_temporary_password()
    user.password = encrypt_password(temporary_password)
    user.must_change_password = True
    user.session_version = int(user.session_version or 0) + 1
    user.login_attempts = 0
    user.locked_until = None
    target = {"id": user.id, "name": user.name, "email": user.email, "role": user.role}
    try:
        await db.flush()
    except Exception as exc:
        await db.rollback()
        logger.error("Password reset failed for user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Failed to reset password") from exc
    await revoke_all_sessions(db, user.id)
    await write_audit_log(
        db,
        admin["_id"],
        "user.password_reset",
        target_id=user.id,
        details={"target_name": user.name, "target_email": user.email, "target_role": user.role},
        ip_address=request.client.host if request.client else None,
    )
    return {
        "message": "Temporary password generated. The user must change it at next sign-in.",
        "temporary_password": temporary_password,
        "user": target,
    }


@router.delete("/user/{user_id}")
async def delete_user(user_id: str, request: Request, admin=Depends(require_user(Permission.USER_MANAGE)), db: AsyncSession = Depends(db_session)):
    """Async port of admin_routes.py::delete_user. Same row-locking safety
    context as toggle_user_status; a delete that would remove the last
    active admin, or an admin deleting themselves, is rejected before the
    delete is even issued."""
    user, active_admins = await _lock_user_safety_context_async(db, user_id)
    legacy._assert_admin_continuity(user, active_admins, admin["_id"], deleting=True)
    target = {"name": user.name, "email": user.email, "role": user.role}
    await db.delete(user)
    try:
        await db.flush()
    except Exception as exc:
        await db.rollback()
        logger.error("User delete failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to delete user") from exc
    await write_audit_log(
        db,
        admin["_id"],
        "user.deleted",
        target_id=user_id,
        details=target,
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "User deleted successfully"}


@router.post("/add-teacher", response_model=TemporaryCredentialResponse)
async def add_teacher(body: TeacherCreate, request: Request, admin=Depends(require_user(Permission.USER_MANAGE)), db: AsyncSession = Depends(db_session)):
    """Async port of admin_routes.py::add_teacher. `_build_teacher_assignments_async`
    above replaces the sync helper; no coupling to `mirror_teacher_allocations`
    (that's only called from update_teacher_assignments/update_admin_user,
    still not ported — see CHANGELOG.md)."""
    data = body.model_dump()
    email = legacy._normalize_user_email(data.get("email"))
    name = legacy._normalize_person_name(data.get("name"))
    teacher_id = legacy._normalize_teacher_id(data.get("teacher_id"))
    contact_number = legacy._normalize_contact_number(data.get("contact_number"), required=True)
    if not teacher_id:
        raise HTTPException(status_code=400, detail="Teacher ID is required")

    if (await db.scalars(select(SqlUser.id).where(func.lower(SqlUser.email) == email.lower()))).first():
        raise HTTPException(status_code=400, detail="Email already exists")
    if (await db.scalars(select(SqlUser.id).where(SqlUser.teacher_id.is_not(None), func.lower(SqlUser.teacher_id) == teacher_id.lower()))).first():
        raise HTTPException(status_code=400, detail="Teacher ID already exists")

    assignments = await _build_teacher_assignments_async(db, data.get("assignments"))
    temporary_password = legacy._generate_temporary_password()
    hashed = encrypt_password(temporary_password)

    new_user = SqlUser(
        id=str(uuid.uuid4()),
        name=name,
        email=email,
        password=hashed,
        role="teacher",
        teacher_id=teacher_id,
        contact_number=contact_number,
        designation=str(data.get("designation") or "").strip() or None,
        assignments=assignments,
        must_change_password=True,
        is_active=True,
        login_attempts=0,
        created_by=admin["_id"],
        created_at=datetime.datetime.utcnow(),
    )
    db.add(new_user)
    await sync_profile(db, new_user)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        logger.warning("Teacher add failed due to duplicate constraint: %s", exc)
        raise HTTPException(status_code=400, detail="Duplicate teacher data is not allowed") from exc
    await write_audit_log(
        db,
        admin["_id"],
        "user.teacher_created",
        target_id=new_user.id,
        details={"name": name, "email": email, "teacher_id": teacher_id},
        ip_address=request.client.host if request.client else None,
    )
    return {
        "message": "Teacher added successfully",
        "temporary_password": temporary_password,
        "user": {"id": new_user.id, "name": name, "email": email, "role": "teacher"},
    }


@router.post("/import-teachers")
async def import_teachers(
    file: UploadFile = File(...),
    dry_run: bool = Form(False),
    admin=Depends(require_user(Permission.USER_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    """Async port of admin_routes.py::import_teachers. Self-contained bulk
    CSV/Excel import — no academic_calendar coupling (unlike add_student,
    which is still blocked, see CHANGELOG.md)."""
    if not file:
        raise HTTPException(status_code=400, detail="File is required")
    file_bytes = await legacy._read_import_file(file)
    required_columns = ["name", "email", "teacher_id", "contact_number"]
    headers, raw_rows = legacy._parse_import_file(file.filename, file_bytes)
    legacy._validate_required_import_columns(headers, required_columns)

    existing_email_keys = {str(email or "").strip().lower() for (email,) in (await db.execute(select(SqlUser.email))).all() if str(email or "").strip()}
    existing_teacher_id_keys = {
        str(teacher_id or "").strip().lower()
        for (teacher_id,) in (await db.execute(select(SqlUser.teacher_id).where(SqlUser.teacher_id.is_not(None)))).all()
        if str(teacher_id or "").strip()
    }

    seen_email_keys, seen_teacher_id_keys = set(), set()
    added_rows, duplicate_rows, invalid_rows = [], [], []

    for row_number, raw_row in raw_rows:
        row = legacy._normalize_import_row(raw_row)
        missing_values = [column for column in required_columns if not str(row.get(column) or "").strip()]
        if missing_values:
            invalid_rows.append({"row_number": row_number, "reasons": [f"Missing values for: {', '.join(missing_values)}"]})
            continue
        try:
            email = legacy._normalize_user_email(row.get("email"))
            teacher_id = legacy._normalize_teacher_id(row.get("teacher_id"))
            if not teacher_id:
                raise HTTPException(status_code=400, detail="Teacher ID is required")
            name = legacy._normalize_person_name(row.get("name"))
            contact_number = legacy._normalize_contact_number(row.get("contact_number"), required=True)
            generated_password = legacy._generate_temporary_password()
            encrypted_password = encrypt_password(generated_password)
        except HTTPException as exc:
            invalid_rows.append({"row_number": row_number, "reasons": [str(exc.detail)]})
            continue

        email_key, teacher_id_key = email.lower(), teacher_id.lower()
        duplicate_reasons = []
        if email_key in seen_email_keys:
            duplicate_reasons.append("Duplicate email in file")
        elif email_key in existing_email_keys:
            duplicate_reasons.append("Email already exists")
        if teacher_id_key in seen_teacher_id_keys:
            duplicate_reasons.append("Duplicate teacher ID in file")
        elif teacher_id_key in existing_teacher_id_keys:
            duplicate_reasons.append("Teacher ID already exists")
        if duplicate_reasons:
            duplicate_rows.append({"row_number": row_number, "reasons": duplicate_reasons, "email": email, "teacher_id": teacher_id})
            continue

        teacher_record = SqlUser(
            id=str(uuid.uuid4()),
            name=name,
            email=email,
            password=encrypted_password,
            role="teacher",
            teacher_id=teacher_id,
            designation=str(row.get("designation") or "").strip() or None,
            contact_number=contact_number,
            assignments=[],
            must_change_password=True,
            is_active=True,
            login_attempts=0,
            created_by=admin.get("_id"),
            created_at=datetime.datetime.utcnow(),
        )
        if not dry_run:
            db.add(teacher_record)
            await sync_profile(db, teacher_record)
        seen_email_keys.add(email_key)
        seen_teacher_id_keys.add(teacher_id_key)
        existing_email_keys.add(email_key)
        existing_teacher_id_keys.add(teacher_id_key)
        added_rows.append({"name": teacher_record.name, "email": teacher_record.email, "teacher_id": teacher_record.teacher_id})

    try:
        if dry_run:
            await db.rollback()
            completion_message = "Teacher import preview generated. No data was written to DB."
        else:
            await db.flush()
            completion_message = "Teacher import completed"
    except IntegrityError as exc:
        await db.rollback()
        logger.warning("Teacher import failed due to duplicate constraint: %s", exc)
        raise HTTPException(status_code=400, detail="Duplicate teacher data detected while saving") from exc

    return legacy._build_import_response(
        completion_message,
        total_rows=len(raw_rows),
        added_rows=added_rows,
        duplicate_rows=duplicate_rows,
        invalid_rows=invalid_rows,
        dry_run=dry_run,
    )


@router.post("/import-students")
async def import_students(
    file: UploadFile = File(...),
    dry_run: bool = Form(False),
    admin=Depends(require_user(Permission.USER_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    """Async port of admin_routes.py::import_students. Self-contained bulk
    CSV/Excel import — unlike add_student, this route never touches
    academic_calendar.py (no session-record/auto-enrollment logic here), so
    it wasn't blocked the way add_student is."""
    if not file:
        raise HTTPException(status_code=400, detail="File is required")
    file_bytes = await legacy._read_import_file(file)
    required_columns = ["name", "email", "roll_no"]
    headers, raw_rows = legacy._parse_import_file(file.filename, file_bytes)
    legacy._validate_required_import_columns(headers, required_columns)

    existing_email_keys = {str(email or "").strip().lower() for (email,) in (await db.execute(select(SqlUser.email))).all() if str(email or "").strip()}
    existing_roll_no_keys = {
        str(roll_no or "").strip().lower()
        for (roll_no,) in (await db.execute(select(SqlUser.roll_no).where(SqlUser.role == "student"))).all()
        if str(roll_no or "").strip()
    }
    courses_by_id = {course.id: course for course in (await db.scalars(select(SqlCourse))).all()}
    batches_by_id = {batch.id: batch for batch in (await db.scalars(select(SqlBatch))).all()}
    sections_by_id = {section.id: section for section in (await db.scalars(select(SqlSection))).all()}

    seen_email_keys, seen_roll_no_keys = set(), set()
    added_rows, duplicate_rows, invalid_rows = [], [], []

    for row_number, raw_row in raw_rows:
        row = legacy._normalize_import_row(raw_row)
        missing_values = [column for column in required_columns if not str(row.get(column) or "").strip()]
        if missing_values:
            invalid_rows.append({"row_number": row_number, "reasons": [f"Missing values for: {', '.join(missing_values)}"]})
            continue
        try:
            email = legacy._normalize_user_email(row.get("email"))
            roll_no = legacy._normalize_student_roll_no(row.get("roll_no"))
            if not roll_no:
                raise HTTPException(status_code=400, detail="Roll number is required")
            name = legacy._normalize_person_name(row.get("name"))
            generated_password = legacy._generate_temporary_password()
            encrypted_password = encrypt_password(generated_password)

            course_id = legacy._normalize_optional_fk(row.get("course_id"))
            batch_id = legacy._normalize_optional_fk(row.get("batch_id"))
            section_id = legacy._normalize_optional_fk(row.get("section_id"))

            course = None
            if course_id:
                course = courses_by_id.get(course_id)
                if not course:
                    raise HTTPException(status_code=404, detail="Program not found for course_id")
            batch = None
            if batch_id:
                batch = batches_by_id.get(batch_id)
                if not batch:
                    raise HTTPException(status_code=404, detail="Batch not found for batch_id")
                if course_id and batch.course_id != course_id:
                    raise HTTPException(status_code=400, detail="Batch does not belong to selected program")
            section = None
            if section_id:
                section = sections_by_id.get(section_id)
                if not section:
                    raise HTTPException(status_code=404, detail="Section not found for section_id")
                if course_id and section.course_id != course_id:
                    raise HTTPException(status_code=400, detail="Section does not belong to selected program")
                if batch_id and section.batch_id != batch_id:
                    raise HTTPException(status_code=400, detail="Section does not belong to selected batch")
            if section and not course:
                course = courses_by_id.get(section.course_id)
            if section and not batch:
                batch = batches_by_id.get(section.batch_id)
            if not section and str(row.get("section") or "").strip() and batch and course:
                section_name = legacy._normalize_section_name(row.get("section"))
                matching_section = next(
                    (
                        section_candidate
                        for section_candidate in sections_by_id.values()
                        if section_candidate.course_id == course.id
                        and section_candidate.batch_id == batch.id
                        and str(section_candidate.name or "").strip().lower() == section_name.lower()
                    ),
                    None,
                )
                if not matching_section:
                    raise HTTPException(status_code=400, detail=f"Section '{section_name}' not found for selected course/batch")
                section = matching_section

            course_name = None
            batch_label = None
            year_value = legacy._safe_positive_int(row.get("year"), "Year")
            if course:
                course_name = str(course.name or "").strip() or None
                year_value = course.year
            if batch:
                batch_label = legacy._build_batch_label(batch.start_year, batch.end_year, batch.name)
            contact_number = legacy._normalize_contact_number(row.get("contact_number"))
        except HTTPException as exc:
            invalid_rows.append({"row_number": row_number, "reasons": [str(exc.detail)]})
            continue

        email_key, roll_no_key = email.lower(), roll_no.lower()
        duplicate_reasons = []
        if email_key in seen_email_keys:
            duplicate_reasons.append("Duplicate email in file")
        elif email_key in existing_email_keys:
            duplicate_reasons.append("Email already exists")
        if roll_no_key in seen_roll_no_keys:
            duplicate_reasons.append("Duplicate roll number in file")
        elif roll_no_key in existing_roll_no_keys:
            duplicate_reasons.append("Roll number already exists")
        if duplicate_reasons:
            duplicate_rows.append({"row_number": row_number, "reasons": duplicate_reasons, "email": email, "roll_no": roll_no})
            continue

        student_record = SqlUser(
            id=str(uuid.uuid4()),
            name=name,
            email=email,
            password=encrypted_password,
            role="student",
            roll_no=roll_no,
            course=course_name,
            batch=batch_label,
            course_id=course.id if course else None,
            batch_id=batch.id if batch else None,
            section_id=section.id if section else None,
            year=year_value,
            contact_number=contact_number,
            must_change_password=True,
            is_active=True,
            login_attempts=0,
            created_by=admin.get("_id"),
            created_at=datetime.datetime.utcnow(),
        )
        if not dry_run:
            db.add(student_record)
            await sync_profile(db, student_record)
        seen_email_keys.add(email_key)
        seen_roll_no_keys.add(roll_no_key)
        existing_email_keys.add(email_key)
        existing_roll_no_keys.add(roll_no_key)
        added_rows.append({"name": student_record.name, "email": student_record.email, "roll_no": student_record.roll_no})

    try:
        if dry_run:
            await db.rollback()
            completion_message = "Student import preview generated. No data was written to DB."
        else:
            await db.flush()
            completion_message = "Student import completed"
    except IntegrityError as exc:
        await db.rollback()
        logger.warning("Student import failed due to duplicate constraint: %s", exc)
        raise HTTPException(status_code=400, detail="Duplicate student data detected while saving") from exc

    return legacy._build_import_response(
        completion_message,
        total_rows=len(raw_rows),
        added_rows=added_rows,
        duplicate_rows=duplicate_rows,
        invalid_rows=invalid_rows,
        dry_run=dry_run,
    )


async def _require_batch_for_course_async(db: AsyncSession, batch_id: str, course_id: str | None = None) -> SqlBatch:
    """Async twin of `services/academic_service.py::AcademicService.require_batch_for_course`.
    That class is typed `db: Session` throughout and is also called from
    still-sync code, so rather than convert it (and risk breaking those
    callers), the two checks this route needs are duplicated here — same
    narrow scope as `_build_teacher_assignments_async` above."""
    batch = (await db.scalars(select(SqlBatch).where(SqlBatch.id == batch_id))).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if course_id and batch.course_id != course_id:
        raise HTTPException(status_code=400, detail="Batch does not belong to selected program")
    return batch


async def _require_section_for_batch_async(db: AsyncSession, section_id: str, course_id: str | None = None, batch_id: str | None = None) -> SqlSection:
    section = (await db.scalars(select(SqlSection).where(SqlSection.id == section_id))).first()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    if course_id and section.course_id != course_id:
        raise HTTPException(status_code=400, detail="Section does not belong to selected program")
    if batch_id and section.batch_id != batch_id:
        raise HTTPException(status_code=400, detail="Section does not belong to selected batch")
    return section


@router.post("/add-student", response_model=TemporaryCredentialResponse)
async def add_student(body: StudentCreate, request: Request, admin=Depends(require_user(Permission.USER_MANAGE)), db: AsyncSession = Depends(db_session)):
    """Async port of admin_routes.py::add_student. This was the one function
    in this file genuinely blocked on `services/academic_calendar.py`'s
    `resolve_current_session`/`derive_study_year_semester` — unblocked this
    session by adding `resolve_current_session_async` alongside the existing
    sync version (see services/academic_calendar.py; the sync version is
    untouched and still serves `assignment_routes.py`/`admin_routes.py`)."""
    from services.academic_calendar import derive_study_year_semester, resolve_current_session_async

    data = body.model_dump()
    email = legacy._normalize_user_email(data.get("email"))
    name = legacy._normalize_person_name(data.get("name"))
    roll_no = legacy._normalize_student_roll_no(data.get("roll_no"))
    if not roll_no:
        raise HTTPException(status_code=400, detail="Roll number is required to generate password")

    course_id = legacy._normalize_optional_fk(data.get("course_id"))
    batch_id = legacy._normalize_optional_fk(data.get("batch_id"))
    section_id = legacy._normalize_optional_fk(data.get("section_id"))
    admission_year = data.get("admission_year")
    if not course_id:
        raise HTTPException(status_code=400, detail="Program is required")
    if not batch_id and not admission_year:
        raise HTTPException(status_code=400, detail="Batch or admission year is required")

    if (await db.scalars(select(SqlUser.id).where(func.lower(SqlUser.email) == email.lower()))).first():
        raise HTTPException(status_code=400, detail="Email already exists")
    if roll_no and (await db.scalars(select(SqlUser.id).where(SqlUser.role == "student", func.lower(SqlUser.roll_no) == roll_no.lower()))).first():
        raise HTTPException(status_code=400, detail="Roll number already exists")

    course = (await db.scalars(select(SqlCourse).where(SqlCourse.id == course_id))).first()
    if not course:
        raise HTTPException(status_code=404, detail="Program not found")

    if not batch_id and admission_year:
        end_year = admission_year + (course.duration_years or 4)
        resolved_batch = (
            await db.scalars(select(SqlBatch).where(SqlBatch.course_id == course_id, SqlBatch.start_year == admission_year, SqlBatch.end_year == end_year))
        ).first()
        if not resolved_batch:
            resolved_batch = SqlBatch(
                id=str(uuid.uuid4()),
                course_id=course_id,
                start_year=admission_year,
                end_year=end_year,
                status="active",
                auto_created=True,
                intake_open=True,
            )
            db.add(resolved_batch)
            await db.flush()
        batch_id = resolved_batch.id
        if not section_id:
            default_section = (await db.scalars(select(SqlSection).where(SqlSection.batch_id == batch_id, SqlSection.name == "A"))).first()
            if not default_section:
                default_section = SqlSection(id=str(uuid.uuid4()), course_id=course_id, batch_id=batch_id, name="A")
                db.add(default_section)
                await db.flush()
            section_id = default_section.id

    batch = await _require_batch_for_course_async(db, batch_id, course_id) if batch_id else None
    section = await _require_section_for_batch_async(db, section_id, course_id, batch_id) if section_id else None
    if section and not course:
        course = (await db.scalars(select(SqlCourse).where(SqlCourse.id == section.course_id))).first()
    if section and not batch:
        batch = (await db.scalars(select(SqlBatch).where(SqlBatch.id == section.batch_id))).first()

    course_name = str(course.name or "").strip()
    batch_label = legacy._build_batch_label(batch.start_year, batch.end_year, batch.name) if batch else None
    contact_number = legacy._normalize_contact_number(data.get("contact_number"))
    temporary_password = legacy._generate_temporary_password()
    hashed = encrypt_password(temporary_password)

    new_user = SqlUser(
        id=str(uuid.uuid4()),
        name=name,
        email=email,
        password=hashed,
        role="student",
        roll_no=roll_no,
        course=course_name or None,
        course_id=course.id if course else None,
        batch=batch_label or None,
        batch_id=batch.id if batch else None,
        section_id=section.id if section else None,
        contact_number=contact_number,
        year=course.year,
        semester=data.get("semester"),
        must_change_password=True,
        is_active=True,
        login_attempts=0,
        created_by=admin["_id"],
        created_at=datetime.datetime.utcnow(),
    )
    db.add(new_user)
    await sync_profile(db, new_user)
    await db.flush()

    current_session = await resolve_current_session_async(db)
    if current_session and batch:
        study_year, semester = derive_study_year_semester(batch, current_session)
        db.add(
            SqlStudentSessionRecord(
                id=str(uuid.uuid4()),
                student_id=new_user.id,
                session_id=current_session.id,
                batch_id=batch.id,
                section_id=section.id if section else None,
                study_year=study_year,
                semester=semester,
                status="active",
            )
        )
        new_user.year = study_year
        new_user.semester = semester
        subjects = (
            await db.scalars(
                select(SqlSubject).where(
                    SqlSubject.enrollment_type == "compulsory",
                    SqlSubject.year == study_year,
                    (SqlSubject.course_id == course_id) | (SqlSubject.course_id.is_(None)),
                )
            )
        ).all()
        for subject in subjects:
            db.add(SqlStudentSubjectEnrollment(id=str(uuid.uuid4()), student_id=new_user.id, subject_id=subject.id, session_id=current_session.id))

    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        logger.warning("Student add failed due to duplicate constraint: %s", exc)
        raise HTTPException(status_code=400, detail="Duplicate student data is not allowed") from exc

    await write_audit_log(
        db,
        admin["_id"],
        "user.student_created",
        target_id=new_user.id,
        details={"name": name, "email": email, "roll_no": roll_no},
        ip_address=request.client.host if request.client else None,
    )
    return {
        "message": "Student added successfully",
        "temporary_password": temporary_password,
        "user": {"id": new_user.id, "name": name, "email": email, "role": "student"},
    }


@router.patch("/user/{user_id}/assignments")
async def update_teacher_assignments(user_id: str, body: AssignmentsUpdate, admin=Depends(require_user(Permission.USER_MANAGE)), db: AsyncSession = Depends(db_session)):
    """Async port of admin_routes.py::update_teacher_assignments. Unblocked
    this session by `mirror_teacher_allocations_async` (see
    services/academic_calendar.py)."""
    from services.academic_calendar import mirror_teacher_allocations_async

    user = (await db.scalars(select(SqlUser).where(SqlUser.id == user_id))).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != "teacher":
        raise HTTPException(status_code=400, detail="Teaching assignments can only be set for teachers")

    assignments = await _build_teacher_assignments_async(db, body.assignments)
    user.assignments = assignments
    await mirror_teacher_allocations_async(db, user.id, assignments)
    await db.flush()
    return {"message": "Assignments updated successfully"}


@router.put("/user/{user_id}")
async def update_admin_user(user_id: str, body: AdminUserUpdate, request: Request, admin=Depends(require_user(Permission.USER_MANAGE)), db: AsyncSession = Depends(db_session)):
    """Async port of admin_routes.py::update_admin_user — the last of the 10
    genuinely-coupled functions in this file. Deliberately deferred earlier
    this session because of its size and the number of interacting checks;
    ported now that every dependency it needs (`_lock_user_safety_context_async`,
    `_build_teacher_assignments_async`, `mirror_teacher_allocations_async`,
    `_require_batch_for_course_async`/`_require_section_for_batch_async`) is
    already in place from the rest of this session's work.

    This implementation validates only program, batch, and section identifiers;
    no removed academic hierarchy is consulted."""
    data = body.model_dump(exclude_unset=True)
    user, active_admins = await _lock_user_safety_context_async(db, user_id)

    next_email = legacy._normalize_user_email(data.get("email", user.email))
    current_email = legacy._normalize_user_email(user.email)
    if next_email != current_email:
        existing_user = (await db.scalars(select(SqlUser.id).where(SqlUser.id != user_id, func.lower(SqlUser.email) == next_email.lower()))).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already exists")

    next_role = data.get("role", user.role)
    next_active = data.get("is_active", user.is_active)
    legacy._assert_admin_continuity(user, active_admins, admin["_id"], next_role=next_role, next_active=next_active)
    status_changed = user.is_active != next_active
    role_changed = user.role != next_role
    next_roll_no = legacy._normalize_student_roll_no(data.get("roll_no", user.roll_no))
    if next_role == "student" and next_roll_no:
        existing_roll_no = (
            await db.scalars(select(SqlUser.id).where(SqlUser.id != user_id, SqlUser.role == "student", func.lower(SqlUser.roll_no) == next_roll_no.lower()))
        ).first()
        if existing_roll_no:
            raise HTTPException(status_code=400, detail="Roll number already exists")

    next_teacher_id = legacy._normalize_teacher_id(data.get("teacher_id", user.teacher_id))
    if next_role == "teacher" and not next_teacher_id:
        next_teacher_id = legacy._generate_teacher_id_from_user_id(user_id)

    if next_role == "teacher":
        existing_teacher_id = (
            await db.scalars(
                select(SqlUser.id).where(SqlUser.id != user_id, SqlUser.teacher_id.is_not(None), func.lower(SqlUser.teacher_id) == next_teacher_id.lower())
            )
        ).first()
        if existing_teacher_id:
            raise HTTPException(status_code=400, detail="Teacher ID already exists")

    assignments = None
    if "assignments" in data:
        if next_role != "teacher":
            raise HTTPException(status_code=400, detail="Teaching assignments can only be set for teachers")
        assignments = await _build_teacher_assignments_async(db, data["assignments"])

    next_course = next_batch = next_section = None
    if next_role == "student":
        next_course_id = legacy._normalize_optional_fk(data.get("course_id", user.course_id))
        next_batch_id = legacy._normalize_optional_fk(data.get("batch_id", user.batch_id))
        next_section_id = legacy._normalize_optional_fk(data.get("section_id", user.section_id))
        if not next_course_id or not next_batch_id:
            raise HTTPException(status_code=400, detail="Student program and batch are required")
        next_course = (await db.scalars(select(SqlCourse).where(SqlCourse.id == next_course_id))).first()
        if not next_course:
            raise HTTPException(status_code=404, detail="Program not found")
        next_batch = await _require_batch_for_course_async(db, next_batch_id, next_course_id)
        next_section = await _require_section_for_batch_async(db, next_section_id, next_course_id, next_batch_id) if next_section_id else None

    if "name" in data:
        user.name = legacy._normalize_person_name(data["name"])
    user.email = next_email
    if "role" in data:
        user.role = data["role"]
    if "teacher_id" in data or next_role == "teacher":
        user.teacher_id = next_teacher_id
    if "roll_no" in data:
        user.roll_no = next_roll_no
    if next_role == "student":
        user.course_id = next_course.id
        user.batch_id = next_batch.id
        user.section_id = next_section.id if next_section else None
        user.course = next_course.name
        user.batch = legacy._build_batch_label(next_batch.start_year, next_batch.end_year, next_batch.name)
        user.year = next_course.year
    if next_role == "student" and "semester" in data:
        user.semester = data["semester"]
    if "contact_number" in data:
        user.contact_number = legacy._normalize_contact_number(data["contact_number"], required=next_role == "teacher")
    if "designation" in data:
        user.designation = str(data["designation"] or "").strip() or None
    if "is_active" in data:
        user.is_active = next_active
    if status_changed or role_changed:
        user.session_version = int(user.session_version or 0) + 1
    if assignments is not None:
        from services.academic_calendar import mirror_teacher_allocations_async

        user.assignments = assignments
        await mirror_teacher_allocations_async(db, user.id, assignments)

    await sync_profile(db, user)

    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        logger.warning("User update failed due to duplicate constraint: %s", exc)
        raise HTTPException(status_code=400, detail="Duplicate user data is not allowed") from exc

    if status_changed and not next_active:
        await revoke_all_sessions(db, user.id)
    if status_changed or role_changed:
        await write_audit_log(
            db,
            admin["_id"],
            "user.security_state_changed",
            target_id=user.id,
            details={"role": next_role, "is_active": next_active},
            ip_address=request.client.host if request.client else None,
        )
    return {"message": "User updated successfully"}


async def assignment_student_profile(
    user_id: str,
    admin=Depends(require_user(Permission.USER_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    del admin
    return await db.run_sync(lambda session: _assignment_student_profile_sync(user_id, session))


async def admin_user_details(
    user_id: str,
    admin=Depends(require_user(Permission.USER_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    del admin
    return await db.run_sync(lambda session: _admin_user_details_sync(user_id, session))


router.add_api_route("/user/{user_id}/profile", assignment_student_profile, methods=["GET"])
router.add_api_route("/user/{user_id}/details", admin_user_details, methods=["GET"])
