import datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, backref, mapped_column, relationship

from models.database import Base


def utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


class TimestampedModel:
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    setting_type: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class AuditLog(Base, TimestampedModel):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Audit rows must remain readable after an administrator account is removed,
    # so this historical actor identifier intentionally has no hard FK.
    admin_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(255), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    timestamp: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, index=True)


class SqlUser(Base, TimestampedModel):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("roll_no", name="uq_users_roll_no"),
        UniqueConstraint("teacher_id", name="uq_users_teacher_id"),
        Index("ix_users_role_course", "role", "course"),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(nullable=False, default=True)
    session_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_login: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", name="fk_users_created_by", onupdate="RESTRICT", ondelete="SET NULL"), nullable=True)
    teacher_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    roll_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Legacy free-text values remain for backward compatibility. New code must
    # use course_id and batch_id.
    course: Mapped[str | None] = mapped_column(String(100), nullable=True)
    batch: Mapped[str | None] = mapped_column(String(30), nullable=True)
    course_id: Mapped[str | None] = mapped_column(ForeignKey("programs.id", ondelete="SET NULL"), nullable=True, index=True)
    batch_id: Mapped[str | None] = mapped_column(ForeignKey("batches.id", ondelete="SET NULL"), nullable=True, index=True)
    section_id: Mapped[str | None] = mapped_column(ForeignKey("sections.id", name="fk_users_section", onupdate="RESTRICT", ondelete="SET NULL"), nullable=True)
    avatar: Mapped[str | None] = mapped_column(Text, nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    github_username: Mapped[str | None] = mapped_column(String(100), nullable=True)
    leetcode_username: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    semester: Mapped[int | None] = mapped_column(Integer, nullable=True)
    designation: Mapped[str | None] = mapped_column(String(100), nullable=True)
    assignments: Mapped[list | None] = mapped_column(JSON, nullable=True)
    achievements: Mapped[list | None] = mapped_column(JSON, nullable=True)
    github_repositories: Mapped[list | None] = mapped_column(JSON, nullable=True)

    creator: Mapped["SqlUser | None"] = relationship(remote_side=[id], foreign_keys=[created_by])
    course_record: Mapped["SqlCourse | None"] = relationship(foreign_keys=[course_id], back_populates="students")
    batch_record: Mapped["SqlBatch | None"] = relationship(foreign_keys=[batch_id], back_populates="students")
    section: Mapped["SqlSection | None"] = relationship(foreign_keys=[section_id], back_populates="students")


class SqlUserProfile(Base):
    """Sprint 4, the original implementation plan — expand phase.

    Backfilled from (and, from this sprint on, dual-written alongside)
    `SqlUser`'s own `name`/`contact_number`/`avatar`/`bio`/`github_username`
    columns. Those old columns are **not** dropped this sprint (see
    migration `canvasgrade_021`) — Sprint 10's contract migration removes
    them once every reader has moved onto this table.
    """

    __tablename__ = "user_profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    github_username: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    user: Mapped[SqlUser] = relationship(foreign_keys=[user_id], backref=backref("profile", cascade="all, delete-orphan", passive_deletes=True))


class SqlStudentProfile(Base):
    """Sprint 4, the original implementation plan — expand phase. See `SqlUserProfile`."""

    __tablename__ = "student_profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    roll_no: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # Named `program_id` (matching the plan) even though it points at
    # `courses.id` — "program" is the pre-Sprint-8-rename name for what this
    # schema still calls a course. See migration `canvasgrade_021`.
    program_id: Mapped[str] = mapped_column(ForeignKey("programs.id"), nullable=False)
    admission_year: Mapped[int] = mapped_column(Integer, nullable=False)
    enrollment_status: Mapped[str] = mapped_column(Text, nullable=False, default="active")

    user: Mapped[SqlUser] = relationship(foreign_keys=[user_id], backref=backref("student_profile", cascade="all, delete-orphan", passive_deletes=True))
    program: Mapped["SqlCourse"] = relationship(foreign_keys=[program_id])


class SqlTeacherProfile(Base):
    """Sprint 4, the original implementation plan — expand phase. See `SqlUserProfile`."""

    __tablename__ = "teacher_profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    employee_code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    designation: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped[SqlUser] = relationship(foreign_keys=[user_id], backref=backref("teacher_profile", cascade="all, delete-orphan", passive_deletes=True))


class SqlAdminProgramScope(Base):
    """Sprint 4, the original implementation plan — expand phase.

    Empty for every admin today (there is no `program_admin` role yet — see
    `core/principal.py`); this table exists so Sprint 5 has somewhere to
    write scopes to when `program_admin` goes live, rather than adding it
    as a schema change bundled into that sprint's role cutover.
    """

    __tablename__ = "admin_program_scopes"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    program_id: Mapped[str] = mapped_column(ForeignKey("programs.id", ondelete="CASCADE"), primary_key=True)


class SqlAdminAccess(Base):
    """What an `admin` account may do, set by a Super Admin: one row per resource.

    `level` is "view" (read only), "edit" (also create and change) or "full" (also delete).
    A resource with no row is not accessible. Super Admins ignore this table.
    """

    __tablename__ = "admin_access"
    __table_args__ = (CheckConstraint("level IN ('view','edit','full')", name="ck_admin_access_level"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    resource: Mapped[str] = mapped_column(String(40), primary_key=True)
    level: Mapped[str] = mapped_column(String(10), nullable=False)


class SqlCourse(Base, TimestampedModel):
    __tablename__ = "programs"
    __table_args__ = (UniqueConstraint("name", name="uq_programs_name"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False, default="", unique=True)
    duration_years: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    year: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    batches: Mapped[list["SqlBatch"]] = relationship(back_populates="course", cascade="all, delete-orphan")
    students: Mapped[list[SqlUser]] = relationship(foreign_keys="SqlUser.course_id", back_populates="course_record")
    subjects: Mapped[list["SqlSubject"]] = relationship(back_populates="course")


class SqlBatch(Base, TimestampedModel):
    __tablename__ = "batches"
    __table_args__ = (UniqueConstraint("course_id", "start_year", "end_year", name="uq_batches_course_years"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    course_id: Mapped[str] = mapped_column(ForeignKey("programs.id", name="fk_batches_course", onupdate="RESTRICT", ondelete="RESTRICT"), nullable=False)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    start_year: Mapped[int] = mapped_column(Integer, nullable=False)
    end_year: Mapped[int] = mapped_column(Integer, nullable=False)
    # "upcoming" | "active" | "completed" — computed by the rollover engine,
    # cached here so list/card screens don't need to recompute it every time.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    auto_created: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    intake_open: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    course: Mapped[SqlCourse] = relationship(back_populates="batches")
    sections: Mapped[list["SqlSection"]] = relationship(back_populates="batch", cascade="all, delete-orphan")
    students: Mapped[list[SqlUser]] = relationship(foreign_keys="SqlUser.batch_id", back_populates="batch_record")
    subjects: Mapped[list["SqlSubject"]] = relationship(back_populates="batch")


class SqlSection(Base, TimestampedModel):
    __tablename__ = "sections"
    __table_args__ = (UniqueConstraint("course_id", "batch_id", "name", name="uq_sections_course_batch_name"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    course_id: Mapped[str] = mapped_column(ForeignKey("programs.id", name="fk_sections_course", onupdate="RESTRICT", ondelete="RESTRICT"), nullable=False)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id", name="fk_sections_batch", onupdate="RESTRICT", ondelete="RESTRICT"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    course: Mapped[SqlCourse] = relationship(foreign_keys=[course_id])
    batch: Mapped[SqlBatch] = relationship(back_populates="sections")
    students: Mapped[list[SqlUser]] = relationship(back_populates="section")


class SqlSubject(Base, TimestampedModel):
    __tablename__ = "subjects"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    course_id: Mapped[str | None] = mapped_column(ForeignKey("programs.id", name="fk_subjects_course", onupdate="RESTRICT", ondelete="SET NULL"), nullable=True)
    batch_id: Mapped[str | None] = mapped_column(ForeignKey("batches.id", name="fk_subjects_batch", onupdate="RESTRICT", ondelete="SET NULL"), nullable=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    credits: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    enrollment_type: Mapped[str] = mapped_column(String(20), nullable=False, default="compulsory")
    course: Mapped[SqlCourse | None] = relationship(back_populates="subjects")
    batch: Mapped[SqlBatch | None] = relationship(back_populates="subjects")
    enrollments: Mapped[list["SqlStudentSubjectEnrollment"]] = relationship(back_populates="subject", cascade="all, delete-orphan")


class SqlAcademicSession(Base, TimestampedModel):
    """A named reporting session (e.g. "2025-2026 (Odd)") an admin can
    switch between in the topbar. This only scopes what date range admin
    reports/dashboards compute over — assignments and enrollments are not
    tagged with a session. See the original changes plan Option A."""

    __tablename__ = "academic_sessions"
    __table_args__ = (
        UniqueConstraint("label", "term", name="uq_academic_sessions_label_term"),
        Index("uq_academic_sessions_single_current", "is_current", unique=True, postgresql_where=text("is_current")),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    term: Mapped[str] = mapped_column(String(10), nullable=False)
    start_date: Mapped[datetime.date] = mapped_column(nullable=False)
    end_date: Mapped[datetime.date] = mapped_column(nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # "upcoming" | "active" | "closed" — "active" is the session with is_current=True.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="upcoming")


class SqlStudentSubjectEnrollment(Base):
    __tablename__ = "student_subject_enrollments"
    __table_args__ = (UniqueConstraint("student_id", "subject_id", "session_id", name="uq_student_subject_enrollment_session"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True)
    # Nullable so pre-existing rows created before session tagging remain valid;
    # every new enrollment should set this from the current session.
    session_id: Mapped[str | None] = mapped_column(ForeignKey("academic_sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    # Set when the rollover engine auto-enrolled the student, so an undo removes only those rows.
    # No foreign key on purpose: the baseline migration builds this table from the live models
    # before rollover_runs exists, and a stale tag is harmless.
    rollover_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    enrolled_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    student: Mapped[SqlUser] = relationship()
    subject: Mapped[SqlSubject] = relationship(back_populates="enrollments")
    session: Mapped["SqlAcademicSession | None"] = relationship()


class SqlStudentSessionRecord(Base, TimestampedModel):
    """Per-session snapshot of a student's batch/section/year/semester/status.

    This is the source of truth going forward — users.year/users.semester
    stay in place as a cached copy of the *current* session's record so
    existing code that reads them keeps working. See
    the original academic-sessions plan Part 1.
    """

    __tablename__ = "student_session_records"
    __table_args__ = (UniqueConstraint("student_id", "session_id", name="uq_student_session_record"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("academic_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    batch_id: Mapped[str | None] = mapped_column(ForeignKey("batches.id", ondelete="SET NULL"), nullable=True, index=True)
    section_id: Mapped[str | None] = mapped_column(ForeignKey("sections.id", ondelete="SET NULL"), nullable=True)
    study_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    semester: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # "active" | "repeating" | "on_leave" | "dropped" | "graduated"
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    is_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rollover_run_id: Mapped[str | None] = mapped_column(ForeignKey("rollover_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    student: Mapped[SqlUser] = relationship(foreign_keys=[student_id])
    session: Mapped[SqlAcademicSession] = relationship()
    batch: Mapped["SqlBatch | None"] = relationship()
    section: Mapped["SqlSection | None"] = relationship()


class SqlTeacherSessionAllocation(Base, TimestampedModel):
    """Session-aware mirror of a teacher's teaching allocations.

    users.assignments (a JSON blob) remains the source every existing
    screen reads from — this table is written alongside it so allocations
    can be carried forward by the rollover engine without an admin having
    to re-enter them every term. See
    the original academic-sessions plan Phase 6.
    """

    __tablename__ = "teacher_session_allocations"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("academic_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    program_id: Mapped[str | None] = mapped_column(ForeignKey("programs.id", ondelete="SET NULL"), nullable=True)
    batch_id: Mapped[str | None] = mapped_column(ForeignKey("batches.id", ondelete="SET NULL"), nullable=True)
    section_id: Mapped[str | None] = mapped_column(ForeignKey("sections.id", ondelete="SET NULL"), nullable=True)
    subject_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    rollover_run_id: Mapped[str | None] = mapped_column(ForeignKey("rollover_runs.id", ondelete="SET NULL"), nullable=True, index=True)


class SqlRolloverRun(Base):
    """One execution of the session-rollover engine. Rows created by that run
    (student_session_records, auto-created batches/sections/enrollments) are
    tagged with this id so the run can be audited and, within the allowed
    window, undone."""

    __tablename__ = "rollover_runs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    from_session_id: Mapped[str | None] = mapped_column(ForeignKey("academic_sessions.id", ondelete="SET NULL"), nullable=True)
    to_session_id: Mapped[str] = mapped_column(ForeignKey("academic_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    executed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    executed_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    counts: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    undone_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    from_session: Mapped["SqlAcademicSession | None"] = relationship(foreign_keys=[from_session_id])
    to_session: Mapped["SqlAcademicSession"] = relationship(foreign_keys=[to_session_id])
