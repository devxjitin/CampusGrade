"""Add teacher decisions to repository similarity evidence."""

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_010"
down_revision = "canvasgrade_009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("assignment_duplicate_flags")}
    for column in (
        sa.Column("review_status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("reviewed_by", sa.String(length=64), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("review_notes", sa.Text(), nullable=True),
    ):
        if column.name not in columns:
            op.add_column("assignment_duplicate_flags", column)
    foreign_keys = {tuple(item["constrained_columns"]) for item in inspector.get_foreign_keys("assignment_duplicate_flags")}
    if ("reviewed_by",) not in foreign_keys:
        op.create_foreign_key("fk_assignment_duplicate_flags_reviewed_by", "assignment_duplicate_flags", "users", ["reviewed_by"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE assignment_duplicate_flags DROP CONSTRAINT IF EXISTS fk_assignment_duplicate_flags_reviewed_by")
    op.drop_column("assignment_duplicate_flags", "review_notes")
    op.drop_column("assignment_duplicate_flags", "reviewed_at")
    op.drop_column("assignment_duplicate_flags", "reviewed_by")
    op.drop_column("assignment_duplicate_flags", "review_status")
