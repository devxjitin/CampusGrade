from datetime import date
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from routes_fastapi.admin.users import _profile_assignment_status
from routes_fastapi.admin_settings import AssignmentMonitoringSettings, default_assignment_monitoring_settings
from routes_fastapi.assignment_routes import _parse_dashboard_date


def test_default_academic_year_rolls_over_in_july():
    assert default_assignment_monitoring_settings(date(2026, 6, 30))["academic_year_start"] == "2025-07-01"
    assert default_assignment_monitoring_settings(date(2026, 7, 1))["academic_year_start"] == "2026-07-01"


def test_monitoring_settings_validate_threshold_and_date_order():
    with pytest.raises(ValidationError):
        AssignmentMonitoringSettings(missed_rate_threshold_percent=101, academic_year_start=date(2026, 7, 1), academic_year_end=date(2027, 6, 30))
    with pytest.raises(ValidationError):
        AssignmentMonitoringSettings(missed_rate_threshold_percent=25, academic_year_start=date(2027, 7, 1), academic_year_end=date(2027, 6, 30))


def test_student_profile_status_uses_valid_content_and_exposes_drafts():
    draft = SimpleNamespace(status="draft", is_missing=False)
    missing = SimpleNamespace(status="draft", is_missing=True)
    assert _profile_assignment_status(deadline_passed=False, valid_submission=True, grade=draft) == "graded"
    assert _profile_assignment_status(deadline_passed=True, valid_submission=False, grade=None) == "missed"
    assert _profile_assignment_status(deadline_passed=True, valid_submission=False, grade=missing) == "missed"


def test_dashboard_date_parser_includes_full_end_date():
    assert _parse_dashboard_date("2026-07-01").hour == 0
    assert _parse_dashboard_date("2026-07-01", end=True).date() == date(2026, 7, 1)
    assert _parse_dashboard_date("2026-07-01", end=True).hour == 23
