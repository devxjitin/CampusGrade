import unittest
from unittest.mock import Mock

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from routes_fastapi.admin_routes import (
    MAX_IMPORT_ROWS,
    _commit_delete,
    _normalize_contact_number,
    _normalize_person_name,
    _normalize_student_roll_no,
    _normalize_teacher_id,
    _parse_import_file,
)


class ImportValidationTests(unittest.TestCase):
    def test_rejects_unsupported_import_extension(self):
        with self.assertRaises(HTTPException) as raised:
            _parse_import_file("students.txt", b"name,email\nTest,test@example.edu\n")
        self.assertEqual(400, raised.exception.status_code)

    def test_rejects_csv_with_too_many_rows(self):
        data = "name,email,roll_no\n" + "\n".join(
            f"Student {index},student{index}@example.edu,R{index:04d}"
            for index in range(MAX_IMPORT_ROWS + 1)
        )
        with self.assertRaises(HTTPException) as raised:
            _parse_import_file("students.csv", data.encode("utf-8"))
        self.assertEqual(413, raised.exception.status_code)

    def test_protected_delete_returns_a_conflict_response(self):
        session = Mock()
        session.commit.side_effect = IntegrityError("DELETE", {}, Exception("foreign key constraint"))

        with self.assertRaises(HTTPException) as raised:
            _commit_delete(session, "program")

        self.assertEqual(409, raised.exception.status_code)
        self.assertIn("Cannot delete", raised.exception.detail)
        session.rollback.assert_called_once()

    def test_identity_fields_are_canonicalized(self):
        self.assertEqual("Jane Doe", _normalize_person_name("  Jane   Doe  "))
        self.assertEqual("23CS-001", _normalize_student_roll_no(" 23cs-001 "))
        self.assertEqual("TCH-1001", _normalize_teacher_id(" tch-1001 "))
        self.assertEqual("+919876543210", _normalize_contact_number("+91 98765-43210", required=True))

    def test_contact_number_rejects_incomplete_values(self):
        with self.assertRaises(HTTPException) as raised:
            _normalize_contact_number("12345", required=True)
        self.assertEqual(400, raised.exception.status_code)


if __name__ == "__main__":
    unittest.main()
