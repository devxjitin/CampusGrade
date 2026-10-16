from core.errors import register_error_handlers
from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_unhandled_exception_uses_problem_envelope() -> None:
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/explode")
    async def explode() -> None:
        raise RuntimeError("database credentials must never leak")

    response = TestClient(app, raise_server_exceptions=False).get("/explode")

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json() == {
        "type": "https://campusgrade.dev/errors/internal-error",
        "title": "Internal server error",
        "status": 500,
        "code": "INTERNAL_ERROR",
        "detail": "An unexpected error occurred.",
        "request_id": "unknown",
    }
