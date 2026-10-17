"""drop assignment_ai_suggestions (in-app AI suggestions were removed)

Revision ID: canvasgrade_027
Revises: canvasgrade_026
"""

import sqlalchemy as sa
from alembic import op

revision = "canvasgrade_027"
down_revision = "canvasgrade_026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS assignment_ai_suggestions")


def downgrade() -> None:
    op.create_table(
        "assignment_ai_suggestions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("assignment_id", sa.String(64), sa.ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("submission_version_id", sa.String(64), sa.ForeignKey("assignment_submission_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requested_by", sa.String(64), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("rubric_scores", sa.JSON, nullable=True),
        sa.Column("feedback", sa.Text, nullable=True),
        sa.Column("evidence", sa.JSON, nullable=True),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column("model_name", sa.String(100), nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("assignment_id", "student_id", "submission_version_id", name="uq_assignment_ai_suggestion_version"),
    )
    op.create_index("ix_assignment_ai_suggestions_assignment_id", "assignment_ai_suggestions", ["assignment_id"])
    op.create_index("ix_assignment_ai_suggestions_student_id", "assignment_ai_suggestions", ["student_id"])
    op.create_index("ix_assignment_ai_suggestions_status", "assignment_ai_suggestions", ["status"])
