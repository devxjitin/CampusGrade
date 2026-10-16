import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from models.database import Base
from models.sql_models import utcnow


class SqlUserPreference(Base):
    """Durable per-user application preferences.

    Notification categories intentionally live in JSON: the UI can show a
    relevant subset for each role while the stored schema stays forward
    compatible.
    """

    __tablename__ = "user_preferences"

    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    notification_preferences: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    schema_version: Mapped[int] = mapped_column(nullable=False, default=1)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)
