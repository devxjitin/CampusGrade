"""Job handler registry. Handlers take the job payload and raise to signal failure."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

Handler = Callable[[dict], Awaitable[None]]

HANDLERS: dict[str, Handler] = {}


def register(job_type: str) -> Callable[[Handler], Handler]:
    def decorator(func: Handler) -> Handler:
        HANDLERS[job_type] = func
        return func

    return decorator
