"""Remove the final copied biometric setting from CanvasGrade.

Revision ID: canvasgrade_003
Revises: canvasgrade_002
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "canvasgrade_003"
down_revision = "canvasgrade_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "face_encoding" in columns:
        op.drop_column("users", "face_encoding")
    op.execute("DELETE FROM app_settings WHERE setting_type = 'ai_config'")


def downgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "face_encoding" not in columns:
        op.add_column("users", sa.Column("face_encoding", sa.JSON(), nullable=True))
