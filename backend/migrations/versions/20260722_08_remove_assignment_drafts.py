"""Remove the persisted assignment draft workflow."""

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_008"
down_revision = "canvasgrade_007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Completed historic drafts remain available; incomplete ones are retained
    # for governance in an archived state rather than appearing as editable drafts.
    op.execute(
        sa.text(
            """
            UPDATE assignments
            SET status = CASE
                WHEN title <> ''
                    AND instructions <> ''
                    AND subject_id IS NOT NULL
                    AND target_course_id IS NOT NULL
                    AND target_batch_id IS NOT NULL
                    AND target_section_id IS NOT NULL
                    AND due_at IS NOT NULL
                THEN 'published'
                ELSE 'archived'
            END
            WHERE status = 'draft'
            """
        )
    )
    op.alter_column("assignments", "status", server_default="published")


def downgrade() -> None:
    op.alter_column("assignments", "status", server_default="draft")
