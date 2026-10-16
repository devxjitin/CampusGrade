"""Seed program-based academic master data.

This command is intentionally limited to academic lookup records. It is safe to
run repeatedly: records are matched by stable codes/year ranges and updated in
place. User demo accounts belong in test fixtures, not a production seed path.
"""

from __future__ import annotations

import asyncio
import uuid

from models.database import async_session_factory, init_database, is_database_available
from models.sql_models import SqlBatch, SqlCourse, SqlSection, SqlSubject
from sqlalchemy import func

PROGRAMS = (
    {"code": "CSE-BTECH", "name": "B.Tech Computer Science and Engineering", "duration_years": 4},
    {"code": "AIDS-BTECH", "name": "B.Tech Artificial Intelligence and Data Science", "duration_years": 4},
    {"code": "IT-BTECH", "name": "B.Tech Information Technology", "duration_years": 4},
    {"code": "BCA-DS", "name": "BCA Data Science", "duration_years": 3},
    {"code": "ECE-BTECH", "name": "B.Tech Electronics and Communication Engineering", "duration_years": 4},
    {"code": "ME-BTECH", "name": "B.Tech Mechanical Engineering", "duration_years": 4},
    {"code": "BBA-GEN", "name": "BBA", "duration_years": 3},
    {"code": "MBA-BUS", "name": "MBA", "duration_years": 2},
)

BATCHES = {
    "CSE-BTECH": ((2023, 2027), (2024, 2028)),
    "AIDS-BTECH": ((2024, 2028),),
    "IT-BTECH": ((2023, 2027), (2024, 2028)),
    "BCA-DS": ((2024, 2027), (2025, 2028)),
    "ECE-BTECH": ((2023, 2027), (2024, 2028)),
    "ME-BTECH": ((2024, 2028),),
    "BBA-GEN": ((2024, 2027), (2025, 2028)),
    "MBA-BUS": ((2024, 2026), (2025, 2027)),
}

SECTIONS = {
    "CSE-BTECH": ("A", "B", "C"),
    "AIDS-BTECH": ("A", "B"),
    "IT-BTECH": ("A", "B"),
    "BCA-DS": ("A", "B"),
    "ECE-BTECH": ("A", "B"),
    "ME-BTECH": ("A",),
    "BBA-GEN": ("A", "B"),
    "MBA-BUS": ("A",),
}

SUBJECTS = (
    ("CSE-BTECH", "CSE201", "Data Structures and Algorithms", 2, 4),
    ("CSE-BTECH", "CSE202", "Operating Systems", 2, 4),
    ("CSE-BTECH", "CSE203", "Database Management Systems", 2, 4),
    ("CSE-BTECH", "CSE204", "Computer Networks", 3, 4),
    ("CSE-BTECH", "CSE205", "Software Engineering", 3, 3),
    ("AIDS-BTECH", "CSE206", "Machine Learning", 3, 4),
    ("AIDS-BTECH", "CSE207", "Artificial Intelligence", 3, 4),
    ("AIDS-BTECH", "CSE208", "Data Visualization", 2, 3),
    ("IT-BTECH", "IT211", "Web Application Engineering", 2, 4),
    ("IT-BTECH", "IT212", "Cloud Infrastructure Management", 3, 4),
    ("IT-BTECH", "IT213", "Cyber Security Fundamentals", 2, 4),
    ("BCA-DS", "IT215", "Data Warehousing", 2, 3),
    ("ECE-BTECH", "ECE221", "Analog Electronic Circuits", 2, 4),
    ("ECE-BTECH", "ECE222", "Digital System Design", 2, 4),
    ("ECE-BTECH", "ECE224", "Embedded Systems", 3, 4),
    ("ME-BTECH", "ME231", "Engineering Mechanics", 1, 4),
    ("ME-BTECH", "ME232", "Thermodynamics", 2, 4),
    ("ME-BTECH", "ME233", "Manufacturing Technology", 2, 4),
    ("BBA-GEN", "MG241", "Principles of Management", 1, 3),
    ("BBA-GEN", "MG242", "Financial Accounting", 1, 3),
    ("MBA-BUS", "MG246", "Strategic Management", 1, 3),
    ("MBA-BUS", "MG247", "Business Analytics", 1, 3),
)


def _id() -> str:
    return str(uuid.uuid4())


def seed(session) -> dict[str, int]:
    changes = {"programs": 0, "batches": 0, "sections": 0, "subjects": 0}
    programs_by_code = {row.code.upper(): row for row in session.query(SqlCourse).all()}

    for item in PROGRAMS:
        program = programs_by_code.get(item["code"])
        if program is None:
            program = SqlCourse(id=_id(), code=item["code"], name=item["name"])
            session.add(program)
            programs_by_code[item["code"]] = program
            changes["programs"] += 1
        program.name = item["name"]
        program.duration_years = item["duration_years"]
        program.year = 1
    session.flush()

    batches_by_key = {(row.course_id, row.start_year, row.end_year): row for row in session.query(SqlBatch).all()}
    for code, ranges in BATCHES.items():
        program = programs_by_code[code]
        for start_year, end_year in ranges:
            key = (program.id, start_year, end_year)
            if key not in batches_by_key:
                batch = SqlBatch(
                    id=_id(),
                    course_id=program.id,
                    start_year=start_year,
                    end_year=end_year,
                    name=f"{start_year}-{end_year}",
                    status="active",
                )
                session.add(batch)
                batches_by_key[key] = batch
                changes["batches"] += 1
    session.flush()

    sections_by_key = {(row.course_id, row.batch_id, row.name.casefold()): row for row in session.query(SqlSection).all()}
    for code, names in SECTIONS.items():
        program = programs_by_code[code]
        program_batches = [row for key, row in batches_by_key.items() if key[0] == program.id]
        for batch in program_batches:
            for name in names:
                key = (program.id, batch.id, name.casefold())
                if key not in sections_by_key:
                    section = SqlSection(id=_id(), course_id=program.id, batch_id=batch.id, name=name)
                    session.add(section)
                    sections_by_key[key] = section
                    changes["sections"] += 1

    subjects_by_key = {(row.course_id, row.code.upper()): row for row in session.query(SqlSubject).all()}
    for code, subject_code, name, year, credits in SUBJECTS:
        program = programs_by_code[code]
        key = (program.id, subject_code)
        subject = subjects_by_key.get(key)
        if subject is None:
            subject = SqlSubject(id=_id(), course_id=program.id, code=subject_code, name=name)
            session.add(subject)
            subjects_by_key[key] = subject
            changes["subjects"] += 1
        subject.name = name
        subject.year = year
        subject.credits = credits
        subject.enrollment_type = "compulsory"

    session.flush()
    return changes


def _totals(session) -> dict[str, int]:
    return {
        "programs": session.query(func.count(SqlCourse.id)).scalar(),
        "batches": session.query(func.count(SqlBatch.id)).scalar(),
        "sections": session.query(func.count(SqlSection.id)).scalar(),
        "subjects": session.query(func.count(SqlSubject.id)).scalar(),
    }


async def main() -> int:
    await init_database()
    if not is_database_available():
        print("Database is unavailable; academic seed was not run.")
        return 1
    if async_session_factory is None:
        print("Async database session factory is unavailable; academic seed was not run.")
        return 1
    async with async_session_factory() as session:
        changes = await session.run_sync(seed)
        totals = await session.run_sync(_totals)
        await session.commit()
    print("Academic seed complete")
    for name in changes:
        print(f"{name}: {changes[name]} created, {totals[name]} total")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
