"""Notification emails (Sprint 4, S4-04/S4-05): the worker handler, opt-outs and deadline reminders."""

import datetime
import uuid

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from tests.conftest import requires_docker


def _utc_now():
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


def _count(database_url, sql, **params):
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            return connection.execute(text(sql), params).scalar_one()
    finally:
        engine.dispose()


@requires_docker
def test_handler_sends_and_respects_the_users_opt_out(client, seed_user, database_url, monkeypatch):
    import services.email_service as email_service
    from worker.handlers import send_notification_email

    sent = []

    async def fake_send(to, subject, text_body, html_body):
        sent.append((to, subject, text_body))
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send)
    student = seed_user(role="student", email="notify-student@example.edu", name="Notify Student")
    payload = {
        "user_id": student["id"],
        "preference_key": "email_assignment_grades",
        "subject": "Your grade is available",
        "lines": ["Your grade for Lab 1 has been published."],
        "path": "/assignments/abc",
    }

    client.portal.call(send_notification_email, payload)
    assert len(sent) == 1
    to, subject, body = sent[0]
    assert (to, subject) == ("notify-student@example.edu", "Your grade is available")
    assert "Hi Notify Student," in body and "/assignments/abc" in body

    engine = create_engine(database_url)
    with Session(engine) as session:
        session.execute(
            text("INSERT INTO user_preferences (user_id, notification_preferences, schema_version, updated_at) VALUES (:u, CAST(:p AS json), 1, now())"),
            {"u": student["id"], "p": '{"email_assignment_grades": false}'},
        )
        session.commit()
    engine.dispose()

    client.portal.call(send_notification_email, payload)
    assert len(sent) == 1  # opted out: nothing more is sent
    # ... but another type still goes out
    client.portal.call(send_notification_email, {**payload, "preference_key": "email_assignment_deadlines"})
    assert len(sent) == 2


@requires_docker
def test_deadline_reminders_target_unsubmitted_students_once(client, seed_user, seed_academic, database_url):
    from models.assignment import SqlAssignment, SqlAssignmentSubmission
    from worker import periodic

    ids = seed_academic()
    group = {"course_id": ids["course_id"], "batch_id": ids["batch_id"], "section_id": ids["section_id"]}
    teacher = seed_user(role="teacher", email="deadline-teacher@example.edu")
    waiting = seed_user(role="student", email="deadline-waiting@example.edu", **group)
    done = seed_user(role="student", email="deadline-done@example.edu", **group)
    now = _utc_now()
    soon, later = str(uuid.uuid4()), str(uuid.uuid4())

    engine = create_engine(database_url)
    with Session(engine) as session:
        for assignment_id, due in ((soon, now + datetime.timedelta(hours=6)), (later, now + datetime.timedelta(days=3))):
            session.add(
                SqlAssignment(
                    id=assignment_id, title=f"Due {assignment_id[:4]}", instructions="", short_description="", difficulty="intermediate",
                    total_marks=10, due_at=due, status="published", created_by=teacher["id"],
                    target_course_id=group["course_id"], target_batch_id=group["batch_id"], target_section_id=group["section_id"],
                )
            )
        session.flush()
        session.add(
            SqlAssignmentSubmission(
                id=str(uuid.uuid4()), assignment_id=soon, student_id=done["id"], repository_url="https://github.com/a/b",
                first_submitted_at=now, last_submitted_at=now, status="submitted",
            )
        )
        session.commit()
        session.execute(text("DELETE FROM jobs WHERE type = 'email.notification'"))
        session.commit()
    engine.dispose()

    assert client.portal.call(periodic.deadline_reminders) == 1
    assert client.portal.call(periodic.deadline_reminders) == 0  # deduplicated

    key = f"deadline24h:{soon}:{waiting['id']}"
    assert _count(database_url, "SELECT count(*) FROM notifications WHERE dedupe_key = :k", k=key) == 1
    assert _count(database_url, "SELECT count(*) FROM notifications WHERE dedupe_key LIKE :k", k=f"deadline24h:{later}:%") == 0
    assert _count(database_url, "SELECT count(*) FROM notifications WHERE dedupe_key LIKE :k", k=f"deadline24h:{soon}:{done['id']}") == 0
    assert (
        _count(
            database_url,
            "SELECT count(*) FROM jobs WHERE type = 'email.notification' AND payload->>'user_id' = :u AND payload->>'preference_key' = 'email_assignment_deadlines'",
            u=waiting["id"],
        )
        == 1
    )
