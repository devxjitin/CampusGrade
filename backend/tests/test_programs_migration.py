"""Docker-free Sprint 8 schema safety tests."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest
from models.database import Base


def _migration_module():
    path = Path(__file__).parents[1] / "migrations" / "versions" / "20260730_24_programs_remove_departments.py"
    spec = importlib.util.spec_from_file_location("sprint8_programs_migration", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Connection:
    def __init__(self, count: int):
        self.count = count

    def execute(self, _statement):
        return SimpleNamespace(scalar_one=lambda: self.count)


def test_department_precheck_allows_zero_or_one_row() -> None:
    migration = _migration_module()
    migration.assert_single_department(_Connection(0))
    migration.assert_single_department(_Connection(1))


def test_department_precheck_blocks_multiple_rows() -> None:
    migration = _migration_module()
    with pytest.raises(RuntimeError, match="More than one department"):
        migration.assert_single_department(_Connection(2))


def test_runtime_metadata_uses_programs_without_removed_tables() -> None:
    tables = Base.metadata.tables
    assert "programs" in tables
    assert "courses" not in tables
    assert "departments" not in tables
    assert "institutions" not in tables


def test_program_foreign_keys_target_renamed_table() -> None:
    tables = Base.metadata.tables
    for table_name, column_name in (
        ("users", "course_id"),
        ("student_profiles", "program_id"),
        ("admin_program_scopes", "program_id"),
        ("batches", "course_id"),
        ("sections", "course_id"),
        ("subjects", "course_id"),
        ("assignments", "target_course_id"),
        ("teacher_session_allocations", "program_id"),
    ):
        targets = {foreign_key.target_fullname for foreign_key in tables[table_name].c[column_name].foreign_keys}
        assert targets == {"programs.id"}
