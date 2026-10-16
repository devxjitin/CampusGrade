import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from models.database import Base
from models.sql_models import utcnow


class SqlAssignment(Base):
    __tablename__ = "assignments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    instructions: Mapped[str] = mapped_column(Text, nullable=False, default="")
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subject_id: Mapped[str | None] = mapped_column(ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True, index=True)
    short_description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False, default="intermediate")
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    learning_outcomes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    starter_repository_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    repository_requirements: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    target_course_id: Mapped[str | None] = mapped_column(ForeignKey("programs.id", ondelete="SET NULL"), nullable=True, index=True)
    target_batch_id: Mapped[str | None] = mapped_column(ForeignKey("batches.id", ondelete="SET NULL"), nullable=True, index=True)
    target_section_id: Mapped[str | None] = mapped_column(ForeignKey("sections.id", ondelete="SET NULL"), nullable=True, index=True)
    # Which academic session this assignment belongs to. Nullable so
    # pre-migration rows stay valid; backfilled from due_at/created_at,
    # set from the current session on create going forward.
    session_id: Mapped[str | None] = mapped_column(ForeignKey("academic_sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    total_marks: Mapped[float] = mapped_column(Float, nullable=False)
    opens_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    due_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    allow_late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    late_until: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    result_release_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    result_release_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    results_published_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    results_published_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="published", index=True)
    submission_locked_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    submission_locked_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    submission_lock_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    evaluation_locked_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    evaluation_locked_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    evaluation_lock_trigger: Mapped[str | None] = mapped_column(String(30), nullable=True)
    repository_fetch_started_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    repository_fetch_started_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    repository_fetch_completed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class SqlAssignmentRubric(Base):
    __tablename__ = "assignment_rubric_criteria"
    __table_args__ = (UniqueConstraint("assignment_id", "position", name="uq_assignment_rubric_position"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    max_marks: Mapped[float] = mapped_column(Float, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class SqlAssignmentResource(Base):
    __tablename__ = "assignment_resources"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(150), nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SqlAssignmentSubmission(Base):
    __tablename__ = "assignment_submissions"
    __table_args__ = (UniqueConstraint("assignment_id", "student_id", name="uq_assignment_submission_student"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    active_version_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    pending_version_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    frozen_version_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    repository_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    repository_owner: Mapped[str | None] = mapped_column(String(100), nullable=True)
    repository_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    default_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    repository_generation: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    latest_remote_sha: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    sync_status: Mapped[str] = mapped_column(String(30), nullable=False, default="syncing", index=True)
    last_sync_checked_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    last_sync_completed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    next_sync_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    sync_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sync_failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    freeze_requested_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    frozen_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    frozen_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    freeze_reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="submitted", index=True)
    first_submitted_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    last_submitted_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class SqlAssignmentSubmissionVersion(Base):
    __tablename__ = "assignment_submission_versions"
    __table_args__ = (UniqueConstraint("submission_id", "repository_generation", "commit_sha", name="uq_assignment_submission_commit"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    submission_id: Mapped[str] = mapped_column(ForeignKey("assignment_submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    repository_generation: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    detected_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    detection_source: Mapped[str] = mapped_column(String(30), nullable=False, default="student")
    repository_url: Mapped[str] = mapped_column(Text, nullable=False)
    repository_owner: Mapped[str] = mapped_column(String(100), nullable=False)
    repository_name: Mapped[str] = mapped_column(String(150), nullable=False)
    default_branch: Mapped[str] = mapped_column(String(255), nullable=False)
    commit_sha: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    commit_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    commit_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    submitted_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, index=True)
    is_late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    seconds_late: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    analysis_status: Mapped[str] = mapped_column(String(30), nullable=False, default="queued", index=True)
    analysis_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    archive_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    manifest_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    analysis_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    readme_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_digest: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class SqlAssignmentEvaluationParticipant(Base):
    __tablename__ = "assignment_evaluation_participants"
    __table_args__ = (UniqueConstraint("assignment_id", "student_id", name="uq_assignment_evaluation_participant"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    submission_version_id: Mapped[str | None] = mapped_column(ForeignKey("assignment_submission_versions.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="submitted", index=True)
    locked_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class SqlAssignmentGrade(Base):
    __tablename__ = "assignment_grades"
    __table_args__ = (UniqueConstraint("assignment_id", "student_id", name="uq_assignment_grade_student"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    submission_version_id: Mapped[str | None] = mapped_column(ForeignKey("assignment_submission_versions.id", ondelete="SET NULL"), nullable=True)
    rubric_scores: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    feedback: Mapped[str] = mapped_column(Text, nullable=False, default="")
    total_awarded: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    evaluation_source: Mapped[str] = mapped_column(String(40), nullable=False, default="manual")
    evaluation_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_missing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)
    evaluated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    evaluated_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    published_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    withdrawn_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    withdrawal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class SqlAssignmentGradeRevision(Base):
    __tablename__ = "assignment_grade_revisions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    grade_id: Mapped[str] = mapped_column(ForeignKey("assignment_grades.id", ondelete="CASCADE"), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class SqlAssignmentDuplicateFlag(Base):
    __tablename__ = "assignment_duplicate_flags"
    __table_args__ = (UniqueConstraint("assignment_id", "left_version_id", "right_version_id", "flag_type", name="uq_assignment_duplicate_pair"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    left_version_id: Mapped[str] = mapped_column(ForeignKey("assignment_submission_versions.id", ondelete="CASCADE"), nullable=False)
    right_version_id: Mapped[str] = mapped_column(ForeignKey("assignment_submission_versions.id", ondelete="CASCADE"), nullable=False)
    flag_type: Mapped[str] = mapped_column(String(40), nullable=False)
    similarity: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    review_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class SqlAssignmentAnnouncement(Base):
    __tablename__ = "assignment_announcements"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class SqlAssignmentThread(Base):
    __tablename__ = "assignment_threads"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class SqlAssignmentThreadMessage(Base):
    __tablename__ = "assignment_thread_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    thread_id: Mapped[str] = mapped_column(ForeignKey("assignment_threads.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class SqlAssignmentAISuggestion(Base):
    __tablename__ = "assignment_ai_suggestions"
    __table_args__ = (UniqueConstraint("assignment_id", "student_id", "submission_version_id", name="uq_assignment_ai_suggestion_version"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    submission_version_id: Mapped[str] = mapped_column(ForeignKey("assignment_submission_versions.id", ondelete="CASCADE"), nullable=False)
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued", index=True)
    rubric_scores: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)
