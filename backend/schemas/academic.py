from datetime import date

from pydantic import BaseModel, Field, model_validator


class CourseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=50)
    duration_years: int = Field(default=4, ge=1, le=10)
    year: int = Field(default=1, ge=1, le=12)


class BatchCreate(BaseModel):
    course_id: str = Field(min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=100)
    start_year: int = Field(ge=1900, le=3000)
    end_year: int = Field(ge=1900, le=3000)

    @model_validator(mode="after")
    def valid_years(self):
        if self.end_year < self.start_year:
            raise ValueError("end_year must not be before start_year")
        return self


class SectionCreate(BaseModel):
    course_id: str = Field(min_length=1, max_length=64)
    batch_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=100)


class SubjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=50)
    course_id: str = Field(min_length=1, max_length=64)
    batch_id: str | None = Field(default=None, max_length=64)
    year: int = Field(default=1, ge=1, le=12)
    credits: int = Field(default=3, ge=0, le=30)
    enrollment_type: str = Field(default="compulsory", pattern="^(compulsory|optional)$")


class CourseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    code: str | None = Field(default=None, min_length=1, max_length=50)
    duration_years: int | None = Field(default=None, ge=1, le=10)
    year: int | None = Field(default=None, ge=1, le=12)


class BatchUpdate(BaseModel):
    course_id: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=100)
    start_year: int | None = Field(default=None, ge=1900, le=3000)
    end_year: int | None = Field(default=None, ge=1900, le=3000)


class SectionUpdate(BaseModel):
    course_id: str | None = Field(default=None, min_length=1, max_length=64)
    batch_id: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=100)


class AcademicSessionCreate(BaseModel):
    label: str = Field(min_length=1, max_length=50)
    term: str = Field(pattern="^(odd|even)$")
    start_date: date
    end_date: date
    is_current: bool = False

    @model_validator(mode="after")
    def valid_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        return self


class AcademicSessionUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=50)
    term: str | None = Field(default=None, pattern="^(odd|even)$")
    start_date: date | None = None
    end_date: date | None = None
    is_current: bool | None = None


class SubjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    code: str | None = Field(default=None, min_length=1, max_length=50)
    course_id: str | None = Field(default=None, max_length=64)
    batch_id: str | None = Field(default=None, max_length=64)
    year: int | None = Field(default=None, ge=1, le=12)
    credits: int | None = Field(default=None, ge=0, le=30)
    enrollment_type: str | None = Field(default=None, pattern="^(compulsory|optional)$")
