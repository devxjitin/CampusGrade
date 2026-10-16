"""Structured JSON logging (Sprint 1, IMPLEMENTATION_PLAN.md).

One line of JSON per log record, with `request_id` attached wherever it's
available, so a single request's log lines can be grepped out of a shared
log stream by that id alone. Never logs request/response bodies — those can
contain passwords, submitted repository content, or AI prompts, none of
which belong in a log aggregator.

Named `logging_setup.py` rather than `logging.py`: a module inside a
package that shares the stdlib's module name is legal in Python 3 (absolute
imports mean `import logging` elsewhere still resolves to the stdlib), but
it reads as a trap for the next person editing this file, so it's avoided.
"""

from __future__ import annotations

import json
import logging
import sys
import time
from contextvars import ContextVar
from typing import Any

_RESERVED = frozenset(logging.LogRecord("", 0, "", 0, "", (), None).__dict__.keys()) | {"message", "asctime"}

_request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)


def set_request_id(request_id: str | None) -> None:
    """Called once per request by the security/request-context middleware."""
    _request_id_ctx.set(request_id)


class RequestIdFilter(logging.Filter):
    """Attaches the current request's id to every log record automatically,
    so call sites don't need `logger.info(..., extra={"request_id": ...})`
    at every call. Falls back to nothing outside a request (startup,
    background jobs before Sprint 14 gives them their own context)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = _request_id_ctx.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None)
        if request_id:
            payload["request_id"] = request_id
        for key, value in record.__dict__.items():
            if key not in _RESERVED and key != "request_id":
                try:
                    json.dumps(value)
                except TypeError:
                    value = str(value)
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(*, level: str = "INFO") -> None:
    """Call once, at process start, before any other logging happens."""
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RequestIdFilter())
    root.addHandler(handler)

    # These are noisy at INFO and rarely useful in an application log.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
