"""Seed institution-wide assignment monitoring settings."""

from datetime import date, datetime, UTC

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_015"
down_revision = "canvasgrade_014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    exists = connection.execute(sa.text("SELECT 1 FROM app_settings WHERE setting_type = 'assignment_monitoring'")).first()
    if exists:
        return
    today = date.today()
    start_year = today.year if today.month >= 7 else today.year - 1
    settings = sa.table(
        "app_settings",
        sa.column("setting_type", sa.String()),
        sa.column("payload", sa.JSON()),
        sa.column("updated_at", sa.DateTime()),
    )
    op.bulk_insert(settings, [{
        "setting_type": "assignment_monitoring",
        "payload": {
            "missed_rate_threshold_percent": 25.0,
            "academic_year_start": date(start_year, 7, 1).isoformat(),
            "academic_year_end": date(start_year + 1, 6, 30).isoformat(),
        },
        "updated_at": datetime.now(UTC).replace(tzinfo=None),
    }])


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM app_settings WHERE setting_type = 'assignment_monitoring'"))
