"""Double-submit CSRF check (Sprint 6, the original implementation plan).

Only matters once the access token lives in a cookie the browser sends
automatically — a plain `Authorization: Bearer` header can't be forged by a
third-party site, but a cookie is sent on any request the browser makes to
this origin, CSRF included. `/login`/`/auth/refresh` mint the CSRF cookie
themselves (see `routes_fastapi/auth_routes.py`) and are exempt from this
check, since a request that doesn't have a session yet can't be expected to
already have a matching CSRF token.
"""

from __future__ import annotations

import secrets

from fastapi import FastAPI, Request

from core.errors import Forbidden, error_response

_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_EXEMPT_PATHS = frozenset({"/login", "/auth/refresh"})
CSRF_COOKIE_NAME = "campusgrade_csrf"
CSRF_HEADER_NAME = "X-CSRF-Token"


def register_csrf_middleware(app: FastAPI) -> None:
    """Call once, from `app.py`, alongside `register_error_handlers`."""

    @app.middleware("http")
    async def csrf(request: Request, call_next):
        if (
            request.method in _UNSAFE_METHODS
            and request.url.path not in _EXEMPT_PATHS
        ):
            cookie = request.cookies.get(CSRF_COOKIE_NAME, "")
            header = request.headers.get(CSRF_HEADER_NAME, "")
            if not cookie or not header or not secrets.compare_digest(cookie, header):
                return error_response(request, Forbidden("CSRF check failed"))
        return await call_next(request)
