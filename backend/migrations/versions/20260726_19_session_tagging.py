"""Tag assignments and student_subject_enrollments with session_id.

Assignments are backfilled by matching due_at (falling back to created_at)
against academic_sessions date ranges. Existing enrollments are backfilled to
the current session so the unique constraint change below does not orphan
them; the per-(student, subject) uniqueness is relaxed to per-(student,
subject, session) so a student can retake a subject in a later session.

See the original academic-sessions plan Part 5 / Phase 2.
"""

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_019"
down_revision = "canvasgrade_018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    assignments_columns = {column["name"] for column in inspector.get_columns("assignments")}
    if "session_id" not in assignments_columns:
        op.add_column("assignments", sa.Column("session_id", sa.String(length=64), sa.ForeignKey("academic_sessions.id", ondelete="SET NULL"), nullable=True))
    assignments_indexes = {index["name"] for index in inspector.get_indexes("assignments")}
    if "ix_assignments_session_id" not in assignments_indexes:
        op.create_index("ix_assignments_session_id", "assignments", ["session_id"])

    enrollments_columns = {column["name"] for column in inspector.get_columns("student_subject_enrollments")}
    if "session_id" not in enrollments_columns:
        op.add_column("student_subject_enrollments", sa.Column("session_id", sa.String(length=64), sa.ForeignKey("academic_sessions.id", ondelete="SET NULL"), nullable=True))
    enrollments_indexes = {index["name"] for index in inspector.get_indexes("student_subject_enrollments")}
    if "ix_student_subject_enrollments_session_id" not in enrollments_indexes:
        op.create_index("ix_student_subject_enrollments_session_id", "student_subject_enrollments", ["session_id"])

    connection = op.get_bind()

    # Backfill assignments: pick whichever session's date range contains
    # due_at (or created_at if due_at is null). Rows that match no session
    # are left null and can be reassigned from an admin screen later.
    sessions = connection.execute(sa.text("SELECT id, start_date, end_date FROM academic_sessions ORDER BY start_date")).fetchall()
    for session_id, start_date, end_date in sessions:
        connection.execute(
            sa.text(
                """
                UPDATE assignments
                SET session_id = :session_id
                WHERE session_id IS NULL
                  AND COALESCE(due_at::date, created_at::date) BETWEEN :start_date AND :end_date
                """
            ),
            {"session_id": session_id, "start_date": start_date, "end_date": end_date},
        )

    # Backfill enrollments to whichever session is currently marked active,
    # so nothing becomes orphaned once the unique constraint changes below.
    current_session = connection.execute(sa.text("SELECT id FROM academic_sessions WHERE is_current = true ORDER BY start_date DESC LIMIT 1")).first()
    if current_session:
        connection.execute(
            sa.text("UPDATE student_subject_enrollments SET session_id = :session_id WHERE session_id IS NULL"),
            {"session_id": current_session[0]},
        )

    unique_constraints = {
        item.get("name") for item in inspector.get_unique_constraints("student_subject_enrollments")
    }
    if "uq_student_subject_enrollment" in unique_constraints:
        op.drop_constraint("uq_student_subject_enrollment", "student_subject_enrollments", type_="unique")
    if "uq_student_subject_enrollment_session" not in unique_constraints:
        op.create_unique_constraint(
            "uq_student_subject_enrollment_session", "student_subject_enrollments", ["student_id", "subject_id", "session_id"]
        )


def downgrade() -> None:
    op.execute("ALTER TABLE student_subject_enrollments DROP CONSTRAINT IF EXISTS uq_student_subject_enrollment_session")
    op.create_unique_constraint("uq_student_subject_enrollment", "student_subject_enrollments", ["student_id", "subject_id"])
    op.drop_index("ix_student_subject_enrollments_session_id", table_name="student_subject_enrollments")
    op.drop_column("student_subject_enrollments", "session_id")
    op.drop_index("ix_assignments_session_id", table_name="assignments")
    op.drop_column("assignments", "session_id")
