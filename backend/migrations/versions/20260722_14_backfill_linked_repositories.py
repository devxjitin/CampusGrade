"""Repair linked submissions created while older application processes were still running."""

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_014"
down_revision = "canvasgrade_013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        UPDATE assignment_submissions s
        SET repository_url = v.repository_url,
            repository_owner = v.repository_owner,
            repository_name = v.repository_name,
            default_branch = v.default_branch,
            latest_remote_sha = v.commit_sha,
            sync_status = CASE WHEN s.freeze_requested_at IS NOT NULL THEN 'frozen' WHEN v.analysis_status = 'ready' THEN 'live' ELSE 'syncing' END,
            last_sync_checked_at = COALESCE(s.last_sync_checked_at, v.detected_at, v.submitted_at),
            last_sync_completed_at = CASE WHEN v.analysis_status = 'ready' THEN COALESCE(s.last_sync_completed_at, v.created_at) ELSE s.last_sync_completed_at END,
            next_sync_at = NULL
        FROM assignment_submission_versions v
        WHERE v.id = s.active_version_id AND s.repository_url IS NULL
    """))


def downgrade() -> None:
    pass
