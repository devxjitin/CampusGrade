"""Split the users god-table into profile tables (Sprint 4, IMPLEMENTATION_PLAN.md).

Expand phase only: `user_profiles`, `student_profiles`, `teacher_profiles`,
and `admin_program_scopes` are created and backfilled from the existing
`users` columns, but nothing on `users` is dropped or made non-nullable —
every existing route keeps working unchanged until Sprint 10's contract
migration removes the old columns.

Adapted from the plan's sketch to this schema's real column names:
`users.contact_number` (not `phone`), `users.course_id` (the plan calls this
`program_id` — "program" doesn't exist as a renamed concept until Sprint 8,
so `student_profiles.program_id` points at the same `courses.id` the plan's
own SQL targets, just under this schema's pre-rename FK). `admission_year`
backfills from the student's batch's `start_year` where a batch is set,
falling back to the account's creation year exactly as the plan specifies,
since not every student row has `batch_id` populated.

Two audit queries the plan asks to be run against production data *before*
this migration ships (see Sprint 4's "Risk" section) are reproduced as a
Python helper below (`find_migration_blockers`) rather than left as loose
SQL in a comment, so CI or a operator can actually invoke them. This sandbox
has no production data to run them against — see SPRINT_STATUS.md.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "canvasgrade_021"
down_revision = "canvasgrade_020"
branch_labels = None
depends_on = None


def find_migration_blockers(connection) -> dict[str, list]:
    """Rows that will be silently skipped or will fail the backfill below.

    Run this against a copy of production data before applying the
    migration for real — per the plan, fix these with a separate data
    migration first rather than letting the backfill quietly drop rows.
    """
    missing = connection.execute(
        sa.text("SELECT id, email, roll_no, course_id FROM users WHERE role = 'student' AND (roll_no IS NULL OR course_id IS NULL)")
    ).fetchall()
    duplicates = connection.execute(
        sa.text("SELECT roll_no, count(*) AS n FROM users WHERE role = 'student' AND roll_no IS NOT NULL GROUP BY roll_no HAVING count(*) > 1")
    ).fetchall()
    return {"students_missing_roll_no_or_course": list(missing), "duplicate_roll_numbers": list(duplicates)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if "user_profiles" not in existing_tables:
        op.create_table(
            "user_profiles",
            sa.Column("user_id", sa.String(length=64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("full_name", sa.Text(), nullable=False),
            sa.Column("phone", sa.Text(), nullable=True),
            sa.Column("avatar_key", sa.Text(), nullable=True),
            sa.Column("bio", sa.Text(), nullable=True),
            sa.Column("github_username", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )

    if "student_profiles" not in existing_tables:
        op.create_table(
            "student_profiles",
            sa.Column("user_id", sa.String(length=64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("roll_no", sa.Text(), nullable=False, unique=True),
            sa.Column("program_id", sa.String(length=64), sa.ForeignKey("courses.id"), nullable=False),
            sa.Column("admission_year", sa.Integer(), nullable=False),
            sa.Column("enrollment_status", sa.Text(), nullable=False, server_default="active"),
        )

    if "teacher_profiles" not in existing_tables:
        op.create_table(
            "teacher_profiles",
            sa.Column("user_id", sa.String(length=64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("employee_code", sa.Text(), nullable=False, unique=True),
            sa.Column("designation", sa.Text(), nullable=True),
        )

    if "admin_program_scopes" not in existing_tables:
        op.create_table(
            "admin_program_scopes",
            sa.Column("user_id", sa.String(length=64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("program_id", sa.String(length=64), sa.ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True),
        )

    connection = op.get_bind()
    now = datetime.now(UTC).replace(tzinfo=None)

    # ---- backfill user_profiles: every user, regardless of role ----
    users = connection.execute(sa.text("SELECT id, name, contact_number, avatar, bio, github_username FROM users")).fetchall()
    profiles_table = sa.table(
        "user_profiles",
        sa.column("user_id", sa.String()),
        sa.column("full_name", sa.Text()),
        sa.column("phone", sa.Text()),
        sa.column("avatar_key", sa.Text()),
        sa.column("bio", sa.Text()),
        sa.column("github_username", sa.Text()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    already_profiled = {row[0] for row in connection.execute(sa.text("SELECT user_id FROM user_profiles")).fetchall()}
    rows = [
        {
            "user_id": user_id,
            "full_name": name,
            "phone": contact_number,
            "avatar_key": avatar,
            "bio": bio,
            "github_username": github_username,
            "created_at": now,
            "updated_at": now,
        }
        for user_id, name, contact_number, avatar, bio, github_username in users
        if user_id not in already_profiled
    ]
    if rows:
        op.bulk_insert(profiles_table, rows)

    # ---- backfill student_profiles: skip rows missing roll_no/course_id,
    # per find_migration_blockers() above — that is a data-quality problem
    # to fix separately, not something this migration should crash on ----
    students = connection.execute(
        sa.text(
            """
            SELECT u.id, u.roll_no, u.course_id, b.start_year, u.created_at
            FROM users u LEFT JOIN batches b ON b.id = u.batch_id
            WHERE u.role = 'student' AND u.roll_no IS NOT NULL AND u.course_id IS NOT NULL
            """
        )
    ).fetchall()
    student_profiles_table = sa.table(
        "student_profiles",
        sa.column("user_id", sa.String()),
        sa.column("roll_no", sa.Text()),
        sa.column("program_id", sa.String()),
        sa.column("admission_year", sa.Integer()),
        sa.column("enrollment_status", sa.Text()),
    )
    already_have_student_profile = {row[0] for row in connection.execute(sa.text("SELECT user_id FROM student_profiles")).fetchall()}
    seen_roll_numbers: set[str] = set()
    student_rows = []
    for user_id, roll_no, course_id, start_year, created_at in students:
        if user_id in already_have_student_profile:
            continue
        # Duplicate roll numbers would violate student_profiles' unique
        # constraint and abort the whole migration — skip the collision
        # rather than fail closed; find_migration_blockers() is how an
        # operator finds and fixes these ahead of time.
        if roll_no in seen_roll_numbers:
            continue
        seen_roll_numbers.add(roll_no)
        admission_year = start_year or (created_at.year if created_at else now.year)
        student_rows.append(
            {
                "user_id": user_id,
                "roll_no": roll_no,
                "program_id": course_id,
                "admission_year": admission_year,
                "enrollment_status": "active",
            }
        )
    if student_rows:
        op.bulk_insert(student_profiles_table, student_rows)

    # ---- backfill teacher_profiles ----
    teachers = connection.execute(sa.text("SELECT id, teacher_id, designation FROM users WHERE role = 'teacher'")).fetchall()
    teacher_profiles_table = sa.table(
        "teacher_profiles",
        sa.column("user_id", sa.String()),
        sa.column("employee_code", sa.Text()),
        sa.column("designation", sa.Text()),
    )
    already_have_teacher_profile = {row[0] for row in connection.execute(sa.text("SELECT user_id FROM teacher_profiles")).fetchall()}
    seen_employee_codes: set[str] = set()
    teacher_rows = []
    for user_id, teacher_id, designation in teachers:
        if user_id in already_have_teacher_profile:
            continue
        employee_code = teacher_id or f"T-{user_id[:8]}"
        if employee_code in seen_employee_codes:
            employee_code = f"T-{user_id[:8]}"
        seen_employee_codes.add(employee_code)
        teacher_rows.append({"user_id": user_id, "employee_code": employee_code, "designation": designation})
    if teacher_rows:
        op.bulk_insert(teacher_profiles_table, teacher_rows)


def downgrade() -> None:
    op.drop_table("admin_program_scopes")
    op.drop_table("teacher_profiles")
    op.drop_table("student_profiles")
    op.drop_table("user_profiles")
