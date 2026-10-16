"""Rename courses to programs and remove single-school lookup tables.

Sprint 8 of IMPLEMENTATION_PLAN.md. Foreign-key *column names* such as
``course_id`` intentionally remain unchanged until the Sprint 9 contract
migration, but their referenced table follows PostgreSQL's table rename.

The plan predates ``teacher_session_allocations.department_id``; that column
is included here so no live foreign key can keep ``departments`` alive.
"""

from __future__ import annotations

import datetime

import sqlalchemy as sa
from alembic import op

revision = "canvasgrade_024"
down_revision = "canvasgrade_022"
branch_labels = None
depends_on = None

_SOET_ID = "school-of-engineering-and-technology"
_SOET_NAME = "School of Engineering and Technology"


def assert_single_department(connection) -> None:
    """Abort before destructive DDL if production contains real partitions."""
    count = connection.execute(sa.text("SELECT count(*) FROM departments")).scalar_one()
    if count > 1:
        raise RuntimeError("More than one department exists — review before dropping departments")


def _foreign_key_name(table: str, constrained_column: str) -> str | None:
    inspector = sa.inspect(op.get_bind())
    for foreign_key in inspector.get_foreign_keys(table):
        if foreign_key.get("constrained_columns") == [constrained_column]:
            return foreign_key.get("name")
    return None


def _drop_foreign_key(table: str, column: str) -> None:
    name = _foreign_key_name(table, column)
    if name:
        op.drop_constraint(name, table, type_="foreignkey")


def _has_column(table: str, column: str) -> bool:
    return any(item["name"] == column for item in sa.inspect(op.get_bind()).get_columns(table))


def _drop_unique_if_present(table: str, name: str) -> None:
    names = {item.get("name") for item in sa.inspect(op.get_bind()).get_unique_constraints(table)}
    if name in names:
        op.drop_constraint(name, table, type_="unique")


def upgrade() -> None:
    connection = op.get_bind()
    assert_single_department(connection)

    tables = set(sa.inspect(connection).get_table_names())
    if "programs" in tables:
        # Fresh installs build current runtime metadata in revision 001 while
        # retaining a historical ``courses`` compatibility table for revisions
        # 020/021. Repoint those two revisions' FKs, then remove the empty shim.
        for table in ("teacher_session_allocations", "student_profiles", "admin_program_scopes"):
            if table not in tables or not _has_column(table, "program_id"):
                continue
            _drop_foreign_key(table, "program_id")
            op.create_foreign_key(
                f"fk_{table}_program", table, "programs", ["program_id"], ["id"], ondelete="CASCADE" if table == "admin_program_scopes" else None
            )
        op.drop_table("courses")
    else:
        op.rename_table("courses", "programs")
        # The old unique constraint includes department_id, so its backing
        # index cannot merely be renamed when its column is removed.
        _drop_unique_if_present("programs", "uq_courses_department_name")
        _drop_foreign_key("programs", "department_id")
        op.drop_column("programs", "department_id")
        op.create_unique_constraint("uq_programs_name", "programs", ["name"])

    if _has_column("subjects", "department_id"):
        _drop_unique_if_present("subjects", "uq_subjects_department_name")
        _drop_unique_if_present("subjects", "uq_subjects_department_code")
        _drop_foreign_key("subjects", "department_id")
        op.drop_column("subjects", "department_id")

    if _has_column("teacher_session_allocations", "department_id"):
        _drop_foreign_key("teacher_session_allocations", "department_id")
        op.drop_column("teacher_session_allocations", "department_id")

    op.drop_table("departments")
    op.drop_table("institutions")


def downgrade() -> None:
    now = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)

    op.create_table(
        "institutions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False, unique=True),
        sa.Column("logo_url", sa.String(length=500), nullable=True),
        sa.Column("domain", sa.String(length=255), nullable=True, unique=True),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Asia/Kolkata"),
        sa.Column("settings", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "departments",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("name", name="uq_departments_name"),
    )
    op.execute(
        sa.text(
            "INSERT INTO departments (id, name, description, created_at, updated_at) "
            "VALUES (:id, :name, :description, :created_at, :updated_at)"
        ).bindparams(
            id=_SOET_ID,
            name=_SOET_NAME,
            description=_SOET_NAME,
            created_at=now,
            updated_at=now,
        )
    )

    op.execute("ALTER TABLE programs DROP CONSTRAINT IF EXISTS uq_programs_name")
    op.add_column("programs", sa.Column("department_id", sa.String(length=64), nullable=True))
    op.execute(sa.text("UPDATE programs SET department_id = :department_id").bindparams(department_id=_SOET_ID))
    op.alter_column("programs", "department_id", nullable=False)
    op.create_foreign_key(
        "fk_courses_department", "programs", "departments", ["department_id"], ["id"], onupdate="RESTRICT", ondelete="RESTRICT"
    )
    op.create_unique_constraint("uq_courses_department_name", "programs", ["department_id", "name"])

    op.add_column("subjects", sa.Column("department_id", sa.String(length=64), nullable=True))
    op.execute(sa.text("UPDATE subjects SET department_id = :department_id").bindparams(department_id=_SOET_ID))
    op.create_foreign_key(
        "fk_subjects_department", "subjects", "departments", ["department_id"], ["id"], onupdate="RESTRICT", ondelete="SET NULL"
    )
    op.create_unique_constraint("uq_subjects_department_name", "subjects", ["department_id", "name"])
    op.create_unique_constraint("uq_subjects_department_code", "subjects", ["department_id", "code"])

    op.add_column("teacher_session_allocations", sa.Column("department_id", sa.String(length=64), nullable=True))
    op.create_foreign_key(
        "fk_teacher_session_allocations_department",
        "teacher_session_allocations",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.rename_table("programs", "courses")
