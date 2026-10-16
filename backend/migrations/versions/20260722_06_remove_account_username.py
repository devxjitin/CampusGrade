"""Remove username authentication in favour of email-only sign-in.

Revision ID: canvasgrade_006
Revises: canvasgrade_005
"""
from alembic import op
from sqlalchemy import inspect

revision = "canvasgrade_006"
down_revision = "canvasgrade_005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("users")}
    indexes = {index["name"] for index in inspector.get_indexes("users")}
    if "ix_users_username" in indexes:
        op.drop_index("ix_users_username", table_name="users")
    if "username" in columns:
        op.drop_column("users", "username")


def downgrade() -> None:
    pass
