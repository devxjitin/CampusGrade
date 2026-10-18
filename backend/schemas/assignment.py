from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator


class RubricCriterionInput(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    title: str = Field(min_length=1, max_length=150)
    description: str = Field(default="", max_length=2000)
    max_marks: float = Field(gt=0, le=1000)


class AssignmentLinkInput(BaseModel):
    label: str = Field(min_length=1, max_length=150)
    url: HttpUrl


class AssignmentCreate(BaseModel):
    title: str = Field(default="", max_length=255)
    instructions: str = Field(default="", max_length=50_000)
    subject: str | None = Field(default=None, max_length=255)
    subject_id: str | None = Field(default=None, max_length=64)
    short_description: str = Field(default="", max_length=500)
    difficulty: Literal["beginner", "intermediate", "advanced"] = "intermediate"
    estimated_minutes: int | None = Field(default=None, ge=15, le=100_000)
    learning_outcomes: list[str] = Field(default_factory=list, max_length=20)
    tags: list[str] = Field(default_factory=list, max_length=20)
    starter_repository_url: str | None = Field(default=None, max_length=500)
    repository_requirements: dict = Field(default_factory=dict)
    target_course_id: str | None = Field(default=None, max_length=64)
    target_batch_id: str | None = Field(default=None, max_length=64)
    target_section_id: str | None = Field(default=None, max_length=64)
    total_marks: float = Field(default=20, gt=0, le=10_000)
    opens_at: datetime | None = None
    due_at: datetime | None = None
    allow_late: bool = False
    late_until: datetime | None = None
    status: Literal["published"] = "published"
    result_release_mode: Literal["manual", "scheduled"] = "manual"
    result_release_at: datetime | None = None
    rubric: list[RubricCriterionInput] = Field(min_length=1, max_length=20)
    links: list[AssignmentLinkInput] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def validate_schedule_and_marks(self):
        if (
            not self.title.strip()
            or not self.instructions.strip()
            or not self.target_course_id
            or not self.target_batch_id
            or not self.target_section_id
            or not self.subject_id
            or not self.due_at
        ):
            raise ValueError("Title, instructions, audience, course, and deadline are required")
        if self.opens_at and self.due_at and self.due_at <= self.opens_at:
            raise ValueError("Deadline must be after the opening time")
        if self.allow_late or self.late_until:
            raise ValueError("Late submissions are not accepted")
        self.allow_late = False
        self.late_until = None
        if self.result_release_mode == "scheduled":
            if not self.result_release_at:
                raise ValueError("A scheduled result release time is required")
            if self.due_at and self.result_release_at < self.due_at:
                raise ValueError("Result release time must be at or after the assignment deadline")
        else:
            self.result_release_at = None
        rubric_total = sum(item.max_marks for item in self.rubric)
        if abs(rubric_total - self.total_marks) > 0.001:
            raise ValueError("Rubric marks must equal total marks")
        return self


class AssignmentUpdate(AssignmentCreate):
    pass


class ExternalAIProposalValidate(BaseModel):
    """Validate AI JSON. With a draft_token it must match that prompt; without one (the teacher's own JSON) the class is given as IDs."""

    draft_token: str | None = Field(default=None, max_length=4000)
    program_id: str | None = Field(default=None, max_length=64)
    batch_id: str | None = Field(default=None, max_length=64)
    section_id: str | None = Field(default=None, max_length=64)
    subject_id: str | None = Field(default=None, max_length=64)
    proposal: dict

    @model_validator(mode="after")
    def _needs_token_or_class(self):
        if not self.draft_token and not all((self.program_id, self.batch_id, self.section_id, self.subject_id)):
            raise ValueError("Provide draft_token, or program_id, batch_id, section_id and subject_id")
        return self


class ExternalAIPromptRequest(BaseModel):
    program_id: str = Field(min_length=1, max_length=64)
    batch_id: str = Field(min_length=1, max_length=64)
    section_id: str = Field(min_length=1, max_length=64)
    subject_id: str = Field(min_length=1, max_length=64)
    brief: str = Field(min_length=1, max_length=12_000)
    guidance: str = Field(default="", max_length=4_000)
    total_marks: float = Field(default=20, gt=0, le=10_000)
    rubric_count: int = Field(default=5, ge=1, le=20)
    difficulty: Literal["beginner", "intermediate", "advanced"] = "intermediate"
    require_readme: bool = True


class RepositoryPreviewRequest(BaseModel):
    repository_url: str = Field(min_length=10, max_length=500)


class RepositorySubmitRequest(BaseModel):
    preview_token: str = Field(min_length=20, max_length=5000)


class RepositoryResetRequest(BaseModel):
    reason: str = Field(min_length=10, max_length=1000)


class GradeInput(BaseModel):
    rubric_scores: dict[str, float] = Field(default_factory=dict)
    rubric_feedback: dict[str, dict] = Field(default_factory=dict)
    expected_revision: int | None = Field(default=None, ge=1)
    missing: bool = False


class ExternalEvaluationExportRequest(BaseModel):
    """`files` embeds every repository file (batches of up to 10); `links` sends one GitHub link per student for the whole class."""

    mode: Literal["files", "links"] = "files"


class ExternalEvaluationValidateInput(BaseModel):
    batch_token: str = Field(min_length=20, max_length=20_000)
    result: dict


class BulkExternalGradeStudentInput(BaseModel):
    student_id: str = Field(min_length=1, max_length=64)
    submission_version_id: str = Field(min_length=1, max_length=64)
    rubric_scores: dict[str, float]
    rubric_feedback: dict[str, dict]
    expected_revision: int | None = Field(default=None, ge=1)
    batch_token: str = Field(min_length=20, max_length=20_000)
    duplicate_confirmed: bool = False
    duplicate_flag_ids: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("rubric_feedback")
    @classmethod
    def rubric_feedback_must_not_be_blank(cls, value: dict):
        if not value:
            raise ValueError("Rubric feedback is required for every student")
        return value


class BulkExternalGradeInput(BaseModel):
    schema_version: Literal[1] = 1
    students: list[BulkExternalGradeStudentInput] = Field(min_length=1, max_length=500)


class WithdrawGradeInput(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class AnnouncementInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=20_000)


class AdminAssignmentActionInput(BaseModel):
    action: Literal["reassign", "lock", "unlock", "archive"]
    teacher_id: str | None = Field(default=None, max_length=64)
    reason: str = Field(default="", max_length=2000)
