"""Session rollover (repeating / on-leave carry-over) and the academic-session delete guard."""

import datetime
import uuid

import pytest

from tests.conftest import requires_docker


@pytest.fixture
def rollover_world(client):
    """A throwaway course with two batches, one compulsory subject and an odd session.

    Years are random and far in the future so the labels never collide with real sessions
    in the shared test database; everything is removed (and the previous current session
    restored) afterwards.
    """
    from models.database import async_session_factory
    from models.sql_models import SqlAcademicSession, SqlBatch, SqlCourse, SqlSubject
    from sqlalchemy import delete, select, update

    year = 3000 + uuid.uuid4().int % 6000
    tag = uuid.uuid4().hex[:8]
    ids = {
        "year": year,
        "tag": tag,
        "course": str(uuid.uuid4()),
        "batch_new": str(uuid.uuid4()),  # first-year batch of this session
        "batch_old": str(uuid.uuid4()),  # final-year batch (2 year course)
        "subject": str(uuid.uuid4()),
        "from_session": str(uuid.uuid4()),
    }

    async def build():
        async with async_session_factory() as db:
            previous = list((await db.scalars(select(SqlAcademicSession.id).where(SqlAcademicSession.is_current.is_(True)))).all())
            db.add(SqlCourse(id=ids["course"], name=f"Rollover {tag}", code=f"R{tag}", duration_years=2))
            await db.flush()
            # Only one session may be current (unique index), so mine replaces the existing one for now.
            await db.execute(update(SqlAcademicSession).values(is_current=False))
            db.add_all(
                [
                    SqlBatch(id=ids["batch_new"], course_id=ids["course"], start_year=year, end_year=year + 2),
                    SqlBatch(id=ids["batch_old"], course_id=ids["course"], start_year=year - 2, end_year=year),
                    SqlSubject(id=ids["subject"], name=f"Subject {tag}", code=f"S{tag}", course_id=ids["course"], year=1, enrollment_type="compulsory"),
                    SqlAcademicSession(
                        id=ids["from_session"], label=f"{year}-{year + 1}", term="odd",
                        start_date=datetime.date(year, 7, 1), end_date=datetime.date(year, 12, 31),
                        is_current=True, status="active",
                    ),
                ]
            )
            await db.commit()
            return previous

    previous_current = client.portal.call(build)
    yield ids

    async def teardown():
        async with async_session_factory() as db:
            await db.execute(delete(SqlAcademicSession).where(SqlAcademicSession.label == f"{year}-{year + 1}"))
            await db.execute(delete(SqlSubject).where(SqlSubject.id == ids["subject"]))
            await db.execute(delete(SqlBatch).where(SqlBatch.course_id == ids["course"]))
            await db.execute(delete(SqlCourse).where(SqlCourse.id == ids["course"]))
            if previous_current:
                await db.execute(update(SqlAcademicSession).where(SqlAcademicSession.id.in_(previous_current)).values(is_current=True))
            await db.commit()

    client.portal.call(teardown)


def _add_record(client, student_id, session_id, **fields):
    from models.database import async_session_factory
    from models.sql_models import SqlStudentSessionRecord

    async def insert():
        async with async_session_factory() as db:
            db.add(SqlStudentSessionRecord(id=str(uuid.uuid4()), student_id=student_id, session_id=session_id, **fields))
            await db.commit()

    client.portal.call(insert)


@requires_docker
def test_rollover_carries_repeating_and_on_leave_students(client, seed_user, rollover_world):
    from models.database import async_session_factory
    from models.sql_models import SqlAcademicSession, SqlStudentSessionRecord, SqlStudentSubjectEnrollment
    from services import session_rollover
    from sqlalchemy import select

    world = rollover_world
    tag = world["tag"]
    students = {name: seed_user(role="student", email=f"{name}-{tag}@example.edu") for name in ("active", "repeating", "leave", "graduate", "dropped")}
    # (batch, study_year, semester, status, is_override)
    spec = {
        "active": ("batch_new", 1, 1, "active", False),
        "repeating": ("batch_new", 1, 1, "repeating", False),  # status alone must be enough, no override flag needed
        "leave": ("batch_new", 1, 1, "on_leave", True),
        "graduate": ("batch_old", 2, 3, "active", False),
        "dropped": ("batch_new", 1, 1, "dropped", False),
    }
    for name, (batch, study_year, semester, status, override) in spec.items():
        _add_record(
            client, students[name]["id"], world["from_session"],
            batch_id=world[batch], study_year=study_year, semester=semester, status=status, is_override=override,
        )

    async def run():
        async with async_session_factory() as db:
            from_session = await db.get(SqlAcademicSession, world["from_session"])
            preview = await session_rollover.preview(db, from_session)
            result = await session_rollover.execute(db, from_session, None)
            await db.commit()
            to_id = result["to_session_id"]
            records = {
                row.student_id: row
                for row in (await db.scalars(select(SqlStudentSessionRecord).where(SqlStudentSessionRecord.session_id == to_id))).all()
            }
            enrolled = {
                row.student_id: row.subject_id
                for row in (await db.scalars(select(SqlStudentSubjectEnrollment).where(SqlStudentSubjectEnrollment.session_id == to_id))).all()
            }  # empty: nothing is auto-enrolled
            return preview, result, records, enrolled

    preview, result, records, enrolled = client.portal.call(run)

    assert preview.promote_count == 3 and preview.graduate_count == 1
    assert result["promoted"] == 3 and result["graduated"] == 1

    status_by_name = {name: records[students[name]["id"]].status for name in students if students[name]["id"] in records}
    assert status_by_name == {"active": "active", "repeating": "repeating", "leave": "on_leave", "graduate": "graduated"}
    assert students["dropped"]["id"] not in records  # dropped students are not carried over

    # Repeating / on-leave students stay at their level instead of being promoted.
    repeating = records[students["repeating"]["id"]]
    assert (repeating.study_year, repeating.semester, repeating.is_override) == (1, 1, True)
    leave = records[students["leave"]["id"]]
    assert (leave.study_year, leave.semester) == (1, 1)
    # A normal first-year student moves to semester 2 of the same year.
    active = records[students["active"]["id"]]
    assert (active.study_year, active.semester) == (1, 2)

    # Subjects are not auto-enrolled by a rollover.
    assert enrolled == {}


@requires_docker
def test_academic_session_with_data_or_current_cannot_be_deleted(client, seed_user, login, rollover_world):
    from models.database import async_session_factory
    from models.sql_models import SqlAcademicSession, SqlStudentSessionRecord
    from sqlalchemy import delete, update

    world = rollover_world
    student = seed_user(role="student", email=f"delete-guard-{world['tag']}@example.edu")
    admin = seed_user(role="super_admin", email=f"delete-admin-{world['tag']}@example.edu")
    headers = {"Authorization": f"Bearer {login(admin['email'])}"}
    url = f"/admin/academic-sessions/{world['from_session']}"

    _add_record(client, student["id"], world["from_session"], batch_id=world["batch_new"], study_year=1, semester=1, status="active")
    blocked = client.delete(url, headers=headers)
    assert blocked.status_code == 409 and "student records" in blocked.json()["detail"]

    async def clear_records():
        async with async_session_factory() as db:
            await db.execute(delete(SqlStudentSessionRecord).where(SqlStudentSessionRecord.session_id == world["from_session"]))
            await db.execute(update(SqlAcademicSession).where(SqlAcademicSession.id == world["from_session"]).values(is_current=True, status="active"))
            await db.commit()

    client.portal.call(clear_records)
    current = client.delete(url, headers=headers)
    assert current.status_code == 409 and "current session" in current.json()["detail"]

    async def make_plain():
        async with async_session_factory() as db:
            await db.execute(update(SqlAcademicSession).where(SqlAcademicSession.id == world["from_session"]).values(is_current=False, status="upcoming"))
            await db.commit()

    client.portal.call(make_plain)
    assert client.delete(url, headers=headers).status_code == 200  # an empty, non-current session can still go


@requires_docker
def test_second_rollover_of_the_same_session_is_refused(client, rollover_world):
    from fastapi import HTTPException
    from models.database import async_session_factory
    from models.sql_models import SqlAcademicSession
    from services import session_rollover

    async def run_twice():
        async with async_session_factory() as db:
            from_session = await db.get(SqlAcademicSession, rollover_world["from_session"])
            await session_rollover.execute(db, from_session, None)
            await db.commit()
        async with async_session_factory() as db:
            stale = await db.get(SqlAcademicSession, rollover_world["from_session"])
            with pytest.raises(HTTPException) as refused:
                await session_rollover.execute(db, stale, None)
            return refused.value.status_code

    assert client.portal.call(run_twice) == 409


@requires_docker
def test_database_allows_only_one_current_session(client, rollover_world):
    from models.database import async_session_factory
    from models.sql_models import SqlAcademicSession
    from sqlalchemy.exc import IntegrityError

    year = rollover_world["year"]

    async def add_second_current():
        async with async_session_factory() as db:
            db.add(
                SqlAcademicSession(
                    id=str(uuid.uuid4()), label=f"{year}-{year + 1}", term="even",
                    start_date=datetime.date(year + 1, 1, 1), end_date=datetime.date(year + 1, 6, 30), is_current=True,
                )
            )
            with pytest.raises(IntegrityError):
                await db.commit()

    client.portal.call(add_second_current)


def _execute_rollover(client, from_session_id):
    from models.database import async_session_factory
    from models.sql_models import SqlAcademicSession
    from services import session_rollover

    async def run():
        async with async_session_factory() as db:
            from_session = await db.get(SqlAcademicSession, from_session_id)
            result = await session_rollover.execute(db, from_session, None)
            await db.commit()
            return result

    return client.portal.call(run)


def _undo_rollover(client, run_id):
    from models.database import async_session_factory
    from services import session_rollover

    async def run():
        async with async_session_factory() as db:
            result = await session_rollover.undo(db, run_id)
            await db.commit()
            return result

    return client.portal.call(run)


@requires_docker
def test_undo_restores_cached_fields_and_keeps_manual_enrollments(client, seed_user, rollover_world):
    from models.database import async_session_factory
    from models.sql_models import SqlAcademicSession, SqlStudentSessionRecord, SqlStudentSubjectEnrollment, SqlUser
    from sqlalchemy import select

    world = rollover_world
    active = seed_user(role="student", email=f"undo-active-{world['tag']}@example.edu", year=1, semester=1, batch_id=world["batch_new"])
    repeating = seed_user(role="student", email=f"undo-repeat-{world['tag']}@example.edu")
    for student, status in ((active, "active"), (repeating, "repeating")):
        _add_record(client, student["id"], world["from_session"], batch_id=world["batch_new"], study_year=1, semester=1, status=status)

    result = _execute_rollover(client, world["from_session"])
    to_id = result["to_session_id"]

    async def snapshot():
        async with async_session_factory() as db:
            user = await db.get(SqlUser, active["id"], populate_existing=True)
            enrollments = (await db.scalars(select(SqlStudentSubjectEnrollment).where(SqlStudentSubjectEnrollment.session_id == to_id))).all()
            return (user.year, user.semester), {(row.student_id, row.rollover_run_id) for row in enrollments}

    cached, enrolled = client.portal.call(snapshot)
    assert cached == (1, 2)  # promoted to the even semester
    assert enrolled == set()  # a rollover creates no enrollments

    async def add_manual_enrollment():
        async with async_session_factory() as db:
            db.add(SqlStudentSubjectEnrollment(id=str(uuid.uuid4()), student_id=repeating["id"], subject_id=world["subject"], session_id=to_id))
            await db.commit()

    client.portal.call(add_manual_enrollment)
    _undo_rollover(client, result["run_id"])

    async def after():
        async with async_session_factory() as db:
            user = await db.get(SqlUser, active["id"], populate_existing=True)
            enrollments = (await db.scalars(select(SqlStudentSubjectEnrollment).where(SqlStudentSubjectEnrollment.session_id == to_id))).all()
            records = (await db.scalars(select(SqlStudentSessionRecord).where(SqlStudentSessionRecord.session_id == to_id))).all()
            from_session = await db.get(SqlAcademicSession, world["from_session"], populate_existing=True)
            return (user.year, user.semester), {row.student_id for row in enrollments}, len(records), from_session.is_current

    cached, enrolled, record_count, from_is_current = client.portal.call(after)
    assert cached == (1, 1)  # cached fields are back to the outgoing session's values
    assert enrolled == {repeating["id"]}  # only the hand-added enrollment survives
    assert record_count == 0 and from_is_current is True


@requires_docker
def test_undo_is_refused_when_newer_run_exists_or_session_is_no_longer_current(client, seed_user, rollover_world):
    from fastapi import HTTPException
    from models.database import async_session_factory
    from models.sql_models import SqlAcademicSession, SqlRolloverRun
    from services import session_rollover
    from sqlalchemy import delete, update

    world = rollover_world
    student = seed_user(role="student", email=f"undo-guard-{world['tag']}@example.edu")
    _add_record(client, student["id"], world["from_session"], batch_id=world["batch_new"], study_year=1, semester=1, status="active")
    result = _execute_rollover(client, world["from_session"])
    newer_id = str(uuid.uuid4())

    async def attempt():
        async with async_session_factory() as db:
            with pytest.raises(HTTPException) as refused:
                await session_rollover.undo(db, result["run_id"])
            return refused.value.status_code

    async def set_state(newer_run, to_is_current):
        async with async_session_factory() as db:
            await db.execute(delete(SqlRolloverRun).where(SqlRolloverRun.id == newer_id))
            if newer_run:
                db.add(
                    SqlRolloverRun(
                        id=newer_id, from_session_id=world["from_session"], to_session_id=result["to_session_id"], counts={},
                        executed_at=datetime.datetime.now() + datetime.timedelta(hours=1),
                    )
                )
            await db.flush()
            await db.execute(update(SqlAcademicSession).where(SqlAcademicSession.id == result["to_session_id"]).values(is_current=to_is_current))
            await db.execute(update(SqlAcademicSession).where(SqlAcademicSession.id == world["from_session"]).values(is_current=not to_is_current))
            await db.commit()

    client.portal.call(set_state, True, True)
    assert client.portal.call(attempt) == 409  # a more recent rollover must be undone first
    client.portal.call(set_state, False, False)
    assert client.portal.call(attempt) == 409  # the created session is no longer current


@requires_docker
def test_rollover_query_count_does_not_grow_with_students(client, rollover_world):
    from models.database import async_session_factory
    from models.sql_models import SqlAcademicSession, SqlStudentSessionRecord, SqlUser
    from services import session_rollover
    from sqlalchemy import delete, event

    world = rollover_world
    ids = [str(uuid.uuid4()) for _ in range(150)]

    async def seed():
        async with async_session_factory() as db:
            db.add_all(
                SqlUser(id=sid, name=f"Bulk {n}", email=f"bulk-{world['tag']}-{n}@example.edu", role="student", is_active=True)
                for n, sid in enumerate(ids)
            )
            await db.flush()
            db.add_all(
                SqlStudentSessionRecord(
                    id=str(uuid.uuid4()), student_id=sid, session_id=world["from_session"], batch_id=world["batch_new"], study_year=1, semester=1, status="active"
                )
                for sid in ids
            )
            await db.commit()

    async def run():
        statements: list[str] = []

        def count(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        async with async_session_factory() as db:
            engine = db.bind.sync_engine
            from_session = await db.get(SqlAcademicSession, world["from_session"])
            event.listen(engine, "before_cursor_execute", count)
            try:
                result = await session_rollover.execute(db, from_session, None)
                await db.commit()
            finally:
                event.remove(engine, "before_cursor_execute", count)
            return result, len(statements)

    async def cleanup():
        async with async_session_factory() as db:
            await db.execute(delete(SqlUser).where(SqlUser.id.in_(ids)))
            await db.commit()

    client.portal.call(seed)
    try:
        result, statement_count = client.portal.call(run)
    finally:
        client.portal.call(cleanup)

    assert result["promoted"] == 150
    # With one statement per student this would be well over 300.
    assert statement_count < 60, statement_count
