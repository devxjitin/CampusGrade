import io
import json
import os
import unittest
import zipfile
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import ValidationError

from schemas.assignment import AssignmentCreate, RepositoryResetRequest
from models.assignment import SqlAssignmentSubmissionVersion
from routes_fastapi.assignment_routes import (
    _normalize_generated_assignment,
    _overdue_ungraded_submission_count,
    _serialize_student_version,
    _snapshot_grade,
)
from ai.assignment_ai import _azure_openai_config, _invoke_prompt
from config import get_settings
from services.github_repository_service import (
    CODE_SIMILARITY_THRESHOLD,
    _code_fingerprints,
    code_similarity,
    GitHubRateLimitError,
    GitHubRepositoryError,
    _parse_git_advertisement,
    _safe_manifest,
    normalize_repository_url,
    preview_repository,
)


class AssignmentSchemaTests(unittest.TestCase):
    def test_repository_reset_requires_a_meaningful_audit_reason(self):
        with self.assertRaises(ValidationError):
            RepositoryResetRequest(reason="wrong")
        self.assertEqual(RepositoryResetRequest(reason="Student linked the wrong project").reason, "Student linked the wrong project")

    def test_submission_commit_uniqueness_is_scoped_to_repository_generation(self):
        constraint = next(item for item in SqlAssignmentSubmissionVersion.__table__.constraints if item.name == "uq_assignment_submission_commit")
        self.assertEqual([column.name for column in constraint.columns], ["submission_id", "repository_generation", "commit_sha"])

    def test_published_assignment_requires_complete_schedule_and_audience(self):
        with self.assertRaises(ValidationError):
            AssignmentCreate(title="Repository task", total_marks=10, status="published", rubric=[{"title": "Implementation", "max_marks": 10}])

    def test_rubric_marks_must_equal_total(self):
        with self.assertRaises(ValidationError):
            AssignmentCreate(title="Draft", total_marks=10, rubric=[{"title": "Implementation", "max_marks": 9}])

    def test_incomplete_assignment_is_rejected(self):
        with self.assertRaises(ValidationError):
            AssignmentCreate(total_marks=10, rubric=[{"title": "Implementation", "max_marks": 10}])

    def test_draft_status_is_rejected(self):
        with self.assertRaises(ValidationError):
            AssignmentCreate(
                title="Repository task",
                instructions="Build and document the project.",
                target_course_id="course-1",
                target_batch_id="batch-1",
                target_section_id="section-1",
                subject_id="subject-1",
                due_at=datetime.now(timezone.utc) + timedelta(days=1),
                status="draft",
                rubric=[{"title": "Implementation", "max_marks": 10}],
                total_marks=10,
            )

    def test_new_assignment_defaults_to_twenty_marks(self):
        assignment = AssignmentCreate(
            title="Repository task",
            instructions="Build and document the project.",
            target_course_id="course-1",
            target_batch_id="batch-1",
            target_section_id="section-1",
            subject_id="subject-1",
            due_at=datetime.now(timezone.utc) + timedelta(days=1),
            rubric=[{"title": "Implementation", "max_marks": 20}],
        )
        self.assertEqual(assignment.total_marks, 20)
        self.assertEqual(assignment.status, "published")

    def test_late_submission_policy_is_rejected(self):
        with self.assertRaises(ValidationError):
            AssignmentCreate(total_marks=20, allow_late=True, rubric=[{"title": "Implementation", "max_marks": 20}])

    def test_scheduled_results_must_be_after_deadline(self):
        due = datetime.now(timezone.utc) + timedelta(days=1)
        with self.assertRaises(ValidationError):
            AssignmentCreate(total_marks=20, due_at=due, result_release_mode="scheduled", result_release_at=due - timedelta(minutes=1), rubric=[{"title": "Implementation", "max_marks": 20}])

    def test_ai_assignment_normalizes_five_criteria_to_twenty_marks(self):
        draft = _normalize_generated_assignment({
            "title": "API project", "instructions": "Build it", "difficulty": "advanced",
            "rubric": [{"title": f"Criterion {index}", "max_marks": index + 1} for index in range(5)],
        })
        self.assertEqual(5, len(draft["rubric"]))
        self.assertAlmostEqual(20, sum(item["max_marks"] for item in draft["rubric"]))
        self.assertEqual(20, draft["total_marks"])

    def test_ai_assignment_respects_requested_marks_and_rubric_count(self):
        draft = _normalize_generated_assignment({
            "title": "CLI project", "instructions": "Build it",
            "rubric": [{"title": f"Criterion {index}", "max_marks": 1} for index in range(4)],
        }, total_marks=10, rubric_count=4, difficulty="advanced", require_readme=False)
        self.assertEqual(4, len(draft["rubric"]))
        self.assertAlmostEqual(10, sum(item["max_marks"] for item in draft["rubric"]))
        self.assertEqual(10, draft["total_marks"])
        self.assertEqual("advanced", draft["difficulty"])
        self.assertFalse(draft["repository_requirements"]["require_readme"])


class AzureOpenAIConfigurationTests(unittest.TestCase):
    # `_azure_openai_config()` reads `config.get_settings()`, which is
    # `lru_cache`d (Sprint 1, the original implementation plan) — patching os.environ
    # alone doesn't reach it once any earlier test/import has already
    # populated the cache from the real environment/.env. Every test in this
    # class must clear that cache both before (so it rebuilds from the
    # patched environ) and after (so later tests get the real environment
    # back, not this test's fake Azure credentials).
    def setUp(self):
        get_settings.cache_clear()
        self.addCleanup(get_settings.cache_clear)

    def test_uses_azure_endpoint_deployment_and_api_version(self):
        with patch.dict(os.environ, {
            "AZURE_OPENAI_ENDPOINT": "https://canvasgrade.openai.azure.com/",
            "AZURE_OPENAI_API_KEY": "test-key",
            "AZURE_OPENAI_DEPLOYMENT": "assignment draft",
            "AZURE_OPENAI_API_VERSION": "2024-10-21",
            "SECRET_KEY": os.environ.get("SECRET_KEY", "test-secret-of-at-least-thirty-two-characters-ok"),
        }, clear=True):
            get_settings.cache_clear()
            config = _azure_openai_config()

        self.assertIsNotNone(config)
        self.assertEqual("https://canvasgrade.openai.azure.com", config.endpoint)
        self.assertEqual("assignment draft", config.deployment)
        self.assertEqual("2024-10-21", config.api_version)

    def test_uses_api_key_header_and_deployment_request_url(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"choices":[{"message":{"content":"{\\\"title\\\":\\\"Draft\\\"}"}}]}'

        with patch.dict(os.environ, {
            "AZURE_OPENAI_ENDPOINT": "https://canvasgrade.openai.azure.com",
            "AZURE_OPENAI_API_KEY": "test-key",
            "AZURE_OPENAI_DEPLOYMENT": "assignment draft",
            "AZURE_OPENAI_API_VERSION": "2024-10-21",
            "SECRET_KEY": os.environ.get("SECRET_KEY", "test-secret-of-at-least-thirty-two-characters-ok"),
        }, clear=True), patch("ai.assignment_ai.urlopen", return_value=FakeResponse()) as request_open:
            get_settings.cache_clear()
            response, error = _invoke_prompt("Create an assignment")

        request = request_open.call_args.args[0]
        headers = {name.lower(): value for name, value in request.header_items()}
        self.assertEqual('{"title":"Draft"}', response)
        self.assertIsNone(error)
        self.assertEqual("test-key", headers["api-key"])
        self.assertNotIn("authorization", headers)
        self.assertEqual(
            "https://canvasgrade.openai.azure.com/openai/deployments/assignment%20draft/chat/completions?api-version=2024-10-21",
            request.full_url,
        )


class RepositoryValidationTests(unittest.TestCase):
    def test_student_submission_payload_excludes_teacher_analysis(self):
        version = SimpleNamespace(
            id="version-1", repository_url="https://github.com/student/project",
            repository_owner="student", repository_name="project", default_branch="main",
            commit_sha="a" * 40, commit_message="Submit assignment", commit_at=None,
            submitted_at=datetime.now(timezone.utc), is_late=False, seconds_late=0,
            analysis_status="ready", analysis_error=None,
            analysis_summary={"file_count": 4}, readme_markdown="# Private teacher evidence",
        )

        payload = _serialize_student_version(version)

        self.assertEqual(payload["commit_sha"], "a" * 40)
        self.assertNotIn("analysis_status", payload)
        self.assertNotIn("analysis_summary", payload)
        self.assertNotIn("readme_markdown", payload)

    def test_normalizes_public_github_repository_url(self):
        self.assertEqual(normalize_repository_url("https://github.com/student/project.git"), ("https://github.com/student/project", "student", "project"))

    def test_rejects_non_repository_or_non_github_urls(self):
        for value in ("https://gitlab.com/student/project", "https://github.com/student/project/tree/main", "file:///etc/passwd"):
            with self.assertRaises(GitHubRepositoryError): normalize_repository_url(value)

    def test_parses_public_git_head_without_rest_metadata(self):
        payload = (
            b"001e# service=git-upload-pack\n0000"
            b"009f0123456789abcdef0123456789abcdef01234567 HEAD\x00multi_ack "
            b"symref=HEAD:refs/heads/main agent=git/github\n"
        )
        self.assertEqual(
            _parse_git_advertisement(payload),
            ("0123456789abcdef0123456789abcdef01234567", "main"),
        )

    @patch("services.github_repository_service._github_public_head")
    @patch("services.github_repository_service._github_json")
    def test_rate_limited_preview_falls_back_to_public_git_transport(self, github_json, public_head):
        github_json.side_effect = GitHubRateLimitError("quota limited")
        public_head.return_value = ("a" * 40, "main")

        preview = preview_repository("https://github.com/student/project", "student")

        self.assertEqual(preview["commit_sha"], "a" * 40)
        self.assertEqual(preview["default_branch"], "main")
        self.assertEqual(preview["verification_source"], "git_transport")
        self.assertTrue(preview["verification_warning"])

    @patch("services.github_repository_service._github_public_head")
    @patch("services.github_repository_service._github_json")
    def test_commit_metadata_rate_limit_uses_the_same_fallback(self, github_json, public_head):
        github_json.side_effect = [
            {"private": False, "default_branch": "main"},
            GitHubRateLimitError("quota limited"),
        ]
        public_head.return_value = ("b" * 40, "main")

        preview = preview_repository("https://github.com/student/project", "student")

        self.assertEqual(preview["commit_sha"], "b" * 40)
        self.assertEqual(preview["verification_source"], "git_transport")

    def test_builds_repository_manifest_without_executing_content(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("project-sha/README.md", "# Demo\nSafe preview")
            archive.writestr("project-sha/src/main.py", "print('never executed')")
            archive.writestr("project-sha/package.json", json.dumps({"dependencies": {"fastify": "1.0"}, "devDependencies": {"vitest": "1.0"}}))
        manifest, summary, digest, readme = _safe_manifest(stream.getvalue())
        self.assertEqual(summary["file_count"], 3)
        self.assertIn("package.json", summary["dependency_files"])
        self.assertEqual(summary["dependency_details"]["package.json"], ["fastify", "vitest"])
        self.assertTrue(digest)
        self.assertEqual(readme, "# Demo\nSafe preview")
        self.assertEqual({item["path"] for item in manifest}, {"README.md", "src/main.py", "package.json"})


class CodeSimilarityTests(unittest.TestCase):
    def test_reports_copied_code_above_threshold_despite_literal_changes(self):
        left = "\n".join(f"def task_{index}(value): return value + {index}" for index in range(30))
        right = "\n".join(f"def task_{index}(value): return value + {index + 100}" for index in range(30))

        similarity = code_similarity(_code_fingerprints(left), _code_fingerprints(right))

        self.assertGreater(similarity, CODE_SIMILARITY_THRESHOLD)

    def test_unrelated_code_is_not_reported(self):
        left = "\n".join(f"def task_{index}(value): return value + {index}" for index in range(30))
        right = "\n".join(f"class Worker{index}:\n    async def run(self):\n        await queue.get()" for index in range(30))

        similarity = code_similarity(_code_fingerprints(left), _code_fingerprints(right))

        self.assertLessEqual(similarity, CODE_SIMILARITY_THRESHOLD)


class GradeRevisionTests(unittest.TestCase):
    def test_grade_snapshot_is_json_serializable(self):
        timestamp = datetime(2026, 7, 15, 8, 30, tzinfo=timezone.utc)
        grade = SimpleNamespace(
            id="grade-1",
            submission_version_id="version-1",
            rubric_scores={"rubric-1": 8},
            feedback="Well done",
            total_awarded=8,
            is_missing=False,
            status="draft",
            revision=2,
            evaluated_at=timestamp,
            published_at=None,
            withdrawn_at=None,
            withdrawal_reason=None,
        )

        snapshot = _snapshot_grade(grade)

        self.assertEqual(snapshot["evaluated_at"], timestamp.isoformat())
        json.dumps(snapshot)


class AssignmentEvaluationAlertTests(unittest.TestCase):
    def test_alert_counts_only_submitted_students_without_a_grade_after_deadline(self):
        assignment = SimpleNamespace(
            status="published",
            due_at=datetime(2026, 7, 15, 8, 0),
            opens_at=None,
        )

        pending = _overdue_ungraded_submission_count(
            assignment,
            ["student-1", "student-2", "student-3"],
            ["student-2", "student-4"],
            datetime(2026, 7, 16, 9, 0),
        )

        self.assertEqual(pending, 2)

    def test_alert_is_not_raised_before_deadline(self):
        assignment = SimpleNamespace(
            status="published",
            due_at=datetime(2026, 7, 15, 10, 0),
            opens_at=None,
        )

        pending = _overdue_ungraded_submission_count(
            assignment,
            ["student-1"],
            [],
            datetime(2026, 7, 15, 9, 0),
        )

        self.assertEqual(pending, 0)

    def test_alert_is_not_raised_until_24_hours_after_deadline(self):
        assignment = SimpleNamespace(
            status="published",
            due_at=datetime(2026, 7, 15, 10, 0),
            opens_at=None,
        )

        before_boundary = _overdue_ungraded_submission_count(
            assignment, ["student-1"], [], datetime(2026, 7, 16, 9, 59, 59),
        )
        at_boundary = _overdue_ungraded_submission_count(
            assignment, ["student-1"], [], datetime(2026, 7, 16, 10, 0),
        )

        self.assertEqual(before_boundary, 0)
        self.assertEqual(at_boundary, 1)


if __name__ == "__main__":
    unittest.main()
