"""Convenience runner: `uv run python backend/main.py` (or `python main.py` from backend/).

Containers run gunicorn directly (see gunicorn.conf.py); this is only for quick
local runs outside Docker. It starts the same ASGI app, `app:app`.
"""

from config import get_settings


def main() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run("app:app", host="0.0.0.0", port=settings.port, reload=settings.fastapi_reload)


if __name__ == "__main__":
    main()
