"""Add student_session_records + rollover_runs tables, extend batches and
academic_sessions with lifecycle columns, and backfill a student_session_record
for every existing student against the current academic session.

See PLAN_ACADEMIC_SESSIONS_AND_BATCHES.md Part 1 / Part 5 / Phase 1.
"""

import uuid
from datetime import date, datetime, UTC

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_018"
down_revision = "canvasgrade_017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    batches_columns = {column["name"] for column in inspector.get_columns("batches")}
    if "status" not in batches_columns:
        op.add_column("batches", sa.Column("status", sa.String(length=20), nullable=False, server_default="active"))
    if "auto_created" not in batches_columns:
        op.add_column("batches", sa.Column("auto_created", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "intake_open" not in batches_columns:
        op.add_column("batches", sa.Column("intake_open", sa.Boolean(), nullable=False, server_default=sa.true()))
    academic_sessions_columns = {column["name"] for column in inspector.get_columns("academic_sessions")}
    if "status" not in academic_sessions_columns:
        op.add_column("academic_sessions", sa.Column("status", sa.String(length=20), nullable=False, server_default="upcoming"))

    existing_tables = set(inspector.get_table_names())

    if "rollover_runs" not in existing_tables:
        op.create_table(
            "rollover_runs",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("from_session_id", sa.String(length=64), sa.ForeignKey("academic_sessions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("to_session_id", sa.String(length=64), sa.ForeignKey("academic_sessions.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("executed_by", sa.String(length=64), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("executed_at", sa.DateTime(), nullable=False),
            sa.Column("counts", sa.JSON(), nullable=False),
            sa.Column("undone_at", sa.DateTime(), nullable=True),
        )

    if "student_session_records" not in existing_tables:
        op.create_table(
            "student_session_records",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("student_id", sa.String(length=64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("session_id", sa.String(length=64), sa.ForeignKey("academic_sessions.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("batch_id", sa.String(length=64), sa.ForeignKey("batches.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("section_id", sa.String(length=64), sa.ForeignKey("sections.id", ondelete="SET NULL"), nullable=True),
            sa.Column("study_year", sa.Integer(), nullable=True),
            sa.Column("semester", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("is_override", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("rollover_run_id", sa.String(length=64), sa.ForeignKey("rollover_runs.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("student_id", "session_id", name="uq_student_session_record"),
        )

    connection = op.get_bind()
    now = datetime.now(UTC).replace(tzinfo=None)

    current_session = connection.execute(
        sa.text("SELECT id, label, term FROM academic_sessions WHERE is_current = true ORDER BY start_date DESC LIMIT 1")
    ).first()
    if current_session:
        connection.execute(sa.text("UPDATE academic_sessions SET status = 'active' WHERE id = :id"), {"id": current_session[0]})
        session_start_year = int(str(current_session[1]).split("-")[0])
        term = current_session[2]

        students = connection.execute(
            sa.text("SELECT id, batch_id, section_id, year, semester FROM users WHERE role = 'student'")
        ).fetchall()
        batches = {row[0]: row[1] for row in connection.execute(sa.text("SELECT id, start_year FROM batches")).fetchall()}

        session_records_table = sa.table(
            "student_session_records",
            sa.column("id", sa.String()),
            sa.column("student_id", sa.String()),
            sa.column("session_id", sa.String()),
            sa.column("batch_id", sa.String()),
            sa.column("section_id", sa.String()),
            sa.column("study_year", sa.Integer()),
            sa.column("semester", sa.Integer()),
            sa.column("status", sa.String()),
            sa.column("is_override", sa.Boolean()),
            sa.column("created_at", sa.DateTime()),
            sa.column("updated_at", sa.DateTime()),
        )
        rows = []
        for student_id, batch_id, section_id, year, semester in students:
            derived_year, derived_semester = year, semester
            if batch_id and batch_id in batches:
                years_elapsed = session_start_year - batches[batch_id]
                study_year = years_elapsed + 1
                if study_year >= 1:
                    derived_year = derived_year or study_year
                    derived_semester = derived_semester or (2 * study_year - 1 if term == "odd" else 2 * study_year)
            rows.append(
                {
                    "id": str(uuid.uuid4()),
                    "student_id": student_id,
                    "session_id": current_session[0],
                    "batch_id": batch_id,
                    "section_id": section_id,
                    "study_year": derived_year,
                    "semester": derived_semester,
                    "status": "active",
                    "is_override": False,
                    "created_at": now,
                    "updated_at": now,
                }
            )
        if rows:
            op.bulk_insert(session_records_table, rows)


def downgrade() -> None:
    op.drop_table("student_session_records")
    op.drop_table("rollover_runs")
    op.drop_column("academic_sessions", "status")
    op.drop_column("batches", "intake_open")
    op.drop_column("batches", "auto_created")
    op.drop_column("batches", "status")
