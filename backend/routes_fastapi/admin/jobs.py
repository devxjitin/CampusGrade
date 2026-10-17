"""Super Admin view of background jobs: list, filter, retry dead jobs (Sprint 2, S2-09)."""

from core.db import db_session
from core.policy import Permission, require
from fastapi import APIRouter, Depends, HTTPException, Query
from models.job import JOB_DEAD, Job
from models.settings_store import write_audit_log
from services import jobs as job_service
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(tags=["admin-jobs"])

JOB_STATUSES = {"queued", "running", "succeeded", "failed", "dead"}


def _serialize(job: Job) -> dict:
    return {
        "id": job.id,
        "type": job.type,
        "payload": job.payload,
        "status": job.status,
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "run_after": job.run_after.isoformat() if job.run_after else None,
        "locked_by": job.locked_by,
        "locked_at": job.locked_at.isoformat() if job.locked_at else None,
        "last_error": job.last_error,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


@router.get("/jobs")
async def list_jobs(
    status: str | None = Query(None),
    type: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    principal=Depends(require(Permission.JOBS_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    del principal
    if status is not None and status not in JOB_STATUSES:
        raise HTTPException(422, f"status must be one of {', '.join(sorted(JOB_STATUSES))}")
    query = select(Job)
    if status:
        query = query.where(Job.status == status)
    if type:
        query = query.where(Job.type == type)
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    rows = (await db.scalars(query.order_by(Job.id.desc()).limit(limit).offset(offset))).all()
    counts = dict((await db.execute(select(Job.status, func.count()).group_by(Job.status))).all())
    return {"jobs": [_serialize(row) for row in rows], "total": total, "counts": counts}


@router.post("/jobs/{job_id}/retry")
async def retry_job(job_id: int, principal=Depends(require(Permission.JOBS_MANAGE)), db: AsyncSession = Depends(db_session)):
    job = (await db.scalars(select(Job).where(Job.id == job_id).with_for_update())).first()
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status != JOB_DEAD:
        raise HTTPException(409, "Only dead jobs can be retried")
    await job_service.retry_dead(db, job)
    await write_audit_log(db, principal.user_id, "job.retried", str(job.id), {"type": job.type})
    await db.commit()
    return {"message": "Job queued for retry", "job": _serialize(job)}
