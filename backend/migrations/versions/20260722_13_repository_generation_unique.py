"""Allow the same commit to be relinked after an audited repository reset."""

from alembic import op
import sqlalchemy as sa


revision = "canvasgrade_013"
down_revision = "canvasgrade_012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    constraints = {
        item.get("name"): tuple(item.get("column_names") or ())
        for item in sa.inspect(op.get_bind()).get_unique_constraints("assignment_submission_versions")
    }
    if constraints.get("uq_assignment_submission_commit") == ("submission_id", "repository_generation", "commit_sha"):
        return
    op.drop_constraint("uq_assignment_submission_commit", "assignment_submission_versions", type_="unique")
    op.create_unique_constraint("uq_assignment_submission_commit", "assignment_submission_versions", ["submission_id", "repository_generation", "commit_sha"])


def downgrade() -> None:
    op.drop_constraint("uq_assignment_submission_commit", "assignment_submission_versions", type_="unique")
    op.create_unique_constraint("uq_assignment_submission_commit", "assignment_submission_versions", ["submission_id", "commit_sha"])
