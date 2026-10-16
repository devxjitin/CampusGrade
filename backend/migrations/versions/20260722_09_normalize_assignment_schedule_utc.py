"""Normalize assignment schedule values from Asia/Kolkata wall time to UTC."""

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_009"
down_revision = "canvasgrade_008"
branch_labels = None
depends_on = None


SCHEDULE_COLUMNS = ("opens_at", "due_at", "late_until", "result_release_at")


def _convert(source_timezone: str, target_timezone: str) -> None:
    for column in SCHEDULE_COLUMNS:
        op.execute(
            sa.text(
                f"""
                UPDATE assignments
                SET {column} = ({column} AT TIME ZONE :source_timezone)
                    AT TIME ZONE :target_timezone
                WHERE {column} IS NOT NULL
                """
            ).bindparams(
                source_timezone=source_timezone,
                target_timezone=target_timezone,
            )
        )


def upgrade() -> None:
    _convert("Asia/Kolkata", "UTC")


def downgrade() -> None:
    _convert("UTC", "Asia/Kolkata")
