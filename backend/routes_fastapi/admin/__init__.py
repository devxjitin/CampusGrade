"""Aggregated admin-domain router with stable public paths."""
from fastapi import APIRouter

from routes_fastapi.admin import academic_sessions, admins, batches, courses, exports, jobs, sections, session_rollover, subjects, users

router = APIRouter()
router.include_router(users.router)
router.include_router(admins.router)
router.include_router(courses.router)
router.include_router(batches.router)
router.include_router(sections.router)
router.include_router(subjects.router)
router.include_router(academic_sessions.router)
router.include_router(session_rollover.router)
router.include_router(jobs.router)
router.include_router(exports.router)

__all__ = ["router"]
