from fastapi import HTTPException
from models.sql_models import SqlBatch, SqlCourse, SqlSection
from sqlalchemy.orm import Session


class AcademicService:
    """Cross-entity academic hierarchy checks, reusable by admin operations."""

    @staticmethod
    def require_course(db: Session, course_id: str) -> SqlCourse:
        course = db.query(SqlCourse).filter(SqlCourse.id == course_id).first()
        if not course:
            raise HTTPException(status_code=404, detail="Program not found")
        return course

    @staticmethod
    def require_batch_for_course(db: Session, batch_id: str, course_id: str | None = None) -> SqlBatch:
        batch = db.query(SqlBatch).filter(SqlBatch.id == batch_id).first()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if course_id and batch.course_id != course_id:
            raise HTTPException(status_code=400, detail="Batch does not belong to selected program")
        return batch

    @staticmethod
    def require_section_for_batch(
        db: Session,
        section_id: str,
        course_id: str | None = None,
        batch_id: str | None = None,
    ) -> SqlSection:
        section = db.query(SqlSection).filter(SqlSection.id == section_id).first()
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")
        if course_id and section.course_id != course_id:
            raise HTTPException(status_code=400, detail="Section does not belong to selected program")
        if batch_id and section.batch_id != batch_id:
            raise HTTPException(status_code=400, detail="Section does not belong to selected batch")
        return section
