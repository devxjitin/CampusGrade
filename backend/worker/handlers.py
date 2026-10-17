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


@register("repository.analyze")
async def analyze_repository(payload: dict) -> None:
    from services.github_repository_service import analyze_repository_version

    await analyze_repository_version(payload["version_id"])
