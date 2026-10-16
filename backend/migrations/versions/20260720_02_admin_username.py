"""Add username-based login to CanvasGrade."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "canvasgrade_002"
down_revision = "canvasgrade_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("users")}
    indexes = {index["name"] for index in inspect(bind).get_indexes("users")}
    if "username" not in columns:
        op.add_column("users", sa.Column("username", sa.String(length=64), nullable=True))
    if "ix_users_username" not in indexes:
        op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    indexes = {index["name"] for index in inspect(bind).get_indexes("users")}
    columns = {column["name"] for column in inspect(bind).get_columns("users")}
    if "ix_users_username" in indexes:
        op.drop_index("ix_users_username", table_name="users")
    if "username" in columns:
        op.drop_column("users", "username")
