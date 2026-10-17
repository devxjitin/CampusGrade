"""Pseudonymized external-AI evaluation (Sprint 5, S5-01..S5-03, S5-10).

The prompt a teacher copies to an external AI tool must never contain a real student name, roll
number, email, GitHub login or internal id. These tests build a real export and look for them.
"""

import datetime
import io
import json
import uuid
import zipfile
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from tests.conftest import requires_docker


def test_pseudonyms_are_stable_unique_and_not_alphabetical():
    from services.assignment_external_evaluation import assign_pseudonyms

    ids = [f"student-{i}" for i in range(12)]
    first = assign_pseudonyms("export-1", ids)
    assert first == assign_pseudonyms("export-1", ids)
    assert sorted(first.values()) == [f"Student-{n:02d}" for n in range(1, 13)]
    assert assign_pseudonyms("export-2", ids) != first  # a new export reshuffles
    assert [first[i] for i in ids] != sorted(first.values())  # not in input (e.g. alphabetical) order


def test_scrub_removes_names_roll_numbers_emails_and_logins_case_insensitively():
    from services.assignment_external_evaluation import identity_terms, scrub_identity

    student = SimpleNamespace(id="b1f0c2d4-0000-4000-8000-000000000001", name="Priya Sharma", roll_no="KR2024-0042", email="priya.sharma@krmu.edu.in")
    terms = identity_terms(student, "priyasharma-dev")
    text = "Author: PRIYA SHARMA <priya.sharma@krmu.edu.in> roll kr2024-0042 https://github.com/priyasharma-dev/x id b1f0c2d4-0000-4000-8000-000000000001"
    scrubbed = scrub_identity(text, terms)
    for secret in ("priya", "sharma", "kr2024", "krmu.edu.in", "b1f0c2d4"):
        assert secret not in scrubbed.lower()


def _zip(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


@requires_docker
def test_export_prompt_is_pseudonymized_and_import_restores_real_students(client, seed_user, seed_academic, login, database_url):
    from models.assignment import (
        SqlAssignment,
        SqlAssignmentEvaluationParticipant,
        SqlAssignmentRubric,
        SqlAssignmentSubmission,
        SqlAssignmentSubmissionVersion,
    )
    from services.assignment_storage import get_assignment_storage

    ids = seed_academic()
    group = {"course_id": ids["course_id"], "batch_id": ids["batch_id"], "section_id": ids["section_id"]}
    teacher = seed_user(role="teacher", email="pseudo-teacher@example.edu")
    people = [
        ("Priya Sharma", "KR2024-0042", "priya.sharma@example.edu", "priyasharma-dev"),
        ("Rahul Verma", "KR2024-0077", "rahul.verma@example.edu", "rahulv-codes"),
    ]
    students = [seed_user(role="student", email=email, name=name, roll_no=roll, **group) for name, roll, email, _ in people]
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    assignment_id = str(uuid.uuid4())
    criteria = [(str(uuid.uuid4()), "Correctness", 6.0), (str(uuid.uuid4()), "Documentation", 4.0)]
    storage = get_assignment_storage()
    secrets_in_repo, version_ids = [], []

    engine = create_engine(database_url)
    with Session(engine) as session:
        session.add(
            SqlAssignment(
                id=assignment_id, title="Pseudonym check", instructions="Build a thing", short_description="", difficulty="intermediate", total_marks=10,
                due_at=now - datetime.timedelta(days=1), status="published", created_by=teacher["id"], evaluation_locked_at=now,
                repository_fetch_started_at=now, repository_fetch_completed_at=now, target_course_id=group["course_id"],
                target_batch_id=group["batch_id"], target_section_id=group["section_id"],
            )
        )
        session.flush()
        for position, (criterion_id, title, marks) in enumerate(criteria):
            session.add(SqlAssignmentRubric(id=criterion_id, assignment_id=assignment_id, title=title, description="", max_marks=marks, position=position))
        session.flush()
        for student, (name, roll, email, owner) in zip(students, people, strict=True):
            submission_id, version_id = str(uuid.uuid4()), str(uuid.uuid4())
            readme = f"# Project by {name}\nRoll {roll}. Contact {email}. Repo github.com/{owner}/project\n"
            archive_key, manifest_key = f"test/{version_id}.zip", f"test/{version_id}.json"
            storage.put_bytes(archive_key, _zip({"project-main/README.md": readme, "project-main/app.py": f"# written by {name}\nprint('hi')\n"}))
            storage.put_bytes(manifest_key, json.dumps([{"path": "README.md", "is_text": True}, {"path": "app.py", "is_text": True}]).encode())
            session.add(SqlAssignmentSubmission(id=submission_id, assignment_id=assignment_id, student_id=student["id"], first_submitted_at=now, last_submitted_at=now, status="submitted"))
            session.flush()
            session.add(
                SqlAssignmentSubmissionVersion(
                    id=version_id, submission_id=submission_id, repository_generation=1, detected_at=now, detection_source="student",
                    repository_url=f"https://github.com/{owner}/project", repository_owner=owner, repository_name="project", default_branch="main",
                    commit_sha="c" * 40, submitted_at=now, is_late=False, seconds_late=0, analysis_status="ready", archive_key=archive_key, manifest_key=manifest_key,
                )
            )
            session.flush()
            submission = session.get(SqlAssignmentSubmission, submission_id)
            submission.active_version_id = version_id
            session.add(SqlAssignmentEvaluationParticipant(id=str(uuid.uuid4()), assignment_id=assignment_id, student_id=student["id"], submission_version_id=version_id))
            secrets_in_repo += [name, roll, email, owner, student["id"], version_id]
            version_ids.append(version_id)
        session.commit()
    engine.dispose()

    token = login(teacher["email"], teacher["password"])
    headers = {"Authorization": f"Bearer {token}"}
    exported = client.post(f"/assignments/teacher/{assignment_id}/external-evaluation/export", headers=headers)
    assert exported.status_code == 200, exported.text
    batch = exported.json()["batches"][0]

    # S5-10: nothing identifying in the prompt, and nothing identifying in the opaque batch reference.
    prompt = batch["prompt"].lower()
    for secret in secrets_in_repo:
        assert secret.lower() not in prompt, f"{secret!r} leaked into the prompt"
    for token_part in (batch["batch_id"][:40],):
        assert token_part not in batch["prompt"]  # the signed mapping stays in the teacher's browser
    assert "student-01" in prompt and "student-02" in prompt
    pseudonyms = {row["pseudonym"]: row for row in batch["students"]}
    assert set(pseudonyms) == {"Student-01", "Student-02"}

    def ai_row(pseudonym, awarded):
        return {
            "student_id": pseudonym,
            "duplicate_review": {"status": "none", "matched_students": [], "recommend_zero": False, "explanation": ""},
            "rubric_scores": [
                {"criterion_id": criteria[0][0], "awarded": awarded, "max_marks": 6, "what_was_done_well": "The program runs and prints output.", "what_is_missing": "Edge cases are not covered."},
                {"criterion_id": criteria[1][0], "awarded": 3, "max_marks": 4, "what_was_done_well": "A README describes the project.", "what_is_missing": "Setup steps are not described."},
            ],
            "total_awarded": awarded + 3,
            "confidence": 0.8,
            "requires_teacher_review": [],
        }

    def response(rows):
        return {"schema_version": 1, "assignment_id": assignment_id, "batch_id": batch["batch_ref"], "batch_number": 1, "students": rows}

    validate_url = f"/assignments/teacher/{assignment_id}/external-evaluation/validate"

    # S5-02: a wrong mark and a missing student give one clear message each.
    bad = client.post(validate_url, headers=headers, json={"batch_token": batch["batch_id"], "result": response([ai_row("Student-01", 9)])})
    assert bad.status_code == 422
    errors = bad.json()["errors"]
    messages = " | ".join(error["message"] for error in errors)
    assert any(error["criterion"] == "Correctness" and "between 0 and 6" in error["message"] for error in errors), messages
    assert any("Student-02" in error["message"] and "missing" in error["message"] for error in errors), messages
    assert all(error["path"] for error in errors)

    # S5-03: the corrected response previews the proposal (no saved grades yet) with real students restored.
    good = client.post(validate_url, headers=headers, json={"batch_token": batch["batch_id"], "result": response([ai_row("Student-01", 5), ai_row("Student-02", 4)])})
    assert good.status_code == 200, good.text
    proposed = good.json()["students"]
    assert {row["student_name"] for row in proposed} == {"Priya Sharma", "Rahul Verma"}
    by_name = {row["student_name"]: row for row in proposed}
    assert by_name[proposed[0]["student_name"]]["current"] is None
    assert [c["proposed"] for c in proposed[0]["diff"]["criteria"]] == [proposed[0]["rubric_scores"][criteria[0][0]], 3.0]
    preview = client.post(f"/assignments/teacher/{assignment_id}/external-evaluation/preview", headers=headers, json={"batch_token": batch["batch_id"], "result": response([ai_row("Student-01", 5), ai_row("Student-02", 4)])})
    assert preview.status_code == 200

    saved = client.post(
        f"/assignments/teacher/{assignment_id}/external-evaluation/save-evaluations",
        headers=headers,
        json={
            "schema_version": 1,
            "students": [
                {
                    "student_id": row["student_id"], "submission_version_id": row["submission_version_id"], "rubric_scores": row["rubric_scores"],
                    "rubric_feedback": row["rubric_feedback"], "expected_revision": row["expected_revision"], "batch_token": batch["batch_id"],
                }
                for row in proposed
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    assert sorted(grade["total_awarded"] for grade in saved.json()["grades"]) == [7.0, 8.0]
