import os
import sys
import importlib
from pathlib import Path


def _reexec_in_project_venv() -> None:
    """Re-run with the project venv interpreter when available on Windows."""
    if os.name != "nt":
        return

    project_root = Path(__file__).resolve().parents[1]
    venv_python = project_root / ".venv" / "Scripts" / "python.exe"
    if not venv_python.exists():
        return

    current_python = Path(sys.executable).resolve()
    if current_python == venv_python.resolve():
        return

    os.execv(str(venv_python), [str(venv_python), __file__, *sys.argv[1:]])


if __name__ == "__main__":
    _reexec_in_project_venv()

    try:
        uvicorn = importlib.import_module("uvicorn")
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Missing dependency 'uvicorn'. Install backend dependencies from backend/requirements.txt"
        ) from exc

    from config import get_settings

    settings = get_settings()
    uvicorn.run("app:app", host="0.0.0.0", port=settings.port, reload=settings.fastapi_reload)

