"""Add student-owned live repository synchronization and per-submission freeze state."""

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_012"
down_revision = "canvasgrade_011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    submission_columns = {column["name"] for column in inspector.get_columns("assignment_submissions")}
    columns = (
        sa.Column("pending_version_id", sa.String(64), nullable=True),
        sa.Column("frozen_version_id", sa.String(64), nullable=True),
        sa.Column("repository_url", sa.Text(), nullable=True),
        sa.Column("repository_owner", sa.String(100), nullable=True),
        sa.Column("repository_name", sa.String(150), nullable=True),
        sa.Column("default_branch", sa.String(255), nullable=True),
        sa.Column("repository_generation", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("latest_remote_sha", sa.String(64), nullable=True),
        sa.Column("sync_status", sa.String(30), nullable=False, server_default="syncing"),
        sa.Column("last_sync_checked_at", sa.DateTime(), nullable=True),
        sa.Column("last_sync_completed_at", sa.DateTime(), nullable=True),
        sa.Column("next_sync_at", sa.DateTime(), nullable=True),
        sa.Column("sync_error", sa.Text(), nullable=True),
        sa.Column("sync_failure_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("freeze_requested_at", sa.DateTime(), nullable=True),
        sa.Column("frozen_at", sa.DateTime(), nullable=True),
        sa.Column("frozen_by", sa.String(64), nullable=True),
        sa.Column("freeze_reason", sa.String(30), nullable=True),
    )
    for column in columns:
        if column.name not in submission_columns:
            op.add_column("assignment_submissions", column)
    foreign_keys = {tuple(item["constrained_columns"]) for item in inspector.get_foreign_keys("assignment_submissions")}
    if ("frozen_by",) not in foreign_keys:
        op.create_foreign_key("fk_assignment_submissions_frozen_by", "assignment_submissions", "users", ["frozen_by"], ["id"], ondelete="SET NULL")
    indexes = {item["name"] for item in inspector.get_indexes("assignment_submissions")}
    for name in ("pending_version_id", "frozen_version_id", "latest_remote_sha", "sync_status", "next_sync_at", "freeze_requested_at"):
        index_name = f"ix_assignment_submissions_{name}"
        if index_name not in indexes:
            op.create_index(index_name, "assignment_submissions", [name])
    version_columns = {column["name"] for column in inspector.get_columns("assignment_submission_versions")}
    for column in (
        sa.Column("repository_generation", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("detected_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("detection_source", sa.String(30), nullable=False, server_default="student"),
    ):
        if column.name not in version_columns:
            op.add_column("assignment_submission_versions", column)
    op.execute(sa.text("""
        UPDATE assignment_submissions s
        SET repository_url = v.repository_url,
            repository_owner = v.repository_owner,
            repository_name = v.repository_name,
            default_branch = v.default_branch,
            latest_remote_sha = v.commit_sha,
            sync_status = CASE WHEN v.analysis_status = 'ready' THEN 'live' ELSE v.analysis_status END,
            last_sync_checked_at = v.submitted_at,
            last_sync_completed_at = CASE WHEN v.analysis_status = 'ready' THEN v.submitted_at ELSE NULL END,
            next_sync_at = CURRENT_TIMESTAMP
        FROM assignment_submission_versions v
        WHERE v.id = s.active_version_id
    """))
    op.execute(sa.text("""
        UPDATE assignment_submissions s
        SET frozen_version_id = s.active_version_id,
            freeze_requested_at = COALESCE(a.evaluation_locked_at, a.due_at),
            frozen_at = COALESCE(a.evaluation_locked_at, a.due_at),
            freeze_reason = 'deadline', sync_status = 'frozen', next_sync_at = NULL
        FROM assignments a
        WHERE a.id = s.assignment_id
          AND (a.evaluation_locked_at IS NOT NULL OR a.due_at <= CURRENT_TIMESTAMP)
    """))
    op.execute(sa.text("""
        UPDATE assignment_submissions s
        SET frozen_version_id = COALESCE(g.submission_version_id, s.active_version_id),
            freeze_requested_at = COALESCE(g.evaluated_at, s.freeze_requested_at, s.created_at),
            frozen_at = COALESCE(g.evaluated_at, s.frozen_at, s.created_at),
            frozen_by = g.evaluated_by, freeze_reason = 'evaluation',
            sync_status = 'frozen', next_sync_at = NULL
        FROM assignment_grades g
        WHERE g.assignment_id = s.assignment_id AND g.student_id = s.student_id
    """))


def downgrade() -> None:
    for name in ("detection_source", "detected_at", "repository_generation"):
        op.drop_column("assignment_submission_versions", name)
    op.drop_constraint("fk_assignment_submissions_frozen_by", "assignment_submissions", type_="foreignkey")
    for name in ("freeze_requested_at", "next_sync_at", "sync_status", "latest_remote_sha", "frozen_version_id", "pending_version_id"):
        op.drop_index(f"ix_assignment_submissions_{name}", table_name="assignment_submissions")
    for name in ("freeze_reason", "frozen_by", "frozen_at", "freeze_requested_at", "sync_failure_count", "sync_error", "next_sync_at", "last_sync_completed_at", "last_sync_checked_at", "sync_status", "latest_remote_sha", "repository_generation", "default_branch", "repository_name", "repository_owner", "repository_url", "frozen_version_id", "pending_version_id"):
        op.drop_column("assignment_submissions", name)
