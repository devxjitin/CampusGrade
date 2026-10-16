"""Apply the code-similarity mark cap as a system decision."""

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_011"
down_revision = "canvasgrade_010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        UPDATE assignment_duplicate_flags
        SET reviewed = TRUE,
            review_status = 'confirmed',
            reviewed_by = NULL,
            reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
            review_notes = 'Automatic 50% mark limit applied by CanvasGrade.'
        WHERE flag_type = 'code_similarity' AND similarity > 0.70
    """))


def downgrade() -> None:
    op.execute(sa.text("""
        UPDATE assignment_duplicate_flags
        SET reviewed = FALSE,
            review_status = 'pending',
            reviewed_by = NULL,
            reviewed_at = NULL,
            review_notes = NULL
        WHERE flag_type = 'code_similarity' AND similarity > 0.70
    """))
