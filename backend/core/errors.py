"""One exception hierarchy, one response shape (Sprint 1, IMPLEMENTATION_PLAN.md).

Every error the API returns deliberately (not an unhandled 500) should raise
one of these instead of `HTTPException(status_code=..., detail=...)`
scattered across ~90 call sites. The response body is RFC 9457
(`application/problem+json`) but keeps the `detail` key the current
frontend already reads from `error.response.data.message` — see
`_build_user_response`-adjacent code in `frontend/src/lib/api.ts` — so no
frontend change is required in this sprint. `code` and `type` are new and
additive; the frontend starts using `code` in this same sprint (see
`frontend/src/lib/errors.ts`), and existing `.message` reads keep working
unchanged.

Existing routes are NOT ported to raise these in this sprint — that is
mechanical work bundled into the Sprint 2 route-by-route port (which is
already touching every route to move it onto the async session). Raising
`HTTPException` directly still works: `register_error_handlers` here also
normalizes `HTTPException` into the same response shape, and the
`RequestValidationError` handler is likewise ported over as-is. So this
sprint changes the response envelope for HTTPException/validation errors
without moving business logic.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

PROBLEM_BASE_URL = "https://campusgrade.dev/errors"
logger = logging.getLogger("CampusGrade.Errors")


class AppError(Exception):
    """Base class for every deliberately-raised API error.

    Subclass this for a new error family rather than passing `code=` by
    hand at each call site — that is what makes the code stable enough for
    the frontend's `errors.ts` map (and, from Sprint 3, the authorization
    matrix test) to rely on it.
    """

    status: int = 400
    code: str = "APP_ERROR"
    title: str = "Request failed"

    def __init__(self, detail: str | None = None, **extra: object) -> None:
        super().__init__(detail or self.title)
        self.detail = detail or self.title
        self.extra = extra


class Invalid(AppError):
    status, code, title = 422, "INVALID", "Some fields need attention"


class Unauthenticated(AppError):
    status, code, title = 401, "UNAUTHENTICATED", "Please sign in"


class Forbidden(AppError):
    status, code, title = 403, "FORBIDDEN", "You do not have access to do that"


class NotFound(AppError):
    status, code, title = 404, "NOT_FOUND", "We couldn't find that"


class Conflict(AppError):
    status, code, title = 409, "CONFLICT", "This changed while you were working on it"


class RateLimited(AppError):
    status, code, title = 429, "RATE_LIMITED", "Too many requests — please slow down"


class Unavailable(AppError):
    status, code, title = 503, "UNAVAILABLE", "This service is not ready yet"


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "unknown")


def _problem_type(code: str) -> str:
    return f"{PROBLEM_BASE_URL}/{code.lower().replace('_', '-')}"


def _problem_response(*, status: int, code: str, title: str, detail: object, request_id: str, headers: Mapping[str, str] | None = None, extra: dict[str, object] | None = None) -> JSONResponse:
    # `extra` is taken as one explicit dict rather than `**kwargs` — with a
    # `**kwargs` catch-all sitting next to a differently-typed keyword-only
    # parameter (`headers: dict | None`), mypy checks an unpacked `**dict`
    # call site against *every* keyword-only parameter it could satisfy,
    # including `headers`, and fails a call that never touches `headers` at
    # all. Naming it explicitly removes the ambiguity.
    return JSONResponse(
        status_code=status,
        media_type="application/problem+json",
        headers=headers,
        content={
            "type": _problem_type(code),
            "title": title,
            "status": status,
            "code": code,
            "detail": detail,
            "request_id": request_id,
            **(extra or {}),
        },
    )


def error_response(request: Request, error: AppError) -> JSONResponse:
    """Build the same `application/problem+json` body
    `handle_app_error` below produces, callable directly.

    Needed by `core/csrf.py`'s middleware (Sprint 6, IMPLEMENTATION_PLAN.md):
    an exception *raised* from inside a `@app.middleware("http")` function
    does not reach the `@app.exception_handler` registered below — that's a
    documented FastAPI/Starlette limitation, not a bug in this app —
    middleware code that wants the same error envelope has to build and
    `return` the response itself instead of raising.
    """
    return _problem_response(
        status=error.status,
        code=error.code,
        title=error.title,
        detail=error.detail,
        request_id=_request_id(request),
        extra=error.extra,
    )


def register_error_handlers(app: FastAPI) -> None:
    """Call once, from `app.py`, after the FastAPI instance is created."""

    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        return _problem_response(
            status=exc.status,
            code=exc.code,
            title=exc.title,
            detail=exc.detail,
            request_id=_request_id(request),
            extra=exc.extra,
        )

    @app.exception_handler(HTTPException)
    async def handle_http_exception(request: Request, exc: HTTPException) -> JSONResponse:
        # Existing routes raise plain HTTPException — normalize its shape to
        # match AppError's so the frontend has exactly one envelope to
        # handle, without requiring every route to be touched this sprint.
        message = exc.detail if isinstance(exc.detail, str) else "Request failed"
        code = f"HTTP_{exc.status_code}"
        return _problem_response(
            status=exc.status_code,
            code=code,
            title=message,
            detail=exc.detail if isinstance(exc.detail, str) else message,
            request_id=_request_id(request),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        details = jsonable_encoder(exc.errors())
        return _problem_response(
            status=422,
            code="REQUEST_VALIDATION_FAILED",
            title="Request validation failed",
            detail=details,
            request_id=_request_id(request),
            extra={"errors": details},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        """Keep unexpected failures observable without leaking internals.

        This is the final envelope guarantee for Sprint 1: even an unhandled
        application error carries the same stable code and request id as
        deliberate 4xx/5xx responses. The traceback stays in structured logs.
        """
        logger.exception(
            "unhandled_request_error",
            extra={"request_id": _request_id(request), "path": request.url.path},
            exc_info=exc,
        )
        return _problem_response(
            status=500,
            code="INTERNAL_ERROR",
            title="Internal server error",
            detail="An unexpected error occurred.",
            request_id=_request_id(request),
        )
