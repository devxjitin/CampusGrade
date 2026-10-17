"""Sprint 5, the original implementation plan — the authorization matrix, roles live.

Started in Sprint 3 as shadow-mode-only tests over a 3-role matrix
(`admin`/`teacher`/`student`, `shadow_check` logging mismatches without
deciding anything). Sprint 5's migration `canvasgrade_022` split `admin`
into `super_admin`/`program_admin` and `core.policy.require(...)` now
enforces `PERMISSIONS` directly — so this file tests the real enforcement
path (`require`) instead of only the legacy-comparison scaffolding
(`_LEGACY_EQUIVALENT`, retired this sprint along with shadow mode's role in
deciding anything).

None of this needs Docker/Postgres — `Principal`/`Role`/`Permission` are
plain dataclasses/enums, and `require(...)`'s returned dependency can be
called directly with a hand-built `Principal`, the same style
`test_security.py` already uses for `require_roles`. The one test that
needs a real database (`scope_to_programs` actually filtering real rows) is
in `test_program_admin_scoping.py`, Docker-gated like the rest of this
project's real-database tests.
"""

from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from core.errors import Forbidden
from core.policy import PERMISSIONS, Permission, require, shadow_check
from core.principal import ALL_PROGRAMS, Principal, Role
from core.scoping import scope_to_offerings, scope_to_programs
from models.assignment import SqlAssignment
from models.sql_models import SqlBatch
from services.identity_service import load_authenticated_user
from sqlalchemy import select


def test_every_application_route_has_an_explicit_authentication_gate() -> None:
    from app import app

    public = {
        ("GET", "/health"),
        ("GET", "/ready"),
        ("POST", "/login"),
        ("POST", "/auth/refresh"),
        # Password recovery is for people who cannot sign in (Sprint 4); both are rate limited.
        ("POST", "/auth/forgot-password"),
        ("POST", "/auth/reset-password"),
    }
    auth_dependencies = {"get_current_user", "require_principal"}
    uncovered = []
    for route in app.routes:
        if not hasattr(route, "dependant"):
            continue
        methods = set(route.methods or ()) - {"HEAD", "OPTIONS"}
        if all((method, route.path) in public for method in methods):
            continue
        dependencies = [item.call for item in route.dependant.dependencies]
        gated = any(
            getattr(call, "__name__", "") in auth_dependencies
            or getattr(call, "__campusgrade_permission__", None) is not None
            for call in dependencies
        )
        if not gated:
            uncovered.append(f"{','.join(sorted(methods))} {route.path}")
    assert uncovered == []


def test_authenticated_principal_data_uses_one_database_round_trip() -> None:
    user = SimpleNamespace(
        id="u1", name="Teacher", email="teacher@example.edu", password="hash",
        role="teacher", course=None, batch=None, course_id=None, batch_id=None,
        section_id=None, roll_no=None, assignments=[], achievements=[],
        github_repositories=[], github_username=None, leetcode_username=None,
        avatar=None, bio=None, is_active=True, session_version=0,
        must_change_password=False, login_attempts=0, locked_until=None,
        last_login=None, created_at=None, created_by=None,
    )
    result = Mock()
    result.all.return_value = [(user, None, ["subject-1"], None, None, None)]
    db = SimpleNamespace(execute=AsyncMock(return_value=result))

    loaded = asyncio.run(load_authenticated_user(db, "u1", None))

    assert db.execute.await_count == 1
    assert loaded is not None
    assert loaded["_offering_ids"] == frozenset({"subject-1"})


def test_program_scope_compiles_to_an_in_predicate() -> None:
    principal = _principal(Role.PROGRAM_ADMIN, frozenset({"program-a", "program-b"}))
    statement = scope_to_programs(select(SqlBatch), principal, SqlBatch.course_id)
    compiled = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "batches.course_id IN" in compiled
    assert "'program-a'" in compiled and "'program-b'" in compiled


def test_teacher_scope_compiles_to_an_in_predicate() -> None:
    principal = Principal(
        user_id="teacher-1", role=Role.TEACHER, status="active", session_id=None,
        program_ids=frozenset(), offering_ids=frozenset({"subject-a", "subject-b"}),
        must_change_password=False,
    )
    statement = scope_to_offerings(select(SqlAssignment), principal, SqlAssignment.subject_id)
    compiled = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "assignments.subject_id IN" in compiled
    assert "'subject-a'" in compiled and "'subject-b'" in compiled


def _principal(role: Role, program_ids: frozenset[str] = frozenset()) -> Principal:
    return Principal(
        user_id="u1",
        role=role,
        status="active",
        session_id=None,
        program_ids=ALL_PROGRAMS if role is Role.SUPER_ADMIN else program_ids,
        offering_ids=frozenset(),
        must_change_password=False,
    )


@pytest.mark.parametrize("permission", list(Permission))
@pytest.mark.parametrize("role", list(Role))
def test_require_matches_the_permissions_matrix(permission: Permission, role: Role) -> None:
    """`require(permission)`'s dependency, called directly with a hand-built
    `Principal`, must agree with `PERMISSIONS[permission]` exactly — this is
    the "authorization matrix test" the plan calls "the most valuable test
    in the codebase" (Sprint 3), now checked against real roles instead of
    a shadow-mode comparison."""
    dependency = require(permission)
    principal = _principal(role)
    expected_allowed = role in PERMISSIONS[permission]

    if expected_allowed:
        result = asyncio.run(dependency(principal=principal))
        assert result is principal
    else:
        with pytest.raises(Forbidden):
            asyncio.run(dependency(principal=principal))


def test_every_permission_names_at_least_one_role() -> None:
    """Guards against a typo leaving a permission unreachable by any role."""
    for permission, roles in PERMISSIONS.items():
        assert roles, f"{permission.value} grants no role at all"


def test_super_admin_can_do_everything_program_admin_can() -> None:
    """Not literally true of the plan's sketch (program admin has no
    teacher/student-only permissions either, same as super admin) — this
    checks the actual invariant that matters: nothing a program admin can
    do is withheld from a super admin."""
    for permission, roles in PERMISSIONS.items():
        if Role.PROGRAM_ADMIN in roles:
            assert Role.SUPER_ADMIN in roles, f"{permission.value} allows program_admin but not super_admin"


class _Req:
    def __init__(self, path: str = "/test"):
        self.url = type("_U", (), {"path": path})()


def test_shadow_check_returns_legacy_allowed_unchanged_on_agreement() -> None:
    principal = _principal(Role.TEACHER)
    result = shadow_check(_Req(), Permission.ASSIGNMENT_CREATE, principal, legacy_allowed=True)
    assert result is True


def test_shadow_check_returns_legacy_allowed_unchanged_on_disagreement() -> None:
    principal = _principal(Role.STUDENT)
    result = shadow_check(_Req(), Permission.ASSIGNMENT_CREATE, principal, legacy_allowed=True)
    assert result is True


def test_shadow_check_logs_on_mismatch(caplog: pytest.LogCaptureFixture) -> None:
    principal = _principal(Role.STUDENT)
    with caplog.at_level(logging.WARNING, logger="CampusGrade.Policy"):
        shadow_check(_Req("/assignments/teacher"), Permission.ASSIGNMENT_CREATE, principal, legacy_allowed=True)
    assert any(record.message == "policy_mismatch" for record in caplog.records)


def test_shadow_check_does_not_log_on_agreement(caplog: pytest.LogCaptureFixture) -> None:
    principal = _principal(Role.TEACHER)
    with caplog.at_level(logging.WARNING, logger="CampusGrade.Policy"):
        shadow_check(_Req("/assignments/teacher"), Permission.ASSIGNMENT_CREATE, principal, legacy_allowed=True)
    assert not any(record.message == "policy_mismatch" for record in caplog.records)


def test_principal_is_super_only_for_super_admin() -> None:
    assert _principal(Role.SUPER_ADMIN).is_super
    assert not _principal(Role.PROGRAM_ADMIN).is_super
    assert not _principal(Role.TEACHER).is_super
    assert not _principal(Role.STUDENT).is_super


def test_principal_is_program_admin_only_for_program_admin() -> None:
    assert _principal(Role.PROGRAM_ADMIN).is_program_admin
    assert not _principal(Role.SUPER_ADMIN).is_program_admin
    assert not _principal(Role.TEACHER).is_program_admin
