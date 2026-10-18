"""Tag auto-created subject enrollments with the rollover run that made them.

Additive (expand step): the column is nullable, so the previous app version keeps working.
Undoing a rollover can now remove exactly the enrollments that run created instead of
every enrollment in the session. Rows from earlier runs stay untagged (and are left alone).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "canvasgrade_030"
down_revision = "canvasgrade_029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: the baseline migration builds tables from the current models, so a
    # fresh database may already have the column and index.
    op.execute(sa.text("ALTER TABLE student_subject_enrollments ADD COLUMN IF NOT EXISTS rollover_run_id VARCHAR(64)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_student_subject_enrollments_rollover_run_id ON student_subject_enrollments (rollover_run_id)"))


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_student_subject_enrollments_rollover_run_id"))
    op.execute(sa.text("ALTER TABLE student_subject_enrollments DROP COLUMN IF EXISTS rollover_run_id"))
