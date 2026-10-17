"""Input validation and sanitization utilities for CampusGrade accounts."""

import re


class ValidationError(Exception):
    def __init__(self, message, status_code=400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def parse_json_body(data=None, allow_empty=False):
    if data is None:
        raise ValidationError("Request body is required", 400)
    if not isinstance(data, dict):
        raise ValidationError("JSON body must be an object", 400)
    if not allow_empty and not data:
        raise ValidationError("Request body is required", 400)
    return data


def validate_password(password):
    if not password or len(password) < 8:
        return False, "Password must be at least 8 characters long"
    if len(password) > 128:
        return False, "Password must not exceed 128 characters"
    if not re.search(r"[A-Z]", password):
        return False, "Password must contain at least one uppercase letter"
    if not re.search(r"[a-z]", password):
        return False, "Password must contain at least one lowercase letter"
    if not re.search(r"\d", password):
        return False, "Password must contain at least one digit"
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};:'\",.<>?/\\|`~]", password):
        return False, "Password must contain at least one special character"
    return True, None


def validate_email(email):
    if not email:
        return False, "Email is required"
    if len(email) > 254:
        return False, "Email must not exceed 254 characters"
    if not re.match(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", email.strip()):
        return False, "Invalid email format"
    return True, None


def sanitize_string(value, max_length=500):
    if not isinstance(value, str):
        return value
    return value.replace("\x00", "").strip()[:max_length]


def validate_role(role):
    # Sprint 5, the original implementation plan: "admin" split into "super_admin"/
    # "admin" (see migrations `canvasgrade_022` and `canvasgrade_031`).
    valid_roles = ["student", "teacher", "super_admin", "admin"]
    if role not in valid_roles:
        return False, f"Invalid role. Must be one of: {', '.join(valid_roles)}"
    return True, None
