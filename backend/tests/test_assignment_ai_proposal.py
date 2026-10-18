import copy
import unittest

from services.assignment_ai_proposal import validate_ai_proposal

DRAFT = {"draft_ref": "draft-abc123", "difficulty": "intermediate", "require_readme": True, "total_marks": 20.0, "rubric_count": 2}
GOOD = {
    "schema_version": 1,
    "draft_ref": "draft-abc123",
    "title": "Library API",
    "short_description": "Build a REST API for a library.",
    "instructions": "## Objective\n" + "Build and document the service. " * 5 + "\n## Workflow\n```mermaid\nflowchart TD\n A-->B\n```",
    "learning_outcomes": ["Design REST endpoints"],
    "tags": ["api"],
    "difficulty": "intermediate",
    "repository_requirements": {"require_readme": True, "required_files": ["README.md"]},
    "total_marks": 20,
    "rubric": [
        {"title": "Implementation", "description": "Works as specified", "max_marks": 12},
        {"title": "Quality", "description": "Readable and documented", "max_marks": 8},
    ],
}


def run(**changes):
    payload = copy.deepcopy(GOOD)
    payload.update(changes)
    return validate_ai_proposal(payload, DRAFT)


def paths(errors):
    return {item["path"] for item in errors}


class AiProposalValidationTests(unittest.TestCase):
    def test_valid_proposal_passes_without_changes(self):
        proposal, warnings, errors = run()
        self.assertEqual([], errors)
        self.assertEqual([], warnings)
        self.assertEqual([12, 8], [item["max_marks"] for item in proposal["rubric"]])

    def test_non_object_is_rejected(self):
        self.assertTrue(validate_ai_proposal([1], DRAFT)[2])

    def test_wrong_draft_ref_and_schema_version(self):
        _, _, errors = run(draft_ref="draft-other", schema_version=2)
        self.assertEqual({"draft_ref", "schema_version"}, paths(errors))

    def test_marks_are_never_rescaled(self):
        rubric = [{"title": "A", "description": "a", "max_marks": 5}, {"title": "B", "description": "b", "max_marks": 5}]
        _, _, errors = run(rubric=rubric)
        self.assertEqual({"rubric"}, paths(errors))
        self.assertIn("10", errors[0]["message"])

    def test_wrong_rubric_count(self):
        _, _, errors = run(rubric=GOOD["rubric"][:1])
        self.assertIn("rubric", paths(errors))

    def test_criterion_fields_are_reported_by_path(self):
        rubric = [{"title": "", "description": "a", "max_marks": 0}, {"title": "B", "description": "b", "max_marks": "8"}]
        _, _, errors = run(rubric=rubric)
        self.assertTrue({"rubric[0].title", "rubric[0].max_marks", "rubric[1].max_marks"} <= paths(errors))

    def test_total_marks_difficulty_and_readme_must_match_the_prompt(self):
        _, _, errors = run(total_marks=25, difficulty="advanced", repository_requirements={"require_readme": False, "required_files": []})
        self.assertEqual({"total_marks", "difficulty", "repository_requirements.require_readme"}, paths(errors))

    def test_missing_title_is_an_error_not_a_default(self):
        payload = copy.deepcopy(GOOD)
        del payload["title"]
        _, _, errors = validate_ai_proposal(payload, DRAFT)
        self.assertIn("title", paths(errors))

    def test_required_files_must_be_relative(self):
        _, _, errors = run(repository_requirements={"require_readme": True, "required_files": ["../x", "/etc/passwd", "README.md"]})
        self.assertEqual({"repository_requirements.required_files[0]", "repository_requirements.required_files[1]"}, paths(errors))

    def test_missing_mermaid_and_readme_are_warnings_only(self):
        proposal, warnings, errors = run(instructions="Plain text. " * 20, repository_requirements={"require_readme": True, "required_files": []})
        self.assertEqual([], errors)
        self.assertEqual(2, len(warnings))
        self.assertEqual([], proposal["repository_requirements"]["required_files"])

    def test_too_many_tags_is_an_error(self):
        _, _, errors = run(tags=[f"t{i}" for i in range(13)])
        self.assertIn("tags", paths(errors))
