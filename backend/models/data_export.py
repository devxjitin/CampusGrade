import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from models.database import Base
from models.sql_models import utcnow

EXPORT_QUEUED = "queued"
EXPORT_READY = "ready"
EXPORT_FAILED = "failed"


class SqlDataExport(Base):
    """A Super Admin export of one academic session (grades + audit log), built by the worker."""

    __tablename__ = "data_exports"
    __table_args__ = (CheckConstraint("status IN ('queued','ready','failed')", name="ck_data_exports_status"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("academic_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=EXPORT_QUEUED)
    object_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, index=True)
    finished_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
