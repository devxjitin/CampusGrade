"""Assignment API: one router per concern, combined under /assignments."""

from fastapi import APIRouter

from .admin import router as admin_router
from .announcements import router as announcements_router
from .crud import router as crud_router
from .external_ai import router as external_ai_router
from .grading import router as grading_router
from .submissions import router as submissions_router

router = APIRouter(prefix="/assignments", tags=["assignments"])
router.include_router(crud_router)
router.include_router(submissions_router)
router.include_router(external_ai_router)
router.include_router(grading_router)
router.include_router(announcements_router)
router.include_router(admin_router)
