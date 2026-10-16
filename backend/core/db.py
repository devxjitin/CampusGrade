"""The async session dependency new routes should use (Sprint 2, IMPLEMENTATION_PLAN.md).

`models/database.py` already built the async engine, `async_session_factory`,
and a `get_db()` generator with the right transaction semantics (commit on
success, rollback on exception) — that predates this sprint. This module
doesn't duplicate any of that; it re-exports it under the name the plan
uses (`db_session`) so route code has one obvious, named place to import
the dependency from, and so `core/` — where Sprint 1 already put the new
config/errors/logging modules — stays the actual home for cross-cutting
infrastructure rather than routes reaching into `models.database` directly.

Do not add a second engine here. There is exactly one: `models.database.async_engine`.
"""

from __future__ import annotations

from models.database import async_engine as engine
from models.database import async_session_factory as session_factory
from models.database import get_db as db_session

__all__ = ["db_session", "engine", "session_factory"]
