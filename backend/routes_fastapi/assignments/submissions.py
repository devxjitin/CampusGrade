import asyncio
import datetime
import json
import uuid

import jwt
from core.db import db_session
from core.policy import require_roles
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from models.assignment import (
    SqlAssignment,
    SqlAssignmentDuplicateFlag,
    SqlAssignmentEvaluationParticipant,
    SqlAssignmentGrade,
    SqlAssignmentGradeRevision,
    SqlAssignmentSubmission,
    SqlAssignmentSubmissionVersion,
)
from models.settings_store import write_audit_log
from schemas.assignment import RepositoryPreviewRequest, RepositoryResetRequest, RepositorySubmitRequest
from services import jobs
from services.assignment_storage import get_assignment_storage
from services.github_repository_service import (
    ANALYZE_JOB_TYPE,
    EXTRACT_FINAL_JOB_TYPE,
    GitHubRepositoryError,
    preview_repository,
    read_repository_file,
    sync_submission_repository,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .common import _assignment_students, _notification, _now, _phase, _serialize_grade, _snapshot_grade, _student_has_assignment_access, _utc_response
from .payloads import _serialize_assignment, _serialize_student_version, _serialize_version, _submission_payload, _teacher_assignment
from .workflow import _assert_student_submission_allowed, _assignment_stats, _evaluation_workflow, _student_assignment

router = APIRouter()


@router.post("/student/{assignment_id}/repository-preview")
async def repository_preview(
    assignment_id: str, body: RepositoryPreviewRequest, request: Request, student=Depends(require_roles("student")), db: AsyncSession = Depends(db_session)
):
    assignment = await _student_assignment(db, assignment_id, student)
    await _assert_student_submission_allowed(db, assignment, student["_id"])
    try:
        preview = await asyncio.to_thread(preview_repository, body.repository_url, student.get("github_username") or "")
    except GitHubRepositoryError as exc:
        raise HTTPException(400, str(exc)) from exc
    preview["assignment_id"], preview["student_id"], preview["exp"] = (
        assignment.id,
        student["_id"],
        datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=10),
    )
    token = jwt.encode(preview, request.app.state.secret_key, algorithm="HS256")
    visible = {key: value for key, value in preview.items() if key not in {"assignment_id", "student_id", "exp"}}
    return {"preview": visible, "preview_token": token}


@router.post("/student/{assignment_id}/submit")
async def submit_repository(
    assignment_id: str,
    body: RepositorySubmitRequest,
    request: Request,
    student=Depends(require_roles("student")),
    db: AsyncSession = Depends(db_session),
):
    try:
        preview = jwt.decode(body.preview_token, request.app.state.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(400, "Repository preview expired. Validate the link again") from exc
    if preview.get("assignment_id") != assignment_id or preview.get("student_id") != student["_id"]:
        raise HTTPException(400, "Repository preview does not match this assignment")
    assignment = (
        await db.scalars(select(SqlAssignment).filter(SqlAssignment.id == assignment_id, SqlAssignment.status == "published").with_for_update())
    ).first()
    if not assignment or not await _student_has_assignment_access(db, assignment, student):
        raise HTTPException(404, "Assignment not found")
    now = _now()
    submission, _version_count = await _assert_student_submission_allowed(
        db,
        assignment,
        student["_id"],
        lock_submission=True,
    )
    if not submission:
        submission = SqlAssignmentSubmission(
            id=str(uuid.uuid4()), assignment_id=assignment.id, student_id=student["_id"], first_submitted_at=now, last_submitted_at=now, status="submitted"
        )
        db.add(submission)
        await db.flush()
    existing_version = (
        await db.scalars(
            select(SqlAssignmentSubmissionVersion.id).filter_by(
                submission_id=submission.id, repository_generation=submission.repository_generation, commit_sha=preview["commit_sha"]
            )
        )
    ).first()
    if existing_version:
        raise HTTPException(409, "This commit is already your active submission")
    commit_at = datetime.datetime.fromisoformat(preview["commit_at"].replace("Z", "+00:00")).replace(tzinfo=None) if preview.get("commit_at") else None
    version = SqlAssignmentSubmissionVersion(
        id=str(uuid.uuid4()),
        submission_id=submission.id,
        repository_generation=submission.repository_generation,
        detected_at=now,
        detection_source="student",
        repository_url=preview["repository_url"],
        repository_owner=preview["owner"],
        repository_name=preview["name"],
        default_branch=preview["default_branch"],
        commit_sha=preview["commit_sha"],
        commit_message=preview.get("commit_message"),
        commit_at=commit_at,
        submitted_at=now,
        is_late=False,
        seconds_late=0,
        analysis_status="queued",
    )
    db.add(version)
    await db.flush()
    submission.repository_url, submission.repository_owner, submission.repository_name = preview["repository_url"], preview["owner"], preview["name"]
    submission.default_branch, submission.latest_remote_sha = preview["default_branch"], preview["commit_sha"]
    submission.pending_version_id, submission.last_sync_checked_at = version.id, now
    submission.next_sync_at = None
    submission.sync_status, submission.last_submitted_at, submission.status = "syncing", now, "submitted"
    existing_grade = (await db.scalars(select(SqlAssignmentGrade).filter_by(assignment_id=assignment.id, student_id=student["_id"]))).first()
    if existing_grade and existing_grade.status == "draft":
        db.add(
            SqlAssignmentGradeRevision(
                id=str(uuid.uuid4()),
                grade_id=existing_grade.id,
                action="reset_on_resubmission",
                snapshot=_snapshot_grade(existing_grade),
                actor_id=student["_id"],
            )
        )
        existing_grade.submission_version_id, existing_grade.rubric_scores, existing_grade.feedback, existing_grade.total_awarded, existing_grade.is_missing = (
            version.id,
            {},
            "",
            0,
            False,
        )
        existing_grade.evaluation_metadata = None
        existing_grade.revision += 1
    await _notification(
        db,
        assignment.created_by,
        "Repository awaiting analysis",
        f"{student.get('name') or 'A student'} submitted {version.repository_name} for {assignment.title}.",
        action_url=f"/assignments/{assignment.id}/review",
        dedupe_key=f"assignment-repository-submitted:{version.id}",
    )
    await jobs.enqueue(db, ANALYZE_JOB_TYPE, {"version_id": version.id}, max_attempts=4)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "This repository submission was already recorded") from exc
    await write_audit_log(
        db,
        student["_id"],
        "assignment.submitted",
        version.id,
        {"assignment_id": assignment.id, "commit_sha": version.commit_sha},
        request.client.host if request.client else None,
    )
    return {"message": "Repository linked and initial synchronization started", "submission": await _submission_payload(db, assignment, student["_id"])}


@router.post("/student/{assignment_id}/repository/sync")
async def sync_student_repository(assignment_id: str, student=Depends(require_roles("student")), db: AsyncSession = Depends(db_session)):
    assignment = await _student_assignment(db, assignment_id, student)
    submission = (await db.scalars(select(SqlAssignmentSubmission).filter_by(assignment_id=assignment.id, student_id=student["_id"]))).first()
    if not submission:
        raise HTTPException(409, "Link a repository first")
    if not submission.repository_url and submission.active_version_id:
        legacy = (await db.scalars(select(SqlAssignmentSubmissionVersion).filter_by(id=submission.active_version_id))).first()
        if legacy:
            submission.repository_url, submission.repository_owner, submission.repository_name = (
                legacy.repository_url,
                legacy.repository_owner,
                legacy.repository_name,
            )
            submission.default_branch, submission.latest_remote_sha = legacy.default_branch, legacy.commit_sha
            submission.sync_status = "live" if legacy.analysis_status == "ready" else "syncing"
            await db.commit()
    if not submission.repository_url:
        raise HTTPException(409, "Link a repository first")
    if submission.freeze_requested_at or _phase(assignment) != "open":
        raise HTTPException(409, "This repository is frozen")
    if submission.last_sync_checked_at and (_now() - submission.last_sync_checked_at).total_seconds() < 30:
        raise HTTPException(429, "Wait 30 seconds before checking again")
    submission_id = submission.id
    result = await sync_submission_repository(db, submission_id, source="student", force=True)
    return {"message": "Repository check completed", "sync": result}


@router.get("/student/{assignment_id}/repository")
async def student_repository_detail(assignment_id: str, student=Depends(require_roles("student")), db: AsyncSession = Depends(db_session)):
    assignment = await _student_assignment(db, assignment_id, student)
    submission = (await db.scalars(select(SqlAssignmentSubmission).filter_by(assignment_id=assignment.id, student_id=student["_id"]))).first()
    if not submission:
        raise HTTPException(404, "Repository submission not found")
    version_id = submission.frozen_version_id or submission.active_version_id
    version = (await db.scalars(select(SqlAssignmentSubmissionVersion).filter_by(id=version_id))).first() if version_id else None
    if not version or version.analysis_status != "ready" or not version.manifest_key:
        raise HTTPException(409, "The latest synchronized snapshot is not ready")
    manifest = json.loads(await get_assignment_storage().aget_bytes(version.manifest_key))
    return {"version": _serialize_student_version(version), "manifest": manifest, "readme_markdown": version.readme_markdown}


@router.get("/student/{assignment_id}/repository/file")
async def student_repository_file(assignment_id: str, path: str, student=Depends(require_roles("student")), db: AsyncSession = Depends(db_session)):
    assignment = await _student_assignment(db, assignment_id, student)
    submission = (await db.scalars(select(SqlAssignmentSubmission).filter_by(assignment_id=assignment.id, student_id=student["_id"]))).first()
    version_id = (submission.frozen_version_id or submission.active_version_id) if submission else None
    version = (await db.scalars(select(SqlAssignmentSubmissionVersion).filter_by(id=version_id))).first() if version_id else None
    if not version:
        raise HTTPException(404, "Repository snapshot not found")
    try:
        content, media_type = await asyncio.to_thread(read_repository_file, version, path)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return Response(content=content, media_type=media_type)


@router.get("/teacher/{assignment_id}/roster")
async def assignment_roster(assignment_id: str, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    assignment = await _teacher_assignment(db, assignment_id, teacher)
    return await _assignment_roster_payload(db, assignment)


@router.post("/teacher/{assignment_id}/students/{student_id}/evaluation/start")
async def start_student_evaluation(
    assignment_id: str, student_id: str, request: Request, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)
):
    assignment = await _teacher_assignment(db, assignment_id, teacher)
    submission = (await db.scalars(select(SqlAssignmentSubmission).filter_by(assignment_id=assignment.id, student_id=student_id).with_for_update())).first()
    if not submission or not submission.repository_url:
        raise HTTPException(409, "Student has no repository submission")
    if submission.freeze_requested_at:
        payload = await _submission_payload(db, assignment, student_id)
        return {"message": "Evaluation already started", "freeze_state": payload["freeze_state"]}
    now = _now()
    # From here the student's later pushes no longer count: the worker takes the repository's newest
    # commit as the final snapshot (a teacher may do this for any student before the deadline).
    submission.freeze_requested_at, submission.freeze_reason, submission.frozen_by = now, "evaluation", teacher["_id"]
    submission.next_sync_at = None
    submission.pending_version_id, submission.sync_status = None, "freeze_pending"
    participant = (await db.scalars(select(SqlAssignmentEvaluationParticipant).filter_by(assignment_id=assignment.id, student_id=student_id))).first()
    if not participant:
        db.add(
            SqlAssignmentEvaluationParticipant(
                id=str(uuid.uuid4()), assignment_id=assignment.id, student_id=student_id, submission_version_id=None, status="submitted", locked_at=now
            )
        )
    else:
        participant.submission_version_id, participant.status, participant.locked_at = None, "submitted", now
    await jobs.enqueue(db, EXTRACT_FINAL_JOB_TYPE, {"submission_id": submission.id}, max_attempts=6)
    await db.commit()
    await write_audit_log(
        db,
        teacher["_id"],
        "assignment.evaluation_started",
        submission.id,
        {"assignment_id": assignment.id, "student_id": student_id},
        request.client.host if request.client else None,
    )
    payload = await _submission_payload(db, assignment, student_id)
    return {"message": "Repository frozen for evaluation", "freeze_state": payload["freeze_state"]}


@router.post("/teacher/{assignment_id}/students/{student_id}/repository/reset")
async def reset_student_repository(
    assignment_id: str,
    student_id: str,
    body: RepositoryResetRequest,
    request: Request,
    teacher=Depends(require_roles("teacher")),
    db: AsyncSession = Depends(db_session),
):
    assignment = await _teacher_assignment(db, assignment_id, teacher)
    if _phase(assignment) != "open":
        raise HTTPException(409, "Repository links cannot be reset after the deadline")
    submission = (await db.scalars(select(SqlAssignmentSubmission).filter_by(assignment_id=assignment.id, student_id=student_id).with_for_update())).first()
    if not submission or not submission.repository_url:
        raise HTTPException(409, "Student has no linked repository")
    if submission.freeze_requested_at:
        raise HTTPException(409, "Evaluation has started, so the repository cannot be reset")
    existing_grade_id = (await db.scalars(select(SqlAssignmentGrade.id).filter_by(assignment_id=assignment.id, student_id=student_id))).first()
    if existing_grade_id:
        raise HTTPException(409, "A grade already exists for this student")
    old_url = submission.repository_url
    submission.repository_generation += 1
    for field in (
        "active_version_id",
        "pending_version_id",
        "frozen_version_id",
        "repository_url",
        "repository_owner",
        "repository_name",
        "default_branch",
        "latest_remote_sha",
        "last_sync_checked_at",
        "last_sync_completed_at",
        "next_sync_at",
        "sync_error",
    ):
        setattr(submission, field, None)
    submission.sync_failure_count, submission.sync_status, submission.status = 0, "unlinked", "reset"
    await db.commit()
    await _notification(
        db,
        student_id,
        "Repository link reset",
        f"Your teacher reset the repository link for {assignment.title}. Submit the correct repository.",
        action_url=f"/assignments/{assignment.id}",
    )
    await db.commit()
    await write_audit_log(
        db,
        teacher["_id"],
        "assignment.repository_reset",
        submission.id,
        {"assignment_id": assignment.id, "student_id": student_id, "old_url": old_url, "reason": body.reason},
        request.client.host if request.client else None,
    )
    return {"message": "Repository link reset"}


@router.post("/teacher/{assignment_id}/repositories/fetch-all")
async def fetch_all_assignment_repositories(assignment_id: str, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    assignment = (await db.scalars(select(SqlAssignment).filter(SqlAssignment.id == assignment_id, SqlAssignment.created_by == teacher["_id"]))).first()
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    return {
        "message": "Repository synchronization is automatic and student-owned",
        "deprecated": True,
        "evaluation_workflow": await _evaluation_workflow(db, assignment),
    }


async def _assignment_roster_payload(db: AsyncSession, assignment):
    students = sorted(await _assignment_students(db, assignment), key=lambda item: item.name or "")
    rows = []
    for student in students:
        payload = await _submission_payload(db, assignment, student.id, include_analysis=True)
        grade = (await db.scalars(select(SqlAssignmentGrade).filter_by(assignment_id=assignment.id, student_id=student.id))).first()
        payload["grade"] = _serialize_grade(grade) if grade else None
        payload["student"] = {
            "id": student.id,
            "name": student.name,
            "email": student.email,
            "roll_no": student.roll_no,
            "github_username": student.github_username,
        }
        payload["score_percentage"] = (
            round(float(grade.total_awarded) / float(assignment.total_marks) * 100, 2) if grade and not grade.is_missing and assignment.total_marks else None
        )
        payload["is_low_score"] = payload["score_percentage"] is not None and payload["score_percentage"] < 50
        rows.append(payload)
    flags = (await db.scalars(select(SqlAssignmentDuplicateFlag).filter_by(assignment_id=assignment.id))).all()
    version_rows = {row.get("version", {}).get("id"): row for row in rows if row.get("version")}

    def serialize_flag(flag):
        left_row, right_row = version_rows.get(flag.left_version_id), version_rows.get(flag.right_version_id)
        left_summary = ((left_row or {}).get("version") or {}).get("analysis_summary") or {}
        right_summary = ((right_row or {}).get("version") or {}).get("analysis_summary") or {}
        left_hashes = left_summary.get("text_hashes") or {}
        right_hashes = right_summary.get("text_hashes") or {}
        matched_files = sorted(path for path in set(left_hashes) & set(right_hashes) if left_hashes[path] == right_hashes[path])
        return {
            "id": flag.id,
            "left_version_id": flag.left_version_id,
            "right_version_id": flag.right_version_id,
            "type": flag.flag_type,
            "similarity": float(flag.similarity),
            "review_status": "system_applied" if flag.flag_type == "code_similarity" and float(flag.similarity) > 0.70 else (flag.review_status or "pending"),
            "reviewed": bool(flag.reviewed),
            "review_notes": flag.review_notes or "",
            "reviewed_at": _utc_response(flag.reviewed_at),
            "left_student": (left_row or {}).get("student"),
            "right_student": (right_row or {}).get("student"),
            "matched_file_count": len(matched_files),
            "matched_files": matched_files[:30],
        }

    serialized_flags = [serialize_flag(flag) for flag in flags]
    similarity_flags = sorted(
        (flag for flag in serialized_flags if flag["type"] == "code_similarity" and flag["similarity"] > 0.70),
        key=lambda flag: flag["similarity"],
        reverse=True,
    )
    stats = await _assignment_stats(db, assignment)
    scored = [row for row in rows if row["grade"] and not row["grade"]["is_missing"]]
    missed_rows = [row for row in rows if row["grade"] and row["grade"]["is_missing"]]
    known_total = sum(float(row["grade"]["total_awarded"]) for row in scored)
    known_count = len(scored) + len(missed_rows)
    distinct_scores = sorted({float(row["grade"]["total_awarded"]) for row in scored}, reverse=True)[:3]
    top_scorers = []
    for row in sorted(
        (row for row in scored if float(row["grade"]["total_awarded"]) in distinct_scores),
        key=lambda item: (-float(item["grade"]["total_awarded"]), item["student"]["name"].casefold()),
    ):
        score = float(row["grade"]["total_awarded"])
        top_scorers.append(
            {
                "rank": distinct_scores.index(score) + 1,
                "student": row["student"],
                "marks": score,
                "percentage": row["score_percentage"],
                "status": row["grade"]["status"],
            }
        )
    assignment_payload = await _serialize_assignment(db, assignment)
    assignment_payload.update(
        {
            "total_students": stats["eligible_count"],
            "missed_count": stats["missed_count"],
            "highest_marks": max((float(row["grade"]["total_awarded"]) for row in scored), default=None),
            "average_score": round(known_total / known_count, 2) if known_count else None,
            "average_score_percentage": round(known_total / (known_count * float(assignment.total_marks)) * 100, 2)
            if known_count and assignment.total_marks
            else None,
            "average_score_provisional": known_count < stats["eligible_count"],
            "evaluated_count": known_count,
            "top_scorers": top_scorers,
        }
    )
    return {
        "assignment": assignment_payload,
        "evaluation_workflow": await _evaluation_workflow(db, assignment),
        "roster": rows,
        "duplicate_flags": serialized_flags,
        "similarity_flags": similarity_flags,
    }


async def _version_for_assignment(db: AsyncSession, assignment, version_id):
    row = (
        await db.scalars(
            select(SqlAssignmentSubmissionVersion)
            .join(SqlAssignmentSubmission, SqlAssignmentSubmission.id == SqlAssignmentSubmissionVersion.submission_id)
            .filter(SqlAssignmentSubmissionVersion.id == version_id, SqlAssignmentSubmission.assignment_id == assignment.id)
        )
    ).first()
    if not row:
        raise HTTPException(404, "Submission version not found")
    return row


@router.get("/teacher/{assignment_id}/repository/{version_id}")
async def repository_detail(assignment_id: str, version_id: str, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    assignment = await _teacher_assignment(db, assignment_id, teacher)
    version = await _version_for_assignment(db, assignment, version_id)
    manifest = json.loads(await get_assignment_storage().aget_bytes(version.manifest_key)) if version.manifest_key and version.analysis_status == "ready" else []
    return {"version": _serialize_version(version), "manifest": manifest}


@router.get("/teacher/{assignment_id}/repository/{version_id}/file")
async def repository_file(assignment_id: str, version_id: str, path: str, teacher=Depends(require_roles("teacher")), db: AsyncSession = Depends(db_session)):
    assignment = await _teacher_assignment(db, assignment_id, teacher)
    version = await _version_for_assignment(db, assignment, version_id)
    try:
        data, content_type = await asyncio.to_thread(read_repository_file, version, path)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return Response(content=data, media_type=content_type)
