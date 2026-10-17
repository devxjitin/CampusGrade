"""Document text extraction used by assignment workflows."""

import logging
import os
from io import BytesIO
from typing import Any

logger = logging.getLogger("CampusGrade.AssignmentAI")


def _safe_text(value: Any, max_length: int = 2000) -> str:
    if value is None:
        return ""
    return str(value).replace("\x00", "").strip()[:max_length]


def _normalize_multiline_text(value: str, max_length: int = 100000) -> str:
    if not value:
        return ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line)[:max_length]


def extract_text_from_document(filename: str, content_bytes: bytes) -> tuple[str, str | None]:
    if not isinstance(content_bytes, (bytes, bytearray)):
        return "", "Invalid file payload"
    raw = bytes(content_bytes)
    if not raw:
        return "", "Uploaded file is empty"
    extension = os.path.splitext(_safe_text(filename, 260).lower())[1]
    try:
        if extension == ".pdf":
            from pypdf import PdfReader

            text = _normalize_multiline_text(
                "\n\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(raw)).pages),
                max_length=90000,
            )
        elif extension == ".docx":
            import docx

            document = docx.Document(BytesIO(raw))
            text = _normalize_multiline_text(
                "\n".join(paragraph.text for paragraph in document.paragraphs),
                max_length=90000,
            )
        else:
            text = _normalize_multiline_text(raw.decode("utf-8", errors="ignore"), max_length=90000)
        return (text, None) if text else ("", f"No extractable text found in {extension.lstrip('.').upper() or 'document'}")
    except Exception as exc:
        logger.error("Document text extraction failed: %s", exc)
        return "", "Failed to extract text from uploaded document"
