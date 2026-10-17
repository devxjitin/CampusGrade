"""Policy engine, roles live (Sprint 5, the original implementation plan).

`Principal` is the one object that answers "who is making this request, and
what are they scoped to" — built once per request from a single query, so
new code stops calling `get_user_by_id()` (which opens its own sync session
per call) to re-derive the same thing route by route.

This module started in Sprint 3 as shadow-mode-only scaffolding adapted to
the three roles that existed then (`admin`/`teacher`/`student`). Sprint 5's
migration `canvasgrade_022` renamed every existing `admin` to `super_admin`
and added a `program_admin` role enforced by a DB `CHECK` constraint — so
`Role` here now matches the plan's real four-role sketch, and
`core/policy.py::require(...)` (not `shadow_check`) is what decides a
request's outcome from this sprint on.

An `admin` is not scoped to programs: they see every program, and what they may
do is the per-resource `access` a Super Admin set in `admin_access` (see
`core/policy.py::require_access`).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum

from fastapi import Depends, Request
from routes_fastapi.deps import get_current_user

from core.errors import Unauthenticated


# `str, Enum` rather than `enum.StrEnum` (added in 3.11) — this project
# targets Python 3.10+ (see `requires-python`/`[tool.mypy] python_version`
# in `pyproject.toml`), and this is the same pattern the existing
# `routes_fastapi.deps.Permission` enum already uses.
class Role(str, Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    TEACHER = "teacher"
    STUDENT = "student"


# Kept as a named constant (rather than `frozenset({"*"})` inline at every
# call site) so scoping code can test `principal.program_ids is ALL_PROGRAMS`
# / `== ALL_PROGRAMS` for the "unscoped" case without a magic string.
ALL_PROGRAMS = frozenset({"*"})


@dataclass(frozen=True, slots=True)
class Principal:
    user_id: str
    role: Role
    status: str  # "active" | "suspended" — mirrors SqlUser.is_active today
    session_id: str | None
    program_ids: frozenset[str]  # ALL_PROGRAMS for both admin tiers (admins are not scoped to programs)
    offering_ids: frozenset[str]  # subject_ids a teacher is allocated to teach
    must_change_password: bool
    # resource -> access level (1 view, 2 edit, 3 full) a Super Admin granted this `admin`.
    access: Mapping[str, int] = field(default_factory=dict)

    @property
    def is_super(self) -> bool:
        return self.role is Role.SUPER_ADMIN

    @property
    def is_admin(self) -> bool:
        return self.role is Role.ADMIN

    @property
    def is_admin_tier(self) -> bool:
        return self.role in (Role.SUPER_ADMIN, Role.ADMIN)

    def access_level(self, resource: str) -> int:
        """0 = none. A Super Admin has full access to everything."""
        if self.is_super:
            return 3
        return int(self.access.get(resource, 0)) if self.is_admin else 0


def _role_from_string(value: str) -> Role:
    try:
        return Role(value)
    except ValueError as exc:
        # A row with an unrecognised role string is a data-integrity bug,
        # not an authorization decision — fail loudly rather than silently
        # treating an unknown role as unauthenticated or as student. If
        # this fires in production, migration `canvasgrade_022` (or its
        # `ck_users_role` constraint) didn't run the way this code assumes.
        raise ValueError(f"Unknown user role {value!r} — cannot build a Principal") from exc


async def build_principal(
    request: Request,
    current_user: dict = Depends(get_current_user),
) -> Principal:
    """Build a `Principal` for the already-authenticated request.

    Reuses `get_current_user`'s token/session validation (expiry, session
    revocation, suspension, forced password change) rather than
    reimplementing it — this function only adds the extra query(ies)
    `get_current_user` doesn't fetch today: a teacher's subject allocation,
    or a program admin's program scopes.
    """
    # The identity service puts the primary key under
    # `_id`, not `id` — mirroring the JWT/legacy dict shape the rest of the
    # backend already relies on.
    user_id = str(current_user["_id"])
    role = _role_from_string(current_user["role"])

    offering_ids = frozenset(current_user.get("_offering_ids") or ())

    if role in (Role.SUPER_ADMIN, Role.ADMIN):
        program_ids = ALL_PROGRAMS
    else:
        program_ids = frozenset()
    access = dict(current_user.get("_access") or {}) if role is Role.ADMIN else {}

    return Principal(
        user_id=user_id,
        role=role,
        status="active" if current_user.get("is_active", True) else "suspended",
        session_id=current_user.get("_session_id"),
        program_ids=program_ids,
        offering_ids=offering_ids,
        must_change_password=bool(current_user.get("must_change_password")),
        access=access,
    )


async def require_principal(principal: Principal = Depends(build_principal)) -> Principal:
    """Thin re-export so route code can depend on `require_principal` the
    way the rest of the plan's snippets do, without every call site needing
    to know `build_principal` is the underlying implementation."""
    if principal.status != "active":
        raise Unauthenticated("Your account has been suspended. Contact administration.")
    return principal
