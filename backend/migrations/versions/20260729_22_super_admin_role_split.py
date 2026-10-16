"""Four roles go live (Sprint 5, IMPLEMENTATION_PLAN.md).

Every existing `admin` becomes a `super_admin` — deliberate, so nobody loses
access on deploy day. `program_admin` accounts are created afterwards by
hand (via the new `/admin/admins` endpoints this sprint also adds) and
scoped via `admin_program_scopes` (Sprint 4).

`role` is `String(20)`, not a Postgres enum, so widening the allowed values
is a plain `UPDATE` plus a `CHECK` constraint — no `ALTER TYPE` dance.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "canvasgrade_022"
down_revision = "canvasgrade_021"
branch_labels = None
depends_on = None

_CHECK_NAME = "ck_users_role"
_ALLOWED_ROLES = "role IN ('super_admin','program_admin','teacher','student')"


def upgrade() -> None:
    op.execute("UPDATE users SET role = 'super_admin' WHERE role = 'admin'")
    inspector = sa.inspect(op.get_bind())
    existing_checks = {check["name"] for check in inspector.get_check_constraints("users")}
    if _CHECK_NAME not in existing_checks:
        op.create_check_constraint(_CHECK_NAME, "users", _ALLOWED_ROLES)


def downgrade() -> None:
    op.drop_constraint(_CHECK_NAME, "users", type_="check")
    op.execute("UPDATE users SET role = 'admin' WHERE role IN ('super_admin', 'program_admin')")
