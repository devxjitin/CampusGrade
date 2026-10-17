"""Remove passwords: sign-in is by email only.

Drops `users.password`, `users.must_change_password`, `users.login_attempts` and
`users.locked_until`, and the `password_reset_tokens` table. This cannot be undone:
the downgrade restores the empty columns/table, not the old password hashes.

The previous app version still reads these columns, so deploy this only together with the
release that no longer does.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "canvasgrade_032"
down_revision = "canvasgrade_031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS password_reset_tokens"))
    for column in ("password", "must_change_password", "login_attempts", "locked_until"):
        op.execute(sa.text(f"ALTER TABLE users DROP COLUMN IF EXISTS {column}"))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password VARCHAR(255) NOT NULL DEFAULT ''"))
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false"))
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS login_attempts INTEGER NOT NULL DEFAULT 0"))
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP"))
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS password_reset_tokens ("
        "id VARCHAR(64) PRIMARY KEY, "
        "user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
        "token_hash VARCHAR(64) NOT NULL UNIQUE, "
        "expires_at TIMESTAMP NOT NULL, used_at TIMESTAMP, created_at TIMESTAMP NOT NULL)"
    ))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_user_id ON password_reset_tokens (user_id)"))
