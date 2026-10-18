import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from routes_fastapi.assignments.workflow import _check_context_rows, _teacher_allocated


def _rows(**overrides):
    course = SimpleNamespace(id="p1")
    batch = SimpleNamespace(id="b1", course_id="p1")
    section = SimpleNamespace(id="s1", course_id="p1", batch_id="b1")
    subject = SimpleNamespace(id="u1", course_id="p1", batch_id="b1")
    rows = {"course": course, "batch": batch, "section": section, "subject": subject}
    rows.update(overrides)
    return rows


class AssignmentContextTests(unittest.TestCase):
    def test_consistent_chain_passes(self):
        _check_context_rows(**_rows())

    def test_batch_from_another_program_is_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            _check_context_rows(**_rows(batch=SimpleNamespace(id="b1", course_id="p2")))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_section_from_another_batch_is_rejected(self):
        with self.assertRaises(HTTPException):
            _check_context_rows(**_rows(section=SimpleNamespace(id="s1", course_id="p1", batch_id="b2")))

    def test_subject_from_another_batch_is_rejected(self):
        with self.assertRaises(HTTPException):
            _check_context_rows(**_rows(subject=SimpleNamespace(id="u1", course_id="p1", batch_id="b2")))

    def test_subject_without_batch_is_allowed(self):
        _check_context_rows(**_rows(subject=SimpleNamespace(id="u1", course_id="p1", batch_id=None)))

    def test_missing_rows_are_rejected(self):
        for key in ("course", "batch", "section", "subject"):
            with self.assertRaises(HTTPException):
                _check_context_rows(**_rows(**{key: None}))

    def test_teacher_allocation_must_match_whole_combination(self):
        allocations = [{"program_id": "p1", "batch_id": "b1", "section_id": "s1", "subject_ids": ["u1"]}]
        self.assertTrue(_teacher_allocated(allocations, "p1", "b1", "s1", "u1"))
        self.assertFalse(_teacher_allocated(allocations, "p1", "b1", "s2", "u1"))
        self.assertFalse(_teacher_allocated(allocations, "p1", "b1", "s1", "u2"))

    def test_teacher_without_allocations_is_denied(self):
        self.assertFalse(_teacher_allocated([], "p1", "b1", "s1", "u1"))
        self.assertFalse(_teacher_allocated(None, "p1", "b1", "s1", "u1"))
