from datetime import date, datetime

from core.db import db_session
from core.policy import Permission, require
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from models.settings_store import (
    get_audit_logs,
    write_audit_log,
)
from models.sql_models import AppSetting
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/admin", tags=["admin"])

MONITORING_SETTING_TYPE = "assignment_monitoring"


class AssignmentMonitoringSettings(BaseModel):
    missed_rate_threshold_percent: float = Field(25, ge=0, le=100)
    academic_year_start: date
    academic_year_end: date

    @model_validator(mode="after")
    def validate_academic_year(self):
        if self.academic_year_end <= self.academic_year_start:
            raise ValueError("Academic year end must be after its start")
        return self


def default_assignment_monitoring_settings(today: date | None = None) -> dict:
    today = today or date.today()
    start_year = today.year if today.month >= 7 else today.year - 1
    return {
        "missed_rate_threshold_percent": 25.0,
        "academic_year_start": date(start_year, 7, 1).isoformat(),
        "academic_year_end": date(start_year + 1, 6, 30).isoformat(),
    }


def read_assignment_monitoring_settings(db) -> dict:
    """Sync variant — kept for `routes_fastapi/admin/users.py`, which is not
    yet ported (it's coupled to the still-sync `admin_helpers.py`/
    `routes_fastapi/assignments/`) and still calls this with a sync `Session`.
    Do not delete until every sync caller of this function is gone; see
    `read_assignment_monitoring_settings_async` below for the async route
    path added in Sprint 2."""
    row = db.query(AppSetting).filter_by(setting_type=MONITORING_SETTING_TYPE).first()
    return {**default_assignment_monitoring_settings(), **(row.payload if row else {})}


async def read_assignment_monitoring_settings_async(db: AsyncSession) -> dict:
    row = (await db.scalars(select(AppSetting).where(AppSetting.setting_type == MONITORING_SETTING_TYPE))).first()
    return {**default_assignment_monitoring_settings(), **(row.payload if row else {})}


@router.get("/settings/assignment-monitoring")
async def get_assignment_monitoring_settings(principal=Depends(require(Permission.SETTINGS_MANAGE)), db: AsyncSession = Depends(db_session)):
    del principal
    return {"settings": await read_assignment_monitoring_settings_async(db)}


@router.put("/settings/assignment-monitoring")
async def update_assignment_monitoring_settings(
    body: AssignmentMonitoringSettings,
    request: Request,
    principal=Depends(require(Permission.SETTINGS_MANAGE)),
    db: AsyncSession = Depends(db_session),
):
    if body.academic_year_end <= body.academic_year_start:
        raise HTTPException(400, "Academic year end must be after its start")
    previous = await read_assignment_monitoring_settings_async(db)
    payload = {
        "missed_rate_threshold_percent": body.missed_rate_threshold_percent,
        "academic_year_start": body.academic_year_start.isoformat(),
        "academic_year_end": body.academic_year_end.isoformat(),
    }
    row = (await db.scalars(select(AppSetting).where(AppSetting.setting_type == MONITORING_SETTING_TYPE))).first()
    if row:
        row.payload = payload
    else:
        db.add(AppSetting(setting_type=MONITORING_SETTING_TYPE, payload=payload))
    await db.flush()
    # Audit writes share the request's async transaction.
    # self-contained pattern as services left untouched elsewhere in Sprint 2,
    # e.g. session_service/user_service) — a short blocking call inside this
    # async route, not yet worth a dedicated async audit-log path on its own.
    await write_audit_log(
        db,
        principal.user_id,
        "Settings updated",
        None,
        {"setting": MONITORING_SETTING_TYPE, "before": previous, "after": payload},
        request.client.host if request.client else None,
    )
    return {"message": "Assignment monitoring settings updated", "settings": payload}


@router.get("/audit-log")
async def fastapi_get_audit_log(
    principal=Depends(require(Permission.AUDIT_VIEW)),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=10, le=100, description="Items per page"),
    action: str | None = None,
    actor_id: str | None = None,
    target_id: str | None = None,
    from_at: datetime | None = Query(None, alias="from"),
    to_at: datetime | None = Query(None, alias="to"),
    db: AsyncSession = Depends(db_session),
):
    del principal
    return await get_audit_logs(db, page=page, per_page=per_page, action=action, actor_id=actor_id, target_id=target_id, from_at=from_at, to_at=to_at)
