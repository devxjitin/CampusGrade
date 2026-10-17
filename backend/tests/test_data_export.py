"""Super Admin session export (Sprint 5, S5-04): request -> worker job -> ZIP of CSVs -> download."""

import csv
import datetime
import io
import uuid
import zipfile

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from tests.conftest import requires_docker


def test_csv_cells_that_look_like_formulas_are_neutralised():
    from services.data_export import safe_cell

    assert safe_cell("=SUM(A1:A9)") == "'=SUM(A1:A9)"
    assert safe_cell("+1") == "'+1" and safe_cell("-1") == "'-1" and safe_cell("@cmd") == "'@cmd"
    assert safe_cell("Priya Sharma") == "Priya Sharma"
    assert safe_cell(None) == ""
    assert safe_cell(datetime.datetime(2026, 1, 2, 3, 4, 5)) == "2026-01-02T03:04:05"


@requires_docker
def test_only_super_admins_can_request_exports(client, seed_user, login):
    teacher = seed_user(role="teacher", email="export-teacher@example.edu")
    program_admin = seed_user(role="admin", email="export-padmin@example.edu")
    for user in (teacher, program_admin):
        token = login(user["email"], user["password"])
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/admin/exports", headers=headers).status_code == 403
        assert client.post("/admin/exports", headers=headers, json={"session_id": "x"}).status_code == 403


@requires_docker
def test_export_is_built_by_the_worker_and_downloadable(client, seed_user, seed_academic, login, database_url):
    from models.assignment import SqlAssignment, SqlAssignmentGrade
    from worker.handlers import build_session_export_job

    admin = seed_user(role="super_admin", email="export-admin@example.edu")
    teacher = seed_user(role="teacher", email="export-owner@example.edu")
    student = seed_user(role="student", email="export-student@example.edu", name="=HYPERLINK(\"http://evil\")")
    session_id, assignment_id = str(uuid.uuid4()), str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    engine = create_engine(database_url)
    with Session(engine) as session:
        session.execute(
            text(
                "INSERT INTO academic_sessions (id, label, term, start_date, end_date, is_current, status, created_at, updated_at) "
                "VALUES (:id, :label, 'odd', :s, :e, false, 'closed', now(), now())"
            ),
            {"id": session_id, "label": f"Export {session_id[:6]}", "s": datetime.date.today() - datetime.timedelta(days=30), "e": datetime.date.today() + datetime.timedelta(days=30)},
        )
        session.add(
            SqlAssignment(
                id=assignment_id, title="Export check", instructions="", short_description="", difficulty="intermediate", total_marks=10, due_at=now,
                status="published", created_by=teacher["id"], session_id=session_id,
            )
        )
        session.flush()
        session.add(
            SqlAssignmentGrade(
                id=str(uuid.uuid4()), assignment_id=assignment_id, student_id=student["id"], rubric_scores={}, feedback="", total_awarded=7.5, is_missing=False,
                status="published", revision=1, published_at=now,
            )
        )
        session.commit()
    engine.dispose()

    headers = {"Authorization": f"Bearer {login(admin['email'], admin['password'])}"}
    requested = client.post("/admin/exports", headers=headers, json={"session_id": session_id})
    assert requested.status_code == 202, requested.text
    export_id = requested.json()["id"]
    assert requested.json()["status"] == "queued"
    assert client.get(f"/admin/exports/{export_id}/file", headers=headers).status_code == 409  # not ready yet

    # The worker handler builds it (on the app's own event loop, like the other DB-backed tests).
    client.portal.call(build_session_export_job, {"export_id": export_id})

    listed = client.get("/admin/exports", headers=headers).json()["exports"]
    row = next(item for item in listed if item["id"] == export_id)
    assert row["status"] == "ready" and row["filename"].endswith(".zip") and row["size_bytes"] > 0

    url = client.get(f"/admin/exports/{export_id}/url", headers=headers)
    assert url.status_code == 200  # `url` is null on the local storage backend; /file serves it then
    download = client.get(f"/admin/exports/{export_id}/file", headers=headers)
    assert download.status_code == 200 and download.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        assert set(archive.namelist()) == {"README.txt", "grades.csv", "audit_log.csv"}
        grades = list(csv.DictReader(io.StringIO(archive.read("grades.csv").decode("utf-8-sig"))))
        audit = archive.read("audit_log.csv").decode("utf-8-sig")
    assert len(grades) == 1
    assert grades[0]["assignment_title"] == "Export check" and grades[0]["total_awarded"] == "7.5" and grades[0]["status"] == "published"
    assert grades[0]["student_name"].startswith("'=")  # formula neutralised
    assert "data.export_requested" in audit  # the request itself is in the audit log window


@requires_docker
def test_unknown_session_is_rejected(client, seed_user, login):
    admin = seed_user(role="super_admin", email="export-admin2@example.edu")
    headers = {"Authorization": f"Bearer {login(admin['email'], admin['password'])}"}
    assert client.post("/admin/exports", headers=headers, json={"session_id": "does-not-exist"}).status_code == 404
