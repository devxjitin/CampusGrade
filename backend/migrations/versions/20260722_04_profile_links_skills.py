"""Add LeetCode profile handle.

Revision ID: canvasgrade_004
Revises: canvasgrade_003
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "canvasgrade_004"
down_revision = "canvasgrade_003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "leetcode_username" not in columns:
        op.add_column("users", sa.Column("leetcode_username", sa.String(length=100), nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "leetcode_username" in columns:
        op.drop_column("users", "leetcode_username")
