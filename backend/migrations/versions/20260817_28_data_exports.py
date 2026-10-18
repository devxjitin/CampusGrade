"""Add data_exports (Sprint 5, S5-04): Super Admin exports of a session's grades and audit log.

Additive (expand step).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "canvasgrade_028"
down_revision = "canvasgrade_027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "data_exports",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("session_id", sa.String(64), sa.ForeignKey("academic_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requested_by", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("object_key", sa.String(500), nullable=True),
        sa.Column("filename", sa.String(255), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("status IN ('queued','ready','failed')", name="ck_data_exports_status"),
    )
    op.create_index("ix_data_exports_session_id", "data_exports", ["session_id"])
    op.create_index("ix_data_exports_created_at", "data_exports", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_data_exports_created_at", table_name="data_exports")
    op.drop_index("ix_data_exports_session_id", table_name="data_exports")
    op.drop_table("data_exports")
