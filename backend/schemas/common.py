from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class MessageResponse(BaseModel):
    message: str


class SuccessMessage(MessageResponse):
    pass


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | list[Any] | None = None
    request_id: str


class ErrorEnvelope(BaseModel):
    error: ErrorResponse


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    page: int = Field(ge=1)
    per_page: int = Field(ge=1)
    total: int = Field(ge=0)
    pages: int = Field(ge=0)
