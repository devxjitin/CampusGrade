"""Remove discontinued LinkedIn and skills profile fields.

Revision ID: canvasgrade_005
Revises: canvasgrade_004
"""
from alembic import op
from sqlalchemy import inspect

revision = "canvasgrade_005"
down_revision = "canvasgrade_004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    for column in ("skills", "linkedin_url"):
        if column in columns:
            op.drop_column("users", column)


def downgrade() -> None:
    # These optional fields are intentionally not restored on downgrade.
    pass
