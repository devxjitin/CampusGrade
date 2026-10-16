"""Add controlled repository evaluation state and frozen cohorts."""

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_007"
down_revision = "canvasgrade_006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    assignment_columns = {column["name"] for column in inspector.get_columns("assignments")}
    for column in (
        sa.Column("evaluation_locked_at", sa.DateTime(), nullable=True),
        sa.Column("evaluation_locked_by", sa.String(length=64), nullable=True),
        sa.Column("evaluation_lock_trigger", sa.String(length=30), nullable=True),
        sa.Column("repository_fetch_started_at", sa.DateTime(), nullable=True),
        sa.Column("repository_fetch_started_by", sa.String(length=64), nullable=True),
        sa.Column("repository_fetch_completed_at", sa.DateTime(), nullable=True),
    ):
        if column.name not in assignment_columns:
            op.add_column("assignments", column)
    foreign_keys = {tuple(item["constrained_columns"]) for item in inspector.get_foreign_keys("assignments")}
    if ("evaluation_locked_by",) not in foreign_keys:
        op.create_foreign_key("fk_assignments_evaluation_locked_by", "assignments", "users", ["evaluation_locked_by"], ["id"], ondelete="SET NULL")
    if ("repository_fetch_started_by",) not in foreign_keys:
        op.create_foreign_key("fk_assignments_repository_fetch_started_by", "assignments", "users", ["repository_fetch_started_by"], ["id"], ondelete="SET NULL")
    indexes = {item["name"] for item in inspector.get_indexes("assignments")}
    for name, column in (
        ("ix_assignments_evaluation_locked_at", "evaluation_locked_at"),
        ("ix_assignments_repository_fetch_started_at", "repository_fetch_started_at"),
        ("ix_assignments_repository_fetch_completed_at", "repository_fetch_completed_at"),
    ):
        if name not in indexes:
            op.create_index(name, "assignments", [column])
    if "assignment_evaluation_participants" not in inspector.get_table_names():
        op.create_table(
            "assignment_evaluation_participants",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("assignment_id", sa.String(length=64), sa.ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False),
            sa.Column("student_id", sa.String(length=64), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("submission_version_id", sa.String(length=64), sa.ForeignKey("assignment_submission_versions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="submitted"),
            sa.Column("locked_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("assignment_id", "student_id", name="uq_assignment_evaluation_participant"),
        )
        op.create_index("ix_assignment_evaluation_participants_assignment_id", "assignment_evaluation_participants", ["assignment_id"])
        op.create_index("ix_assignment_evaluation_participants_student_id", "assignment_evaluation_participants", ["student_id"])
        op.create_index("ix_assignment_evaluation_participants_submission_version_id", "assignment_evaluation_participants", ["submission_version_id"])
        op.create_index("ix_assignment_evaluation_participants_status", "assignment_evaluation_participants", ["status"])


def downgrade() -> None:
    op.drop_table("assignment_evaluation_participants")
    op.drop_index("ix_assignments_repository_fetch_completed_at", table_name="assignments")
    op.drop_index("ix_assignments_repository_fetch_started_at", table_name="assignments")
    op.drop_index("ix_assignments_evaluation_locked_at", table_name="assignments")
    op.drop_constraint("fk_assignments_repository_fetch_started_by", "assignments", type_="foreignkey")
    op.drop_constraint("fk_assignments_evaluation_locked_by", "assignments", type_="foreignkey")
    op.drop_column("assignments", "repository_fetch_completed_at")
    op.drop_column("assignments", "repository_fetch_started_by")
    op.drop_column("assignments", "repository_fetch_started_at")
    op.drop_column("assignments", "evaluation_lock_trigger")
    op.drop_column("assignments", "evaluation_locked_by")
    op.drop_column("assignments", "evaluation_locked_at")
