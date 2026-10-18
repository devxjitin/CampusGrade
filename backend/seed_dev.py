"""Seed temporary demo data into a local development database: programs, batches, sections,
subjects, teachers (with teaching allocations in the current session), students (with a record in
the current session) and one limited admin.

Every account uses an `@seed.campusgrade.dev` email and signs in with the email only. Safe to run
twice (it does nothing if the demo data already exists). Never run this against real data.

  python seed_dev.py            # create
  python seed_dev.py --remove   # delete everything this script created
"""

import asyncio
import datetime
import sys
import uuid

from models.database import async_session_factory, init_database, is_database_available
from models.sql_models import (
    SqlAcademicSession,
    SqlAdminAccess,
    SqlBatch,
    SqlCourse,
    SqlSection,
    SqlStudentSessionRecord,
    SqlSubject,
    SqlTeacherSessionAllocation,
    SqlUser,
)
from services.identity_service import sync_profile
from sqlalchemy import delete, select

DOMAIN = "seed.campusgrade.dev"
MARKER_EMAIL = f"teacher1@{DOMAIN}"

PROGRAMS = [
    ("B.Tech Computer Science", "BTCS", 4, ["Data Structures", "Operating Systems", "Database Systems", "Computer Networks"]),
    ("B.Tech Information Technology", "BTIT", 4, ["Web Technologies", "Software Engineering", "Cloud Computing", "Cyber Security"]),
    ("BCA", "BCA", 3, ["Programming in C", "Python Programming", "Digital Electronics", "Discrete Mathematics"]),
]
# (start_year, study_year, semester) in the current "odd" session of 2026-2027.
INTAKES = [(2026, 1, 1), (2025, 2, 3), (2024, 3, 5)]
SECTIONS = ["A", "B"]
FIRST_NAMES = ["Aarav", "Diya", "Kabir", "Ananya", "Vihaan", "Ishita", "Reyansh", "Meera", "Arjun", "Saanvi", "Rohan", "Kavya"]
LAST_NAMES = ["Sharma", "Verma", "Gupta", "Singh", "Patel", "Nair", "Reddy", "Mehta", "Joshi", "Kapoor"]
TEACHERS = ["Dr. Neha Bansal", "Prof. Rahul Khanna", "Dr. Sunita Rao", "Prof. Amit Desai", "Dr. Pooja Iyer", "Prof. Vikram Malhotra"]


def _id() -> str:
    return str(uuid.uuid4())


async def _remove(db) -> None:
    emails = (await db.scalars(select(SqlUser.email).where(SqlUser.email.like(f"%@{DOMAIN}")))).all()
    ids = list((await db.scalars(select(SqlUser.id).where(SqlUser.email.like(f"%@{DOMAIN}")))).all())
    codes = [code for _, code, _, _ in PROGRAMS]
    course_ids = list((await db.scalars(select(SqlCourse.id).where(SqlCourse.code.in_(codes)))).all())
    if ids:
        await db.execute(delete(SqlUser).where(SqlUser.id.in_(ids)))  # profiles, records, allocations cascade
    if course_ids:
        await db.execute(delete(SqlSubject).where(SqlSubject.course_id.in_(course_ids)))
        await db.execute(delete(SqlSection).where(SqlSection.course_id.in_(course_ids)))
        await db.execute(delete(SqlBatch).where(SqlBatch.course_id.in_(course_ids)))
        await db.execute(delete(SqlCourse).where(SqlCourse.id.in_(course_ids)))
    await db.commit()
    print(f"Removed {len(emails)} demo accounts and {len(course_ids)} programs")


async def _create(db) -> None:
    if (await db.scalars(select(SqlUser.id).where(SqlUser.email == MARKER_EMAIL))).first():
        print("Demo data already exists (run with --remove to reset)")
        return
    session = (await db.scalars(select(SqlAcademicSession).where(SqlAcademicSession.is_current))).first()
    if session is None:
        raise RuntimeError("No current academic session; create one first")

    teachers: list[SqlUser] = []
    for index, name in enumerate(TEACHERS, start=1):
        teacher = SqlUser(
            id=_id(), name=name, email=f"teacher{index}@{DOMAIN}", role="teacher", is_active=True,
            teacher_id=f"SEED-T{index:02d}", designation="Associate Professor" if index % 2 else "Assistant Professor",
        )
        db.add(teacher)
        teachers.append(teacher)
    await db.flush()
    for teacher in teachers:
        await sync_profile(db, teacher)

    roll = 0
    teacher_cursor = 0
    sections_made = subjects_made = students_made = 0
    for program_index, (name, code, years, subject_names) in enumerate(PROGRAMS):
        course = SqlCourse(id=_id(), name=name, code=code, duration_years=years)
        db.add(course)
        await db.flush()
        for start_year, study_year, semester in INTAKES:
            if study_year > years:
                continue
            batch = SqlBatch(id=_id(), course_id=course.id, start_year=start_year, end_year=start_year + years, status="active")
            db.add(batch)
            await db.flush()
            subjects = [
                SqlSubject(id=_id(), name=subject, code=f"{code}{study_year}{position + 1:02d}", course_id=course.id, batch_id=batch.id, year=study_year)
                for position, subject in enumerate(subject_names)
            ]
            db.add_all(subjects)
            subjects_made += len(subjects)
            for section_name in SECTIONS:
                section = SqlSection(id=_id(), course_id=course.id, batch_id=batch.id, name=section_name)
                db.add(section)
                await db.flush()
                sections_made += 1
                teacher = teachers[teacher_cursor % len(teachers)]
                teacher_cursor += 1
                db.add(
                    SqlTeacherSessionAllocation(
                        id=_id(), teacher_id=teacher.id, session_id=session.id, program_id=course.id, batch_id=batch.id,
                        section_id=section.id, subject_ids=[subject.id for subject in subjects[:2]],
                    )
                )
                for _ in range(3):
                    roll += 1
                    first = FIRST_NAMES[roll % len(FIRST_NAMES)]
                    last = LAST_NAMES[(roll * 3) % len(LAST_NAMES)]
                    student = SqlUser(
                        id=_id(), name=f"{first} {last}", email=f"student{roll:03d}@{DOMAIN}", role="student", is_active=True,
                        roll_no=f"SEED-{code}-{start_year}-{roll:03d}", course_id=course.id, batch_id=batch.id, section_id=section.id,
                        year=study_year, semester=semester, github_username=f"{first}{last}{roll}".lower(),
                    )
                    db.add(student)
                    await db.flush()
                    await sync_profile(db, student)
                    db.add(
                        SqlStudentSessionRecord(
                            id=_id(), student_id=student.id, session_id=session.id, batch_id=batch.id, section_id=section.id,
                            study_year=study_year, semester=semester, status="active",
                        )
                    )
                    students_made += 1

    admin = SqlUser(id=_id(), name="Demo Admin (limited)", email=f"admin1@{DOMAIN}", role="admin", is_active=True)
    db.add(admin)
    await db.flush()
    await sync_profile(db, admin)
    await db.flush()
    db.add_all(
        SqlAdminAccess(user_id=admin.id, resource=resource, level=level)
        for resource, level in {"batches": "full", "sections": "edit", "subjects": "edit", "users": "view", "audit_log": "view"}.items()
    )
    await db.commit()
    print(
        f"Created {len(PROGRAMS)} programs, {sections_made} sections, {subjects_made} subjects, "
        f"{len(teachers)} teachers, {students_made} students and 1 admin (session {session.label} {session.term}, {datetime.date.today()})"
    )


async def main() -> None:
    await init_database()
    if not is_database_available() or async_session_factory is None:
        raise RuntimeError("CampusGrade database is unavailable")
    async with async_session_factory() as db:
        if "--remove" in sys.argv:
            await _remove(db)
        else:
            await _create(db)


if __name__ == "__main__":
    asyncio.run(main())
