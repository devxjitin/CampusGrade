from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class AuthUserResponse(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str
    course: str | None = None
    batch: str | None = None
    roll_no: str | None = None
    assignments: list = Field(default_factory=list)
    avatar: str | None = None
    must_change_password: bool = False


class LoginResponse(BaseModel):
    message: str
    token: str
    user: AuthUserResponse
    session_id: str | None = None


class TokenPayload(BaseModel):
    user_id: str
    session_version: int = Field(ge=0)
    iat: datetime | int | None = None
    exp: datetime | int | None = None


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=1, max_length=254)


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=1, max_length=256)
