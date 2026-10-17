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
            }
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

    # Only the promoted student is auto-enrolled, which is what the preview counts too.
    assert enrolled.get(students["active"]["id"]) == world["subject"]
    for name in ("repeating", "leave", "graduate", "dropped"):
        assert students[name]["id"] not in enrolled


@requires_docker
def test_academic_session_with_data_or_current_cannot_be_deleted(client, seed_user, login, rollover_world):
    from models.database import async_session_factory
    from models.sql_models import SqlAcademicSession, SqlStudentSessionRecord
    from sqlalchemy import delete, update

    world = rollover_world
    student = seed_user(role="student", email=f"delete-guard-{world['tag']}@example.edu")
    admin = seed_user(role="super_admin", email=f"delete-admin-{world['tag']}@example.edu")
    headers = {"Authorization": f"Bearer {login(admin['email'], admin['password'])}"}
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
