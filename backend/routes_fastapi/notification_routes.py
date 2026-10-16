import datetime

from core.db import db_session
from fastapi import APIRouter, Depends, HTTPException, Query
from models.notification import SqlNotification
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from routes_fastapi.deps import get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_items(
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
    unread_only: bool = False,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(db_session),
):
    base = select(SqlNotification).where(SqlNotification.user_id == user["_id"])
    unread_count = (
        await db.scalar(select(func.count()).select_from(base.where(SqlNotification.is_read.is_(False)).subquery()))
    ) or 0
    filtered = base.where(SqlNotification.is_read.is_(False)) if unread_only else base
    total = (await db.scalar(select(func.count()).select_from(filtered.subquery()))) or 0
    rows = (
        await db.scalars(filtered.order_by(SqlNotification.created_at.desc()).offset((page - 1) * per_page).limit(per_page))
    ).all()
    return {
        "notifications": [
            {
                "id": x.id, "type": x.type, "title": x.title, "message": x.message,
                "action_url": x.action_url, "metadata": x.metadata_json or {},
                "is_read": x.is_read, "read_at": x.read_at, "created_at": x.created_at,
            }
            for x in rows
        ],
        "unread_count": unread_count,
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.patch("/{notification_id}/read")
async def mark_read(notification_id: str, user=Depends(get_current_user), db: AsyncSession = Depends(db_session)):
    item = (
        await db.scalars(select(SqlNotification).where(SqlNotification.id == notification_id, SqlNotification.user_id == user["_id"]))
    ).first()
    if not item:
        raise HTTPException(404, "Notification not found")
    if not item.is_read:
        item.is_read = True
        item.read_at = datetime.datetime.utcnow()
    # No explicit commit — db_session (core/db.py -> models.database.get_db)
    # commits once, on clean generator teardown, for the whole request.
    return {"message": "Notification marked as read"}


@router.post("/mark-all-read")
async def mark_all(user=Depends(get_current_user), db: AsyncSession = Depends(db_session)):
    result = await db.execute(
        update(SqlNotification)
        .where(SqlNotification.user_id == user["_id"], SqlNotification.is_read.is_(False))
        .values(is_read=True, read_at=datetime.datetime.utcnow())
    )
    return {"message": "Notifications marked as read", "updated": result.rowcount}


@router.delete("/{notification_id}")
async def delete_item(notification_id: str, user=Depends(get_current_user), db: AsyncSession = Depends(db_session)):
    item = (
        await db.scalars(select(SqlNotification).where(SqlNotification.id == notification_id, SqlNotification.user_id == user["_id"]))
    ).first()
    if not item:
        raise HTTPException(404, "Notification not found")
    await db.delete(item)
    return {"message": "Notification deleted"}
