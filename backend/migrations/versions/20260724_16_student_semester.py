"""Add nullable semester column to users (students)."""

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_016"
down_revision = "canvasgrade_015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {c["name"] for c in inspector.get_columns("users")}
    if "semester" not in existing:
        op.add_column("users", sa.Column("semester", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "semester")
