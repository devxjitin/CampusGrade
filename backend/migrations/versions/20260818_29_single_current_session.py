"""At most one current academic session, enforced by the database.

Until now only application code kept academic_sessions.is_current unique. A partial
unique index makes a second current session impossible, even with concurrent requests.
Any existing duplicates are resolved first (the latest start_date stays current).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "canvasgrade_029"
down_revision = "canvasgrade_028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE academic_sessions SET is_current = false WHERE is_current = true AND id <> ("
            "SELECT id FROM academic_sessions WHERE is_current = true ORDER BY start_date DESC, id DESC LIMIT 1)"
        )
    )
    # IF NOT EXISTS: the baseline migration builds tables from the current models, so a
    # fresh database may already have this index.
    op.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_sessions_single_current ON academic_sessions (is_current) WHERE is_current"))


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS uq_academic_sessions_single_current"))
