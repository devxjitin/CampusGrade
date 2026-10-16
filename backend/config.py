"""Typed application configuration (Sprint 1, IMPLEMENTATION_PLAN.md).

Replaces ~32 scattered `os.getenv(...)` calls across the backend with one
object, validated once at import. The app should refuse to start on a bad
value rather than fail confusingly on the first request that needs it —
`_secret()` in `app.py` already did this for `SECRET_KEY`; this extends the
same idea to every setting.

Placement note (deviation from IMPLEMENTATION_PLAN.md Sprint 1): the plan
sketches this as `backend/app/config.py`. `backend/app.py` (the existing
FastAPI entrypoint module) would collide with a new `app/` package — you
cannot have both `app.py` and `app/` importable from the same root. Renaming
`app.py` into `app/main.py` is a real, disclosed piece of the target layout
(see ARCHITECTURE.md §5.1), but it belongs with the domain-split sprints
(Sprint 10+) where the rest of the package layout actually changes — doing
it half-finished now would just mean renaming it again later. So this
module lives at `backend/config.py` and the new core helpers live under the
existing `backend/core/` package. Nothing about the *content* of this file
differs from the plan — only where it sits until Sprint 10.
"""

from __future__ import annotations

from functools import lru_cache

from dotenv import load_dotenv
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# `models/database.py` used to be the module every other module transitively
# imported early enough to bootstrap `.env` into os.environ via
# `load_dotenv()`. This module is now imported earlier than that (from
# `app.py` and `main.py`, at the top), so it takes over that role — the
# handful of places intentionally still reading `os.getenv` directly
# (`utils/security_utils.py`'s live SECRET_KEY read for legacy Fernet
# ciphertext, `migrations/env.py` which Alembic runs outside the app
# entirely) still see `.env` values.
load_dotenv()

_WEAK_SECRETS = {
    "super_secret_jwt_key_here",
    "dev-fallback-change-me-in-production-2026",
    "change-me",
    "changeme",
    "secret",
    "default",
    "password",
}

# Display-only institution label. Academic ownership starts at Program after
# Sprint 8 display-only school label; no lookup identifier exists anymore.
DEPARTMENT_NAME = "School of Engineering and Technology"


def is_weak_secret(value: str) -> bool:
    """Same predicate `app.py` used to enforce inline as `_is_weak_secret`.

    Pulled out so it can be unit-tested on its own (see
    `backend/tests/test_security.py::PasswordSecurityTests`) and reused by
    the `Settings` validator below, instead of living only inside a
    validator where it's harder to exercise directly.
    """
    candidate = (value or "").strip()
    return len(candidate) < 32 or candidate.isdigit() or len(set(candidate)) < 8 or candidate.lower() in _WEAK_SECRETS


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- core ---
    app_env: str = "development"
    app_id: str = "canvas-grade"
    secret_key: str
    port: int = 5001
    fastapi_reload: bool = False

    # --- database ---
    database_url: str = ""

    # --- CORS / cookies ---
    # Kept as a raw string field (not list[str]) deliberately: pydantic-settings
    # attempts to JSON-decode any env var mapped to a list-typed field before
    # a field_validator ever runs, so "http://a,http://b" (the format this app
    # has always used) raises a SettingsError at import time instead of being
    # comma-split. `allowed_origins` below is the list version everything else
    # should read.
    allowed_origins_raw: str = Field(default="http://localhost:5174,http://localhost:3000", alias="ALLOWED_ORIGINS")
    cookie_secure: bool = False
    # Sprint 6, IMPLEMENTATION_PLAN.md: the access token moves into an
    # httpOnly cookie this sprint, but the `Authorization` header is still
    # accepted for one sprint so the not-yet-updated frontend keeps working
    # (see `routes_fastapi/deps.py::get_bearer_token`) and CSRF is enforced
    # on cookie-authenticated mutating requests. The plan's rollback plan
    # for this sprint is exactly this flag: "Feature flag
    # AUTH_COOKIE_MODE=false falls back to header auth. Keep the flag for
    # two sprints." Defaults `True` — cookie mode is what's actually live;
    # flipping it off is the emergency escape hatch, not the normal state.
    auth_cookie_mode: bool = True

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins_raw.split(",") if origin.strip()]

    # --- redis (jobs queue today; dropped in Sprint 14) ---
    redis_url: str = "redis://localhost:6379/0"
    redis_required: bool = False

    # --- private object storage ---
    private_storage_backend: str = "local"
    private_storage_path: str | None = None
    private_s3_bucket: str | None = None
    private_s3_endpoint: str | None = None
    private_s3_region: str | None = None

    # --- github repository submissions ---
    github_token: str | None = None
    assignment_max_archive_bytes: int = 100 * 1024 * 1024
    assignment_max_files: int = 10_000
    assignment_max_text_bytes: int = 1024 * 1024
    repository_sync_interval_seconds: int = 120

    # --- external AI (Azure OpenAI today; see ARCHITECTURE.md §6) ---
    azure_openai_endpoint: str | None = None
    azure_openai_api_key: str | None = None
    azure_openai_deployment: str | None = None
    azure_openai_api_version: str = "2024-10-21"
    # Documented migration aliases (see ai/assignment_ai.py::_azure_openai_config) — kept for compatibility, not new.
    azure_openai_base_url: str | None = None
    azure_openai_model: str | None = None

    # --- sessions ---
    revoked_session_retention_days: int = 7

    # --- bootstrap admin (bootstrap_admin.py, run once per environment) ---
    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: str | None = None
    bootstrap_admin_name: str = "CampusGrade Administrator"

    @field_validator("secret_key")
    @classmethod
    def _secret_key_must_be_strong(cls, value: str) -> str:
        candidate = (value or "").strip()
        if is_weak_secret(candidate):
            raise ValueError("SECRET_KEY must be a unique value of at least 32 characters")
        return candidate

    @field_validator("private_storage_backend")
    @classmethod
    def _known_storage_backend(cls, value: str) -> str:
        normalized = (value or "local").lower()
        if normalized not in {"local", "s3"}:
            raise ValueError("PRIVATE_STORAGE_BACKEND must be 'local' or 's3'")
        return normalized


@lru_cache
def get_settings() -> Settings:
    """Cached — `Settings()` is read once per process, not once per call.

    Tests that need a different configuration should call
    `get_settings.cache_clear()` after setting environment variables via
    `monkeypatch.setenv`, then call `get_settings()` again.
    """
    return Settings()
