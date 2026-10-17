"""Reusable SQL-level authorization scopes."""

from __future__ import annotations

from sqlalchemy import ColumnElement, Select
from sqlalchemy.sql.elements import ColumnClause

from core.errors import Forbidden
from core.principal import Principal, Role


def scope_to_programs(stmt: Select, principal: Principal, program_col: ColumnClause | ColumnElement) -> Select:
    """Restrict a statement to the programs visible to the principal.

    Both admin tiers see every program (admins are limited by `access`, not by program)."""
    del program_col
    if principal.is_admin_tier:
        return stmt
    raise Forbidden("This action is for administrators.")


def scope_to_offerings(stmt: Select, principal: Principal, subject_col: ColumnClause | ColumnElement) -> Select:
    """Restrict a statement to the subjects allocated to teaching staff."""
    if principal.is_super:
        return stmt
    if principal.role is Role.TEACHER:
        return stmt.where(subject_col.in_(principal.offering_ids))
    raise Forbidden("This action is scoped to teaching staff.")
