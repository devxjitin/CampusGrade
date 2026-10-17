"""Add shared rate-limit counters (Sprint 2, S2-08).

Additive (expand step); replaces the per-process in-memory limiter.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "canvasgrade_026"
down_revision = "canvasgrade_025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_counters",
        sa.Column("key", sa.String(200), nullable=False),
        sa.Column("window_id", sa.BigInteger(), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key", "window_id", name="pk_rate_limit_counters"),
    )
    op.create_index("ix_rate_limit_counters_expires_at", "rate_limit_counters", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_rate_limit_counters_expires_at", table_name="rate_limit_counters")
    op.drop_table("rate_limit_counters")
