"""Add the Postgres-backed ``jobs`` queue (Sprint 2, S2-01).

Purely additive (expand step): the previous app version ignores the table.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "canvasgrade_025"
down_revision = "canvasgrade_024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "jobs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("type", sa.String(100), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("run_after", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("locked_by", sa.String(100), nullable=True),
        sa.Column("locked_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("status IN ('queued','running','succeeded','failed','dead')", name="ck_jobs_status"),
    )
    op.create_index("ix_jobs_claim", "jobs", ["status", "run_after"])
    op.create_index("ix_jobs_type_status", "jobs", ["type", "status"])


def downgrade() -> None:
    op.drop_index("ix_jobs_type_status", table_name="jobs")
    op.drop_index("ix_jobs_claim", table_name="jobs")
    op.drop_table("jobs")
