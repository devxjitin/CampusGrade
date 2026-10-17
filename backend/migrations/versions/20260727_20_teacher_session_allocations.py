"""Add teacher_session_allocations table (Phase 6).

users.assignments (a JSON blob) stays the source every existing screen
reads from; this table is a session-aware mirror the rollover engine can
carry forward, and a future release can migrate reads onto. Backfills one
row per existing teacher allocation entry against the current session.

See the original academic-sessions plan Phase 6.
"""

import uuid
from datetime import datetime, UTC

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_020"
down_revision = "canvasgrade_019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "teacher_session_allocations" not in inspector.get_table_names():
        op.create_table(
            "teacher_session_allocations",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("teacher_id", sa.String(length=64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("session_id", sa.String(length=64), sa.ForeignKey("academic_sessions.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("department_id", sa.String(length=64), sa.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
            sa.Column("program_id", sa.String(length=64), sa.ForeignKey("courses.id", ondelete="SET NULL"), nullable=True),
            sa.Column("batch_id", sa.String(length=64), sa.ForeignKey("batches.id", ondelete="SET NULL"), nullable=True),
            sa.Column("section_id", sa.String(length=64), sa.ForeignKey("sections.id", ondelete="SET NULL"), nullable=True),
            sa.Column("subject_ids", sa.JSON(), nullable=False),
            sa.Column("rollover_run_id", sa.String(length=64), sa.ForeignKey("rollover_runs.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )

    connection = op.get_bind()
    current_session = connection.execute(
        sa.text("SELECT id FROM academic_sessions WHERE is_current = true ORDER BY start_date DESC LIMIT 1")
    ).first()
    if not current_session:
        return

    teachers = connection.execute(sa.text("SELECT id, assignments FROM users WHERE role = 'teacher' AND assignments IS NOT NULL")).fetchall()
    allocations_table = sa.table(
        "teacher_session_allocations",
        sa.column("id", sa.String()),
        sa.column("teacher_id", sa.String()),
        sa.column("session_id", sa.String()),
        sa.column("department_id", sa.String()),
        sa.column("program_id", sa.String()),
        sa.column("batch_id", sa.String()),
        sa.column("section_id", sa.String()),
        sa.column("subject_ids", sa.JSON()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    rows = []
    for teacher_id, assignments in teachers:
        for allocation in assignments or []:
            if not isinstance(allocation, dict):
                continue
            rows.append(
                {
                    "id": str(uuid.uuid4()),
                    "teacher_id": teacher_id,
                    "session_id": current_session[0],
                    "department_id": allocation.get("department_id"),
                    "program_id": allocation.get("program_id"),
                    "batch_id": allocation.get("batch_id"),
                    "section_id": allocation.get("section_id"),
                    "subject_ids": allocation.get("subject_ids") or [],
                    "created_at": now,
                    "updated_at": now,
                }
            )
    if rows:
        op.bulk_insert(allocations_table, rows)


def downgrade() -> None:
    op.drop_table("teacher_session_allocations")
