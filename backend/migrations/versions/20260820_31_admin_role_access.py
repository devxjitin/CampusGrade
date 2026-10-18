"""Replace the fixed `program_admin` role with `admin` accounts whose access a Super Admin sets.

- `users.role` 'program_admin' becomes 'admin' (the CHECK constraint is rebuilt).
- New `admin_access` table: one (user, resource, level) row per resource an admin may use.
- Existing program admins keep exactly what they could do before, as grants: full access to
  batches, sections, subjects, users and assignments, and view access to the audit log.
  Program scoping is gone, so they now see every program (admin_program_scopes is left in
  place but no longer read).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "canvasgrade_031"
down_revision = "canvasgrade_030"
branch_labels = None
depends_on = None

_DEFAULT_GRANTS = (
    ("batches", "full"),
    ("sections", "full"),
    ("subjects", "full"),
    ("users", "full"),
    ("assignments", "full"),
    ("audit_log", "view"),
)


def upgrade() -> None:
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS admin_access ("
        "user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
        "resource VARCHAR(40) NOT NULL, "
        "level VARCHAR(10) NOT NULL, "
        "PRIMARY KEY (user_id, resource), "
        "CONSTRAINT ck_admin_access_level CHECK (level IN ('view','edit','full')))"
    ))
    op.execute(sa.text("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role"))
    op.execute(sa.text("UPDATE users SET role = 'admin' WHERE role = 'program_admin'"))
    op.execute(sa.text("ALTER TABLE users ADD CONSTRAINT ck_users_role CHECK (role IN ('super_admin','admin','teacher','student'))"))
    for resource, level in _DEFAULT_GRANTS:
        op.execute(sa.text(
            "INSERT INTO admin_access (user_id, resource, level) "
            f"SELECT id, '{resource}', '{level}' FROM users WHERE role = 'admin' "
            "ON CONFLICT (user_id, resource) DO NOTHING"
        ))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role"))
    op.execute(sa.text("UPDATE users SET role = 'program_admin' WHERE role = 'admin'"))
    op.execute(sa.text("ALTER TABLE users ADD CONSTRAINT ck_users_role CHECK (role IN ('super_admin','program_admin','teacher','student'))"))
    op.execute(sa.text("DROP TABLE IF EXISTS admin_access"))
