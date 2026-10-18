"""The permission matrix — enforced, not shadowed (Sprint 5, the original implementation plan).

Built in Sprint 3 as shadow-mode-only scaffolding logging mismatches against
`routes_fastapi.deps`'s `require_roles`. Sprint 5 turns shadow mode off:
`require(Permission.X)` is now what decides a route's outcome, wired onto
every admin-gated route that used to depend on `require_roles("admin")` or
one of the several near-identical local `_admin(...)` dependencies scattered
across the resource routers in `routes_fastapi/admin/*.py` (`courses.py`,
`batches.py`, `sections.py`, `subjects.py`, `academic_sessions.py`,
`session_rollover.py` each had their own copy — see CHANGELOG.md for the
full list of what got cut over this sprint and to which permission).

`shadowed()`/`shadow_check()` are kept, not deleted: the plan's own
"Rollback" section for this sprint says to "re-enable shadow mode by
feature flag if a mismatch appears in production." Nothing calls them after
this sprint's cutover, but they still work if a route needs to go back to
observe-only mode.
"""

from __future__ import annotations

import logging
from enum import Enum, IntEnum

from fastapi import Depends, Request

from core.principal import Principal, Role, require_principal

logger = logging.getLogger("CampusGrade.Policy")


# `str, Enum` rather than `enum.StrEnum` — see the same note in
# `core/principal.py::Role`.
class Permission(str, Enum):
    SESSION_MANAGE = "session.manage"
    ROLLOVER_EXECUTE = "rollover.execute"
    PROGRAM_MANAGE = "program.manage"
    ADMIN_MANAGE = "admin.manage"
    SETTINGS_MANAGE = "settings.manage"
    JOBS_MANAGE = "jobs.manage"
    DATA_EXPORT = "data.export"
    ASSIGNMENT_CREATE = "assignment.create"
    ASSIGNMENT_GRADE = "assignment.grade"
    GRADE_PUBLISH = "grade.publish"
    INTEGRITY_REVIEW = "integrity.review"
    AI_EVALUATE = "ai.evaluate"
    SUBMISSION_CREATE = "submission.create"
    REPORT_VIEW = "report.view"
    TEACHER_PORTAL = "portal.teacher"
    STUDENT_PORTAL = "portal.student"


# What an `admin` may do beyond the platform-wide permissions above is not a fixed role
# matrix: a Super Admin grants each admin a level (view / edit / full) per resource.
class Resource(str, Enum):
    BATCHES = "batches"
    SECTIONS = "sections"
    SUBJECTS = "subjects"
    USERS = "users"  # students and teachers: accounts, allocations
    ASSIGNMENTS = "assignments"  # the institution-wide assignment overview and overrides
    AUDIT_LOG = "audit_log"


class Access(IntEnum):
    """The level a route needs: VIEW reads, EDIT creates and changes, FULL also deletes."""

    VIEW = 1
    EDIT = 2
    FULL = 3


# Resources where "edit" and "full" make no sense (read-only data).
VIEW_ONLY_RESOURCES = frozenset({Resource.AUDIT_LOG})

S, A, T, U = Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER, Role.STUDENT

PERMISSIONS: dict[Permission, frozenset[Role]] = {
    # Institution-wide, structural, or destructive — super admin only.
    # Session/rollover apply to every program at once; the retired hierarchy and
    # program (course) creation/deletion are structural changes a program
    # admin's *scope* wouldn't even make sense for (you can't be scoped to
    # a program that doesn't exist yet); admin management and instance
    # settings are inherently platform-wide.
    Permission.SESSION_MANAGE: frozenset({S}),
    Permission.ROLLOVER_EXECUTE: frozenset({S}),
    Permission.PROGRAM_MANAGE: frozenset({S}),
    Permission.ADMIN_MANAGE: frozenset({S}),
    Permission.SETTINGS_MANAGE: frozenset({S}),
    Permission.JOBS_MANAGE: frozenset({S}),
    Permission.DATA_EXPORT: frozenset({S}),
    # Teacher-only actions on their own assignments.
    Permission.ASSIGNMENT_CREATE: frozenset({T}),
    Permission.ASSIGNMENT_GRADE: frozenset({T}),
    Permission.GRADE_PUBLISH: frozenset({T}),
    Permission.AI_EVALUATE: frozenset({T}),
    Permission.INTEGRITY_REVIEW: frozenset({S, A, T}),
    Permission.SUBMISSION_CREATE: frozenset({U}),
    Permission.REPORT_VIEW: frozenset({S, A, T, U}),
    Permission.TEACHER_PORTAL: frozenset({T}),
    Permission.STUDENT_PORTAL: frozenset({U}),
}


def require(permission: Permission):
    """The dependency every admin-gated route now uses in place of
    `require_roles(...)`/the several local `_admin(...)` copies this sprint
    retired. Raises `Forbidden` (403) if `principal.role` isn't in
    `PERMISSIONS[permission]`; otherwise returns the `Principal` so the
    route can use it for scoping (`core/scoping.py`) without a second query.
    """

    async def dependency(principal: Principal = Depends(require_principal)) -> Principal:
        from core.errors import Forbidden

        if principal.role not in PERMISSIONS[permission]:
            raise Forbidden(f"This action needs: {permission.value}")
        return principal

    dependency.__campusgrade_permission__ = permission  # type: ignore[attr-defined]
    return dependency


def access_summary(principal: Principal) -> dict[str, str]:
    """resource -> "view" | "edit" | "full" for what the principal may do (the UI uses it to
    show or hide screens; the server still checks every request). Empty for teachers and students."""
    summary: dict[str, str] = {}
    for resource in Resource:
        level = principal.access_level(resource.value)
        if level:
            summary[resource.value] = Access(min(level, Access.VIEW if resource in VIEW_ONLY_RESOURCES else Access.FULL)).name.lower()
    return summary


def require_access(resource: Resource, level: Access):
    """Gate a route by the access a Super Admin granted: a Super Admin always passes, an
    `admin` passes if their level on `resource` is at least `level`, everyone else is refused.
    Returns the `Principal`."""

    async def dependency(principal: Principal = Depends(require_principal)) -> Principal:
        from core.errors import Forbidden

        if principal.access_level(resource.value) < level:
            raise Forbidden(f"This action needs {level.name.lower()} access to {resource.value.replace('_', ' ')}")
        return principal

    dependency.__campusgrade_permission__ = f"{resource.value}.{level.name.lower()}"  # type: ignore[attr-defined]
    return dependency


def require_user_access(resource: Resource, level: Access):
    """`require_access` for route bodies that still read the legacy user dict (`admin["_id"]`)."""
    from routes_fastapi.deps import get_current_user

    async def dependency(
        current_user=Depends(get_current_user),
        principal: Principal = Depends(require_access(resource, level)),
    ):
        del principal
        return current_user

    dependency.__campusgrade_permission__ = f"{resource.value}.{level.name.lower()}"  # type: ignore[attr-defined]
    return dependency


def require_user(permission: Permission):
    """Enforce the canonical policy while preserving legacy dict-shaped users.

    This is the migration dependency for route bodies that still read keys
    such as ``teacher["_id"]``. Authentication is dependency-cached, so the
    user dictionary and Principal share the same one-query identity load.
    """
    from routes_fastapi.deps import get_current_user

    async def dependency(
        current_user=Depends(get_current_user),
        principal: Principal = Depends(require(permission)),
    ):
        del principal
        return current_user

    dependency.__campusgrade_permission__ = permission  # type: ignore[attr-defined]
    return dependency


def require_roles(*roles: str):
    """Compatibility spelling backed by the canonical permission matrix."""
    role_set = frozenset(roles)
    permission = {
        frozenset({"teacher"}): Permission.TEACHER_PORTAL,
        frozenset({"student"}): Permission.STUDENT_PORTAL,
    }.get(role_set)
    if permission is None:
        raise ValueError(f"No canonical portal permission for roles: {sorted(role_set)}")
    return require_user(permission)


def shadowed(*legacy_roles: str, permission: Permission):
    """Retired as of this sprint's cutover — no route depends on this
    anymore (see `require(...)` above). Kept, not deleted: the plan's
    rollback plan for Sprint 5 is "re-enable shadow mode by feature flag if
    a mismatch appears in production," and this is that feature flag's
    implementation. Drop-in replacement for `Depends(require_roles(*legacy_roles))`:
    keeps the exact same enforcement (the legacy dependency still runs and
    still decides) but additionally builds a `Principal` and runs
    `shadow_check` against it, logging any mismatch.

    Known gap: because the legacy dependency raises `HTTPException` itself
    on denial, this only observes (and can only log a mismatch for) the
    "legacy allowed it" path — a request the legacy check *denies* that the
    new engine would have *allowed* never reaches `shadow_check` at all.
    """
    from routes_fastapi.deps import require_roles

    legacy_dependency = require_roles(*legacy_roles)

    async def dependency(request: Request, user=Depends(legacy_dependency), principal: Principal = Depends(require_principal)):
        shadow_check(request, permission, principal, legacy_allowed=True)
        return user

    return dependency


def shadow_check(request: Request, permission: Permission, principal: Principal, legacy_allowed: bool) -> bool:
    """Compute the new engine's answer, compare it to what the legacy check
    just decided, and log any disagreement — without changing the outcome.
    `legacy_allowed` always wins; this function returns it unchanged.
    """
    new_allowed = principal.role in PERMISSIONS.get(permission, frozenset())
    if new_allowed != legacy_allowed:
        logger.warning(
            "policy_mismatch",
            extra={
                "permission": permission.value,
                "role": principal.role.value,
                "legacy_allowed": legacy_allowed,
                "new_allowed": new_allowed,
                "path": request.url.path,
                "user_id": principal.user_id,
            },
        )
    return legacy_allowed
