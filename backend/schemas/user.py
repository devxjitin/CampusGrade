from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    # Sprint 5, the original implementation plan: "admin" split into "super_admin"/
    # "admin" (see migrations `canvasgrade_022` and `canvasgrade_031`).
    role: str = Field(pattern="^(super_admin|admin|teacher|student)$")
    teacher_id: str | None = Field(default=None, max_length=50)
    roll_no: str | None = Field(default=None, max_length=50)
    course_id: str | None = Field(default=None, max_length=64)
    batch_id: str | None = Field(default=None, max_length=64)
    section_id: str | None = Field(default=None, max_length=64)


class StudentCreate(UserCreate):
    role: str = "student"
    roll_no: str = Field(min_length=1, max_length=50)
    course: str | None = Field(default=None, max_length=100)
    batch: str | None = Field(default=None, max_length=30)
    contact_number: str | None = Field(default=None, max_length=50)
    year: int | None = Field(default=None, ge=1, le=12)
    semester: int | None = Field(default=None, ge=1, le=24)
    # Alternative to batch_id: admin picks the course + the year the student
    # is joining, and the server resolves (or creates) the matching batch —
    # see the original academic-sessions plan Part 3. Ignored if batch_id
    # is also supplied.
    admission_year: int | None = Field(default=None, ge=1900, le=3000)


class TeacherAssignment(BaseModel):
    """One teacher teaching allocation within the academic hierarchy."""

    program_id: str = Field(min_length=1, max_length=64)
    batch_id: str = Field(min_length=1, max_length=64)
    section_id: str = Field(min_length=1, max_length=64)
    subject_ids: list[str] = Field(min_length=1, max_length=100)

    @field_validator("subject_ids")
    @classmethod
    def validate_subject_ids(cls, value: list[str]) -> list[str]:
        normalized = [str(subject_id).strip() for subject_id in value if str(subject_id).strip()]
        if not normalized:
            raise ValueError("At least one course is required")
        if len(normalized) != len(set(normalized)):
            raise ValueError("A course can only be selected once per assignment")
        return normalized


class TeacherCreate(UserCreate):
    role: str = "teacher"
    teacher_id: str = Field(min_length=1, max_length=50)
    contact_number: str = Field(min_length=2, max_length=50)
    designation: str | None = Field(default=None, max_length=100)
    assignments: list[TeacherAssignment] = Field(min_length=1, max_length=100)


class UserStatusUpdate(BaseModel):
    is_active: bool


class CreatedUser(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str = Field(pattern="^(teacher|student)$")


class CreatedUserResponse(BaseModel):
    message: str
    user: CreatedUser


class AssignmentsUpdate(BaseModel):
    assignments: list[TeacherAssignment] = Field(min_length=1, max_length=100)


class AdminUserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    email: EmailStr | None = None
    role: str | None = Field(default=None, pattern="^(super_admin|admin|teacher|student)$")
    roll_no: str | None = Field(default=None, max_length=50)
    teacher_id: str | None = Field(default=None, max_length=50)
    contact_number: str | None = Field(default=None, max_length=50)
    designation: str | None = Field(default=None, max_length=100)
    is_active: bool | None = None
    assignments: list[TeacherAssignment] | None = Field(default=None, max_length=100)
    course: str | None = Field(default=None, max_length=100)
    batch: str | None = Field(default=None, max_length=30)
    course_id: str | None = Field(default=None, max_length=64)
    batch_id: str | None = Field(default=None, max_length=64)
    section_id: str | None = Field(default=None, max_length=64)
    year: int | None = Field(default=None, ge=1, le=12)
    semester: int | None = Field(default=None, ge=1, le=24)


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    github_username: str | None = Field(default=None, max_length=100)
    bio: str | None = Field(default=None, max_length=5000)
    roll_no: str | None = Field(default=None, max_length=50)
    batch_year: str | None = Field(default=None, max_length=100)
    achievements: list[str] | None = Field(default=None, max_length=10)
    github_repositories: list[str] | None = Field(default=None, max_length=10)
    leetcode_username: str | None = Field(default=None, max_length=100)

    @field_validator("achievements", "github_repositories")
    @classmethod
    def validate_string_lists(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and any(not item.strip() for item in value):
            raise ValueError("List items cannot be blank")
        return value


class UserResponse(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str
    bio: str = ""
    avatar: str | None = None
    course: str | None = None
    batch: str | None = None
    roll_no: str | None = None
    semester: int | None = None
    assignments: list = Field(default_factory=list)
    achievements: list[str] = Field(default_factory=list)
    github_repositories: list[str] = Field(default_factory=list)
    github_username: str = ""
    leetcode_username: str = ""
    last_login: datetime | None = None
    created_at: datetime | None = None
