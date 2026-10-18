"""Strict validation of the JSON an external AI returns for a new assignment.

Nothing is repaired silently: every problem is reported with the path of the offending field so the teacher
can fix the JSON (or ask the AI again) and validate once more.
"""

import re
import uuid

SCHEMA_VERSION = 1
MARKS_TOLERANCE = 0.01
MIN_INSTRUCTIONS_LENGTH = 100
_MERMAID_BLOCK = re.compile(r"```\s*mermaid\b", re.IGNORECASE)


def _number(value):
    """A real JSON number, not a bool or a numeric string."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _text(errors, path, value, *, max_length, required=True):
    if not isinstance(value, str):
        errors.append({"student": "", "criterion": None, "path": path, "message": "Must be text"})
        return ""
    value = value.strip()
    if required and not value:
        errors.append({"student": "", "criterion": None, "path": path, "message": "Must not be empty"})
    elif len(value) > max_length:
        errors.append({"student": "", "criterion": None, "path": path, "message": f"Must be at most {max_length} characters (found {len(value)})"})
    return value


def _text_list(errors, path, value, *, max_items, max_length):
    if value is None:
        return []
    if not isinstance(value, list):
        errors.append({"student": "", "criterion": None, "path": path, "message": "Must be a list of text values"})
        return []
    if len(value) > max_items:
        errors.append({"student": "", "criterion": None, "path": path, "message": f"At most {max_items} items are allowed (found {len(value)})"})
    clean = []
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            errors.append({"student": "", "criterion": None, "path": f"{path}[{index}]", "message": "Must be non-empty text"})
        elif len(item.strip()) > max_length:
            errors.append({"student": "", "criterion": None, "path": f"{path}[{index}]", "message": f"Must be at most {max_length} characters"})
        else:
            clean.append(item.strip())
    return clean


def validate_ai_proposal(payload, draft: dict) -> tuple[dict, list[str], list[dict]]:
    """Return (proposal, warnings, errors). `draft` holds the settings signed into the prompt's draft token.

    `proposal` is only meaningful when `errors` is empty.
    """
    errors: list[dict] = []
    warnings: list[str] = []

    def problem(path, message):
        errors.append({"student": "", "criterion": None, "path": path, "message": message})

    if not isinstance(payload, dict):
        problem("", "The response must be one JSON object")
        return {}, warnings, errors

    if payload.get("schema_version") != SCHEMA_VERSION:
        problem("schema_version", f"Must be {SCHEMA_VERSION}")
    if payload.get("draft_ref") != draft["draft_ref"]:
        problem("draft_ref", "Does not match this prompt. Use the reply to the prompt you copied, and keep draft_ref unchanged")

    title = _text(errors, "title", payload.get("title"), max_length=255)
    short_description = _text(errors, "short_description", payload.get("short_description"), max_length=500)
    instructions = _text(errors, "instructions", payload.get("instructions"), max_length=50_000)
    if instructions and len(instructions) < MIN_INSTRUCTIONS_LENGTH:
        problem("instructions", f"Too short to guide students (at least {MIN_INSTRUCTIONS_LENGTH} characters)")
    if instructions and not _MERMAID_BLOCK.search(instructions):
        warnings.append("The instructions have no Mermaid diagram")

    outcomes = _text_list(errors, "learning_outcomes", payload.get("learning_outcomes"), max_items=10, max_length=300)
    tags = _text_list(errors, "tags", payload.get("tags"), max_items=12, max_length=80)

    if payload.get("difficulty") != draft["difficulty"]:
        problem("difficulty", f"Must be {draft['difficulty']}")

    requirements = payload.get("repository_requirements")
    required_files: list[str] = []
    if not isinstance(requirements, dict):
        problem("repository_requirements", "Must be an object with require_readme and required_files")
    else:
        if requirements.get("require_readme") is not draft["require_readme"]:
            problem("repository_requirements.require_readme", f"Must be {str(draft['require_readme']).lower()}")
        required_files = _text_list(errors, "repository_requirements.required_files", requirements.get("required_files"), max_items=20, max_length=255)
        for index, name in enumerate(required_files):
            if name.startswith(("/", "\\")) or ".." in name.replace("\\", "/").split("/") or re.match(r"^[A-Za-z]:", name):
                problem(f"repository_requirements.required_files[{index}]", "Must be a relative path inside the repository")
        if draft["require_readme"] and not any(name.lower() == "readme.md" for name in required_files):
            warnings.append("A README is required but README.md is not in required_files")

    total_marks = _number(payload.get("total_marks"))
    if total_marks is None:
        problem("total_marks", "Must be a number")
    elif abs(total_marks - draft["total_marks"]) > MARKS_TOLERANCE:
        problem("total_marks", f"Must be {draft['total_marks']:g} (found {total_marks:g})")

    rubric = payload.get("rubric")
    clean_rubric: list[dict] = []
    if not isinstance(rubric, list):
        problem("rubric", "Must be a list of criteria")
    else:
        if len(rubric) != draft["rubric_count"]:
            problem("rubric", f"Must have exactly {draft['rubric_count']} criteria (found {len(rubric)})")
        rubric_sum = 0.0
        titles: set[str] = set()
        for index, item in enumerate(rubric):
            base = f"rubric[{index}]"
            if not isinstance(item, dict):
                problem(base, "Must be an object with title, description and max_marks")
                continue
            item_title = _text(errors, f"{base}.title", item.get("title"), max_length=150)
            description = _text(errors, f"{base}.description", item.get("description"), max_length=2000)
            marks = _number(item.get("max_marks"))
            if marks is None or marks <= 0:
                problem(f"{base}.max_marks", "Must be a number greater than 0")
            else:
                rubric_sum += marks
            if item_title and item_title.casefold() in titles:
                warnings.append(f"Criterion title '{item_title}' is repeated")
            titles.add(item_title.casefold())
            clean_rubric.append({"id": str(uuid.uuid4()), "title": item_title, "description": description, "max_marks": round(marks, 2) if marks else 0})
        if len(rubric) == draft["rubric_count"] and abs(rubric_sum - draft["total_marks"]) > MARKS_TOLERANCE:
            problem("rubric", f"Criteria marks add up to {rubric_sum:g} but must add up to {draft['total_marks']:g}")

    proposal = {
        "title": title,
        "short_description": short_description,
        "instructions": instructions,
        "learning_outcomes": outcomes,
        "tags": tags,
        "difficulty": draft["difficulty"],
        "repository_requirements": {"require_readme": draft["require_readme"], "required_files": required_files},
        "total_marks": draft["total_marks"],
        "rubric": clean_rubric,
    }
    return proposal, warnings, errors
