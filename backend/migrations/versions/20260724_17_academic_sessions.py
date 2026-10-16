"""Add academic_sessions table (Option A reporting-session switcher) and seed one current session from existing settings."""

import uuid
from datetime import date, datetime, UTC

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_017"
down_revision = "canvasgrade_016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    # On a fresh install, canvasgrade_001 (baseline) already created this table from the current
    # model metadata, since assignments.session_id has a foreign key to it. On a database that
    # predates that baseline change, this table won't exist yet, so create it here as before.
    if "academic_sessions" not in inspector.get_table_names():
        op.create_table(
            "academic_sessions",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("label", sa.String(length=50), nullable=False),
            sa.Column("term", sa.String(length=10), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("label", "term", name="uq_academic_sessions_label_term"),
        )

    settings_row = connection.execute(sa.text("SELECT payload FROM app_settings WHERE setting_type = 'assignment_monitoring'")).first()
    if settings_row and settings_row[0]:
        payload = settings_row[0]
        start = date.fromisoformat(payload["academic_year_start"])
        end = date.fromisoformat(payload["academic_year_end"])
    else:
        today = date.today()
        start_year = today.year if today.month >= 7 else today.year - 1
        start = date(start_year, 7, 1)
        end = date(start_year + 1, 6, 30)

    label = f"{start.year}-{end.year}"
    # July-December is the "Odd" semester, January-June the "Even" semester
    # at a typical July-starting Indian academic calendar.
    mid = date(start.year, 12, 31)
    sessions_table = sa.table(
        "academic_sessions",
        sa.column("id", sa.String()),
        sa.column("label", sa.String()),
        sa.column("term", sa.String()),
        sa.column("start_date", sa.Date()),
        sa.column("end_date", sa.Date()),
        sa.column("is_current", sa.Boolean()),
        sa.column("status", sa.String()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    # "status" is a plain not-null column with a Python-side (not DB-side) default
    # on the model, and canvasgrade_018 is what normally adds this column via
    # op.add_column — but on a fresh install the baseline already creates it as
    # NOT NULL from current model metadata, so this raw bulk_insert must supply
    # an explicit value or the insert violates the not-null constraint.
    now = datetime.now(UTC).replace(tzinfo=None)
    odd_is_current = start <= date.today() <= mid
    even_is_current = date(end.year, 1, 1) <= date.today() <= end
    op.bulk_insert(sessions_table, [
        {
            "id": str(uuid.uuid4()),
            "label": label,
            "term": "odd",
            "start_date": start,
            "end_date": mid,
            "is_current": odd_is_current,
            "status": "active" if odd_is_current else "upcoming",
            "created_at": now,
            "updated_at": now,
        },
        {
            "id": str(uuid.uuid4()),
            "label": label,
            "term": "even",
            "start_date": date(end.year, 1, 1),
            "end_date": end,
            "is_current": even_is_current,
            "status": "active" if even_is_current else "upcoming",
            "created_at": now,
            "updated_at": now,
        },
    ])


def downgrade() -> None:
    op.drop_table("academic_sessions")
