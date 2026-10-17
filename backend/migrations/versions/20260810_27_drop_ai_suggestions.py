"""drop assignment_ai_suggestions (in-app AI suggestions were removed)

Revision ID: canvasgrade_027
Revises: canvasgrade_026
"""

from alembic import op

revision = "canvasgrade_027"
down_revision = "canvasgrade_026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS assignment_ai_suggestions")


def downgrade() -> None:
    # Intentionally a no-op: the feature and its model are gone, so recreating the
    # empty table would only block the baseline migration's table drops. The data
    # is not recoverable by a downgrade; restore a backup if it is needed.
    pass
