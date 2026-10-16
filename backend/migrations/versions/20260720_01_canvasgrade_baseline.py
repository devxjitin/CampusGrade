"""CanvasGrade fresh database baseline."""
import sqlalchemy as sa
from alembic import op
from models import Base

revision = "canvasgrade_001"
down_revision = None
branch_labels = None
depends_on = None

TABLES = {
    "app_settings", "audit_logs", "programs", "batches", "sections", "subjects",
    "users", "student_subject_enrollments", "refresh_tokens", "password_reset_tokens", "notifications", "user_preferences",
    "assignments", "assignment_rubric_criteria", "assignment_resources", "assignment_submissions",
    "assignment_submission_versions", "assignment_evaluation_participants", "assignment_grades", "assignment_grade_revisions", "assignment_duplicate_flags",
    "assignment_announcements", "assignment_threads", "assignment_thread_messages", "assignment_ai_suggestions",
    # academic_sessions is not "owned" by this baseline (it is properly introduced, seeded, and
    # downgraded in canvasgrade_017), but the live model metadata this baseline builds from already
    # carries assignments.session_id -> academic_sessions.id, so the table must exist here too on a
    # fresh install. checkfirst=True makes this a no-op on databases that already ran canvasgrade_017.
    "academic_sessions",
}


def upgrade() -> None:
    # This legacy baseline historically imported live ORM metadata. Keep the
    # historical academic tables explicit now that the runtime model has moved
    # on to ``programs`` and no longer defines these three tables. Revision 024
    # reconciles the temporary fresh-install ``courses``/``programs`` overlap.
    op.create_table(
        "institutions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("logo_url", sa.String(length=500)),
        sa.Column("domain", sa.String(length=255), unique=True),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Asia/Kolkata"),
        sa.Column("settings", sa.JSON()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("code", name="uq_institutions_code"),
    )
    op.create_table(
        "departments",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("name", name="uq_departments_name"),
    )
    op.create_table(
        "courses",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("department_id", sa.String(length=64), sa.ForeignKey("departments.id", name="fk_courses_department", ondelete="RESTRICT", onupdate="RESTRICT"), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("duration_years", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("year", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("code", name="uq_courses_code"),
        sa.UniqueConstraint("department_id", "name", name="uq_courses_department_name"),
    )
    metadata = Base.metadata
    selected = [table for table in metadata.sorted_tables if table.name in TABLES]
    metadata.create_all(bind=op.get_bind(), tables=selected, checkfirst=True)


def downgrade() -> None:
    metadata = Base.metadata
    selected = [table for table in reversed(metadata.sorted_tables) if table.name in TABLES]
    metadata.drop_all(bind=op.get_bind(), tables=selected, checkfirst=True)
    op.drop_table("courses")
    op.drop_table("departments")
    op.drop_table("institutions")
