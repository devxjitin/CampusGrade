"""Seed a small academic setup for end-to-end tests (Sprint 5): one program/section, a teacher,
two students and two assignments.

  - "E2E open assignment": published, due in a week, nobody has submitted. Students see it and can submit.
  - "E2E ready to evaluate": closed, repositories fetched and analyzed, so the teacher can prepare an
    external-AI evaluation (the stepper dialog) without GitHub.

Accounts sign in with their email only. Safe to run twice (it does nothing if the teacher already exists).
Never run this against real data: it exists for CI and local test stacks.

  docker compose ... run --rm -T api python seed_e2e.py
"""

import asyncio
import datetime
import io
import json
import uuid
import zipfile

from models.assignment import (
    SqlAssignment,
    SqlAssignmentEvaluationParticipant,
    SqlAssignmentRubric,
    SqlAssignmentSubmission,
    SqlAssignmentSubmissionVersion,
)
from models.database import async_session_factory, init_database, is_database_available
from models.sql_models import SqlBatch, SqlCourse, SqlSection, SqlSubject, SqlUser
from services.assignment_storage import get_assignment_storage

TEACHER_EMAIL = "e2e-teacher@campusgrade.dev"
STUDENTS = [
    ("e2e-student1@campusgrade.dev", "Asha Verma", "E2E-001", "asha-v-e2e"),
    ("e2e-student2@campusgrade.dev", "Rohan Mehta", "E2E-002", "rohan-m-e2e"),
]


def _zip(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def _seed(db) -> bool:
    if db.query(SqlUser).filter_by(email=TEACHER_EMAIL).first():
        return False
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    tag = uuid.uuid4().hex[:6]
    course = SqlCourse(id=str(uuid.uuid4()), name="E2E Program", code=f"E2E{tag}")
    db.add(course)
    db.flush()
    batch = SqlBatch(id=str(uuid.uuid4()), course_id=course.id, start_year=2024, end_year=2028)
    db.add(batch)
    db.flush()
    section = SqlSection(id=str(uuid.uuid4()), course_id=course.id, batch_id=batch.id, name="A")
    subject = SqlSubject(id=str(uuid.uuid4()), name="E2E Subject", code=f"S{tag}", course_id=course.id, batch_id=batch.id)
    db.add_all([section, subject])
    db.flush()
    group = {"course_id": course.id, "batch_id": batch.id, "section_id": section.id}
    teacher = SqlUser(id=str(uuid.uuid4()), name="E2E Teacher", email=TEACHER_EMAIL, role="teacher", is_active=True)
    db.add(teacher)
    students = [
        SqlUser(id=str(uuid.uuid4()), name=name, email=email, roll_no=roll, role="student", is_active=True, **group)
        for email, name, roll, _ in STUDENTS
    ]
    db.add_all(students)
    db.flush()

    def assignment(title: str, due: datetime.datetime, **extra) -> SqlAssignment:
        row = SqlAssignment(
            id=str(uuid.uuid4()), title=title, instructions="Build a small command-line tool and document it.", short_description="E2E fixture", difficulty="intermediate",
            total_marks=10, due_at=due, status="published", created_by=teacher.id, subject=subject.name, subject_id=subject.id,
            target_course_id=course.id, target_batch_id=batch.id, target_section_id=section.id, **extra,
        )
        db.add(row)
        db.flush()
        return row

    assignment("E2E open assignment", now + datetime.timedelta(days=7))
    ready = assignment("E2E ready to evaluate", now - datetime.timedelta(days=1), evaluation_locked_at=now, repository_fetch_started_at=now, repository_fetch_completed_at=now)
    for position, (title, marks) in enumerate([("Correctness", 6.0), ("Documentation", 4.0)]):
        db.add(SqlAssignmentRubric(id=str(uuid.uuid4()), assignment_id=ready.id, title=title, description=f"{title} of the submission", max_marks=marks, position=position))
    db.flush()
    storage = get_assignment_storage()
    for student, (_, name, roll, owner) in zip(students, STUDENTS, strict=True):
        submission_id, version_id = str(uuid.uuid4()), str(uuid.uuid4())
        archive_key, manifest_key = f"e2e/{version_id}.zip", f"e2e/{version_id}.json"
        storage.put_bytes(archive_key, _zip({"repo-main/README.md": f"# Tool\nBuilt by {name} ({roll}).\n", "repo-main/main.py": "print('hello')\n"}))
        storage.put_bytes(manifest_key, json.dumps([{"path": "README.md", "is_text": True}, {"path": "main.py", "is_text": True}]).encode())
        db.add(SqlAssignmentSubmission(id=submission_id, assignment_id=ready.id, student_id=student.id, first_submitted_at=now, last_submitted_at=now, status="submitted"))
        db.flush()
        db.add(
            SqlAssignmentSubmissionVersion(
                id=version_id, submission_id=submission_id, repository_generation=1, detected_at=now, detection_source="student",
                repository_url=f"https://github.com/{owner}/tool", repository_owner=owner, repository_name="tool", default_branch="main", commit_sha="e" * 40,
                submitted_at=now, is_late=False, seconds_late=0, analysis_status="ready", archive_key=archive_key, manifest_key=manifest_key,
            )
        )
        db.flush()
        db.get(SqlAssignmentSubmission, submission_id).active_version_id = version_id
        db.add(SqlAssignmentEvaluationParticipant(id=str(uuid.uuid4()), assignment_id=ready.id, student_id=student.id, submission_version_id=version_id))
    db.flush()
    return True


async def main() -> None:
    await init_database()
    if not is_database_available() or async_session_factory is None:
        raise RuntimeError("CampusGrade database is unavailable")
    async with async_session_factory() as db:
        created = await db.run_sync(lambda sync_db: _seed(sync_db))
        if not created:
            print("E2E fixtures already exist")
            return
        await db.commit()
        print("Created E2E fixtures (teacher, 2 students, 2 assignments)")


if __name__ == "__main__":
    asyncio.run(main())
