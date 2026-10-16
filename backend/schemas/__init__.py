"""Pydantic request and response contracts for the CampusGrade API."""

from schemas.auth import LoginRequest, LoginResponse, TokenPayload
from schemas.common import ErrorResponse, MessageResponse, PaginatedResponse

__all__ = [
    "ErrorResponse", "LoginRequest", "LoginResponse", "MessageResponse",
    "PaginatedResponse", "TokenPayload",
]
