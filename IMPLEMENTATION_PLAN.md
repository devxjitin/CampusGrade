# CampusGrade — Implementation Plan

**Companion to:** `ARCHITECTURE.md` (read that first — it explains *why*)
**This document:** *what to do, in what order, and how*
**Date:** 2026-07-25

---

## How to read this

20 sprints. Each sprint is **one week** of focused work. Each sprint has:

| Section | Meaning |
|---|---|
| **Goal** | One sentence. If you can't say it in one sentence, the sprint is too big. |
| **Depends on** | Sprints that must be finished first. |
| **DB** | Migrations and schema work. |
| **Backend** | Python work. |
| **Frontend** | TypeScript work. |
| **How** | Step by step, with real file paths and code. |
| **Done when** | Checkable facts. Not "it feels better". |
| **Rollback** | How to undo it if it goes wrong in production. |
| **Risk** | What could bite you. |

### Two tracks

Most sprints are backend-led. Some are frontend-led. With **two people**, run them in
parallel where the dependency graph allows — that turns 20 weeks into about 13.

```
Week   1  2  3  4  5  6  7  8  9 10 11 12 13
BE  |  S0 S1 S2 S3 S4 S5 S6 S8 S9 S9 S10 S11 S12
FE  |  S0 .. .. .. .. .. S6 S7 S7 .. S10 S11 S12
```

(Sprints 13–19 continue after; the chart shows the crowded early part.)

### Dependency graph

```
S0 Guardrails
 └─ S1 Config + errors
     └─ S2 Async DB
         ├─ S3 Policy engine (shadow)
         │   └─ S4 Identity tables
         │       └─ S5 Four roles live
         │           ├─ S6 Cookie auth ──┬─ S7 Frontend shell
         │           └─ S8 Programs rename
         │                └─ S9 subject_offerings   ⚠ riskiest
         │                    └─ S10 Retire admin_routes
         │                        ├─ S11 Assignments
         │                        │   └─ S12 Submissions
         │                        │       └─ S13 Grading
         │                        │           ├─ S15 AI gateway
         │                        │           │   └─ S16 AI proposals
         │                        │           └─ S17 Integrity
         │                        └─ S14 Jobs + worker
         │                            └─ S18 Reporting
         └─────────────────────────────── S19 Hardening
```

### Definition of Done — applies to every sprint

A sprint is not done until **all** of these are true:

1. `uv run pytest backend/tests` passes.
2. `cd frontend && npm run build && npm run lint` passes.
3. `alembic upgrade head` then `alembic downgrade -1` then `alembic upgrade head` works on
   a seeded database.
4. The authorization matrix test passes (from Sprint 3 onward).
5. No new file over 400 lines (backend) or 300 lines (frontend).
6. `CHANGELOG.md` has an entry.
7. Deployed to staging and clicked through by a human as **all four roles**.

### Branch and release rules

- One branch per sprint: `sprint/03-policy-engine`.
- Merge to `main` only when Done. `main` is always deployable.
- Tag each merge: `v0.<sprint>.0`.
- **Expand → migrate → contract** for every schema change:
  1. *Expand* — add the new column/table. Old code still works.
  2. *Migrate* — backfill, dual-write, switch reads.
  3. *Contract* — drop the old thing, **one sprint later, in a separate migration**.

  Never expand and contract in the same migration. That is what makes a rollback
  impossible.

### Migration naming

Follow the existing convention. Current head is `canvasgrade_020`.

```
backend/migrations/versions/20260803_21_split_identity_tables.py
revision = "canvasgrade_021"
down_revision = "canvasgrade_020"
```

Every migration must have a real `downgrade()`. If a downgrade would lose data, say so in
the docstring and write the data to a `_backup_` table first.

---

# Sprint 0 — Guardrails and baseline

> You cannot safely refactor code you cannot test. This sprint buys the safety net.

**Goal:** Make it impossible to merge a change that breaks the build, and capture a
snapshot of today's behaviour to compare against.

**Depends on:** nothing. Start here.

### Backend

1. **Pin the toolchain.** Add to `pyproject.toml`:

   ```toml
   [dependency-groups]
   dev = [
     "pytest>=8.3,<9", "pytest-asyncio>=0.24", "pytest-cov>=5",
     "httpx>=0.27", "testcontainers[postgres]>=4.8",
     "ruff>=0.7", "mypy>=1.13",
   ]
   ```

2. **Add a real integration test harness.** Today's tests import modules and poke at
   helpers. Add `backend/tests/conftest.py` that spins a throwaway Postgres:

   ```python
   import pytest
   from testcontainers.postgres import PostgresContainer
   from alembic import command
   from alembic.config import Config

   @pytest.fixture(scope="session")
   def database_url():
       with PostgresContainer("postgres:16-alpine") as pg:
           url = pg.get_connection_url().replace("psycopg2", "psycopg")
           cfg = Config("backend/alembic.ini")
           cfg.set_main_option("sqlalchemy.url", url)
           cfg.set_main_option("script_location", "backend/migrations")
           command.upgrade(cfg, "head")
           yield url

   @pytest.fixture
   def client(database_url, monkeypatch):
       monkeypatch.setenv("DATABASE_URL", url_for(database_url))
       monkeypatch.setenv("SECRET_KEY", "test-secret-of-at-least-32-characters-ok")
       from app import app
       from fastapi.testclient import TestClient
       with TestClient(app) as c:
           yield c
   ```

3. **Write characterisation tests** — tests that lock in *current* behaviour, right or
   wrong. These are your seatbelt for every later sprint. Cover the golden path:

   | Test | Asserts |
   |---|---|
   | `test_login_returns_token_and_user` | shape of `/login` response |
   | `test_admin_can_list_users` | `/admin/users` 200 + pagination keys |
   | `test_teacher_creates_assignment` | `/assignments/teacher` POST 201 |
   | `test_student_submits_repository` | `/assignments/student/{id}/submit` |
   | `test_teacher_grades_and_publishes` | grade → publish → student sees it |
   | `test_student_cannot_read_other_student` | 403 |
   | `test_teacher_cannot_grade_other_class` | 403 |

   Record the exact JSON responses to `backend/tests/snapshots/`. When a later sprint
   changes a shape, the diff shows you exactly what the frontend must change.

4. **`ruff` + `mypy` config** in `pyproject.toml`. Start `mypy` on `backend/core/` and
   `backend/schemas/` only — do not try to type 2,600-line files today.

### Frontend

1. Add Vitest and Playwright:

   ```bash
   npm i -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom \
            jsdom @playwright/test
   npx playwright install chromium
   ```

2. One smoke E2E per role in `frontend/e2e/`: log in, land on dashboard, see the right
   nav items. Four tests. That is enough for now.

3. Fix the type generation gap. `src/types/` does not exist:

   ```bash
   cd backend && python app.py &          # or point at staging
   cd frontend && npm run gen:types       # writes src/types/api.d.ts
   ```

   **Commit `src/types/api.d.ts`.** CI will regenerate and fail on drift.

### CI

`.github/workflows/ci.yml` — must be red on a bad PR:

```yaml
name: CI
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv sync
      - run: uv run ruff check backend
      - run: uv run mypy backend/core backend/schemas
      - run: uv run pytest backend/tests --cov=backend --cov-report=term-missing
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - run: npm ci --prefix frontend
      - run: npm run lint --prefix frontend
      - run: npm run build --prefix frontend
      - run: npx --prefix frontend vitest run
  migrations:
    runs-on: ubuntu-latest
    services:
      postgres: { image: postgres:16, env: { POSTGRES_PASSWORD: pw }, ports: ['5432:5432'] }
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv sync
      - run: cd backend && uv run alembic upgrade head && uv run alembic downgrade base && uv run alembic upgrade head
```

### Done when

- [ ] CI runs on every PR and blocks merge on failure.
- [ ] 7+ characterisation tests pass against the real API.
- [ ] `frontend/src/types/api.d.ts` exists and is committed.
- [ ] `alembic downgrade base && alembic upgrade head` works in CI.
- [ ] A deliberately broken PR is rejected by CI (prove it).

### Rollback
Nothing to roll back. This sprint only adds files.

### Risk
Old migrations may not downgrade cleanly. If `downgrade base` fails, fix the offending
migration now — do not skip this. Every later sprint depends on it.

---

# Sprint 1 — Config, errors, logging

**Goal:** One typed config object, one error shape, structured logs. Zero behaviour
change for users.

**Depends on:** S0

### Backend

**1. `backend/app/config.py`** — replaces ~40 scattered `os.getenv` calls.

```python
from functools import lru_cache
from pydantic import Field, PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

WEAK = {"change-me", "changeme", "secret", "default", "password",
        "super_secret_jwt_key_here", "dev-fallback-change-me-in-production-2026"}

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    app_id: str = "canvas-grade"
    secret_key: str
    database_url: str
    allowed_origins: list[str] = ["http://localhost:3000"]

    cookie_secure: bool = False
    cookie_domain: str | None = None
    access_token_minutes: int = 15
    refresh_token_days: int = 14

    private_storage_backend: str = "local"
    private_storage_path: str = "./data/private"
    s3_bucket: str | None = None

    github_token: str | None = None
    github_max_archive_bytes: int = 50 * 1024 * 1024

    ai_provider_grading: str = "azure_openai"
    ai_provider_drafting: str = "azure_openai"
    azure_openai_endpoint: str | None = None
    azure_openai_api_key: str | None = None
    azure_openai_deployment: str | None = None
    azure_openai_api_version: str = "2024-10-21"
    ai_max_runs_per_teacher_per_day: int = 40

    @field_validator("secret_key")
    @classmethod
    def strong_secret(cls, v: str) -> str:
        if len(v) < 32 or v.isdigit() or len(set(v)) < 8 or v.lower() in WEAK:
            raise ValueError("SECRET_KEY must be unique and at least 32 characters")
        return v

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, v):
        return [x.strip() for x in v.split(",") if x.strip()] if isinstance(v, str) else v

@lru_cache
def get_settings() -> Settings:
    return Settings()
```

**How to migrate:** grep for `os.getenv` across `backend/`, replace each with
`get_settings().<field>`. **There are exactly 32.** Do it in one pass, one commit.

```bash
grep -rn "os.getenv" backend --include="*.py" | grep -v __pycache__ | wc -l
```

**2. `backend/app/core/errors.py`** — one exception tree, one handler.

```python
class AppError(Exception):
    status = 400
    code = "APP_ERROR"
    title = "Request failed"
    def __init__(self, detail: str | None = None, **extra):
        self.detail, self.extra = detail, extra

class NotFound(AppError):      status, code, title = 404, "NOT_FOUND", "Not found"
class Forbidden(AppError):     status, code, title = 403, "FORBIDDEN", "You do not have access"
class Unauthenticated(AppError): status, code, title = 401, "UNAUTHENTICATED", "Please sign in"
class Conflict(AppError):      status, code, title = 409, "CONFLICT", "This changed while you were working"
class Invalid(AppError):       status, code, title = 422, "INVALID", "Some fields need attention"
class RateLimited(AppError):   status, code, title = 429, "RATE_LIMITED", "Too many requests"
class Unavailable(AppError):   status, code, title = 503, "UNAVAILABLE", "Service is not ready"
```

Handler returns RFC 9457 `application/problem+json`:

```python
@app.exception_handler(AppError)
async def handle_app_error(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status,
        media_type="application/problem+json",
        content={
            "type": f"https://campusgrade.dev/errors/{exc.code.lower().replace('_','-')}",
            "title": exc.title,
            "status": exc.status,
            "code": exc.code,
            "detail": exc.detail or exc.title,
            "request_id": getattr(request.state, "request_id", "unknown"),
            **exc.extra,
        },
    )
```

> **Compatibility:** keep `"detail"` in the body. The frontend's `api.ts` already reads
> it. That means the frontend does not have to change this sprint.

**3. Structured logging.** `backend/app/core/logging.py` — JSON lines, with
`request_id`, `user_id`, `path`, `status`, `duration_ms`. Never log request bodies.

### Frontend

Small, safe change. In `src/lib/api.ts`, prefer the new `code` field when present:

```ts
const problem = error.response?.data;
error.response.data.message = problem?.detail ?? problem?.title ?? "Something went wrong";
error.response.data.code = problem?.code ?? null;
```

Add `src/lib/errors.ts` mapping `code` → friendly message. Start with 6 codes; grow it as
later sprints add more.

### DB
None.

### Done when

- [ ] `grep -rn "os.getenv" backend --include="*.py" | grep -v __pycache__` returns only
      `config.py`.
- [ ] App refuses to boot with `SECRET_KEY=short` and prints a clear reason.
- [ ] Every 4xx/5xx response has `code` and `request_id`.
- [ ] Characterisation tests from S0 still pass unchanged.

### Rollback
Revert the branch. No data touched.

### Risk
A missed `os.getenv` in a rarely-run path (e.g. `bootstrap_admin.py`,
`seed_academic_data.py`, `scripts/migrate_private_storage.py`). Grep those explicitly.

---

# Sprint 2 — One async database layer

> Today: two engines, two pools, one database. The async one has **zero** users.

**Goal:** Delete the sync engine. One session, one transaction per request.

**Depends on:** S1

### DB
No schema change. This is pure application plumbing.

### Backend

**1. `backend/app/core/db.py`**

```python
from collections.abc import AsyncIterator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.config import get_settings

def _async_url(url: str) -> str:
    for prefix, driver in (("postgresql+psycopg://", "postgresql+asyncpg://"),
                           ("postgresql://",         "postgresql+asyncpg://")):
        if url.startswith(prefix):
            return driver + url.removeprefix(prefix)
    return url

engine = create_async_engine(
    _async_url(get_settings().database_url),
    pool_size=10, max_overflow=10, pool_pre_ping=True, pool_recycle=1800,
)
SessionFactory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def db_session() -> AsyncIterator[AsyncSession]:
    async with SessionFactory() as session:
        async with session.begin():        # commit on success, rollback on raise
            yield session
```

**2. Port every route.** This is mechanical, and the biggest single lift of the sprint.

**Exact size of the job:** 141 route declarations across 15 files, of which ~107 are
actually mounted (the other 34 are `admin_routes.py`'s unmounted decorators plus the shim
re-registrations that point at the same functions). There are **129 `SessionLocal()` call
sites** to remove. The pattern, repeated:

```python
# BEFORE
@router.get("/batches")
def get_batches(course_id: str = None, admin=Depends(require_admin)):
    db = SessionLocal()
    try:
        rows = db.query(SqlBatch).filter(SqlBatch.course_id == course_id).all()
        ...
    finally:
        db.close()

# AFTER
@router.get("/batches")
async def get_batches(course_id: str | None = None,
                      admin=Depends(require_admin),
                      db: AsyncSession = Depends(db_session)):
    rows = (await db.scalars(select(Batch).where(Batch.program_id == course_id))).all()
    ...
```

**Do it file by file, in this order** (smallest first, so you build confidence):

| Order | File | Routes |
|---|---|---|
| 1 | `institution_routes.py` | 1 |
| 2 | `admin_settings.py` | 3 |
| 3 | `auth_routes.py` | 3 |
| 4 | `notification_routes.py` | 4 |
| 5 | `admin/academic_sessions.py` | 4 |
| 6 | `admin/session_rollover.py` | 4 |
| 7 | `admin/departments.py` | 4 |
| 8 | `user_routes.py` | 10 |
| 9 | `admin/users.py` | 12 |
| 10 | `admin_routes.py` | 30 |
| 11 | `assignment_routes.py` | 50 |

`admin/batches|courses|sections|subjects.py` need no work — they are shims with no bodies.
Porting `admin_routes.py` (step 10) ports them by definition.

Commit after each file. Run the characterisation tests after each file.

**3. Watch for these three traps:**

- **Lazy loading breaks.** `assignment.rubric` on an async session raises
  `MissingGreenlet`. Fix with explicit loading:
  `select(Assignment).options(selectinload(Assignment.rubric))`.
- **Services open their own sessions.** `auth_store.py`, `settings_store.py`,
  `session_service.py`, `github_repository_service.py` all call `SessionLocal()`
  internally. They must now **accept a session as an argument**:
  `def write_audit_log(db, actor_id, action, ...)`.
- **The lifespan scheduler and the RQ worker** are outside a request. Give them their own
  helper: `async with SessionFactory() as db: ...`. They are removed entirely in S14.

**4. Alembic keeps a sync engine.** That is the only allowed exception — set it in
`migrations/env.py`, not in app code.

**5. Delete** from `models/database.py`: `engine`, `SessionLocal`, `init_database`,
`is_database_available`. Replace the health check with a real `SELECT 1` on the async
engine.

### Frontend
None. This sprint must be invisible.

### Done when

- [ ] `grep -rn "SessionLocal" backend --include="*.py" | grep -v __pycache__` returns
      nothing outside `migrations/`.
- [ ] `SELECT count(*) FROM pg_stat_activity WHERE datname='campusgrade_db'` shows **one**
      pool's worth of connections under load, not two.
- [ ] A route that raises halfway leaves **no** partial rows (write a test for this — it
      is a real bug today).
- [ ] All characterisation tests pass with identical response bodies.

### Rollback
Revert the branch. Because there is no schema change, rollback is instant.

### Risk
**This is the highest-effort sprint.** 90 routes. Budget the full week, do not add scope.
If you run out of time, ship the files you finished — the two engines can coexist for one
more week without harm.

---

# Sprint 3 — Policy engine in shadow mode

**Goal:** Build `Principal`, the permission matrix and query scoping. Run them **beside**
the old checks and log disagreements. Change nothing yet.

**Depends on:** S2

### DB
None.

### Backend

**1. `backend/app/core/principal.py`**

```python
from dataclasses import dataclass
from enum import StrEnum

class Role(StrEnum):
    SUPER_ADMIN = "super_admin"
    PROGRAM_ADMIN = "program_admin"
    TEACHER = "teacher"
    STUDENT = "student"

ALL_PROGRAMS = frozenset({"*"})

@dataclass(frozen=True, slots=True)
class Principal:
    user_id: str
    role: Role
    status: str
    session_id: str | None
    program_ids: frozenset[str]      # ALL_PROGRAMS for super_admin
    offering_ids: frozenset[str]     # teachers
    must_change_password: bool

    @property
    def is_super(self) -> bool:
        return self.role is Role.SUPER_ADMIN
```

Built once per request, in **one query with joins** — replacing today's
`get_user_by_id()` which opens its own session on every single request:

```python
async def build_principal(request: Request,
                          db: AsyncSession = Depends(db_session)) -> Principal:
    payload = decode_access_token(request)          # raises Unauthenticated
    row = await db.execute(
        select(User)
        .options(selectinload(User.program_scopes), selectinload(User.offerings))
        .where(User.id == payload["user_id"]))
    ...
```

**2. `backend/app/core/policy.py`** — the matrix as data.

```python
class Permission(StrEnum):
    SESSION_MANAGE   = "session.manage"
    ROLLOVER_EXECUTE = "rollover.execute"
    PROGRAM_MANAGE   = "program.manage"
    ADMIN_MANAGE     = "admin.manage"
    SETTINGS_MANAGE  = "settings.manage"
    BATCH_MANAGE     = "batch.manage"
    SECTION_MANAGE   = "section.manage"
    SUBJECT_MANAGE   = "subject.manage"
    OFFERING_MANAGE  = "offering.manage"
    USER_MANAGE      = "user.manage"
    ASSIGNMENT_CREATE= "assignment.create"
    ASSIGNMENT_GRADE = "assignment.grade"
    GRADE_PUBLISH    = "grade.publish"
    INTEGRITY_REVIEW = "integrity.review"
    AI_EVALUATE      = "ai.evaluate"
    SUBMISSION_CREATE= "submission.create"
    REPORT_VIEW      = "report.view"
    AUDIT_VIEW       = "audit.view"

S, P, T, U = Role.SUPER_ADMIN, Role.PROGRAM_ADMIN, Role.TEACHER, Role.STUDENT

PERMISSIONS: dict[Permission, frozenset[Role]] = {
    Permission.SESSION_MANAGE:    frozenset({S}),
    Permission.ROLLOVER_EXECUTE:  frozenset({S}),
    Permission.PROGRAM_MANAGE:    frozenset({S}),
    Permission.ADMIN_MANAGE:      frozenset({S}),
    Permission.SETTINGS_MANAGE:   frozenset({S}),
    Permission.BATCH_MANAGE:      frozenset({S, P}),
    Permission.SECTION_MANAGE:    frozenset({S, P}),
    Permission.SUBJECT_MANAGE:    frozenset({S, P}),
    Permission.OFFERING_MANAGE:   frozenset({S, P}),
    Permission.USER_MANAGE:       frozenset({S, P}),
    Permission.ASSIGNMENT_CREATE: frozenset({T}),
    Permission.ASSIGNMENT_GRADE:  frozenset({T}),
    Permission.GRADE_PUBLISH:     frozenset({T}),
    Permission.INTEGRITY_REVIEW:  frozenset({S, P, T}),
    Permission.AI_EVALUATE:       frozenset({T}),
    Permission.SUBMISSION_CREATE: frozenset({U}),
    Permission.REPORT_VIEW:       frozenset({S, P, T, U}),
    Permission.AUDIT_VIEW:        frozenset({S, P}),
}

def require(permission: Permission):
    async def dep(principal: Principal = Depends(build_principal)) -> Principal:
        if principal.role not in PERMISSIONS[permission]:
            raise Forbidden(f"This action needs: {permission}")
        return principal
    return dep
```

**3. `backend/app/core/scoping.py`** — scope applied in SQL, so an out-of-scope row can
never be returned even if a route forgets to check.

```python
def scope_to_programs(stmt, principal: Principal, program_col):
    if principal.is_super:
        return stmt
    if principal.role is Role.PROGRAM_ADMIN:
        return stmt.where(program_col.in_(principal.program_ids))
    raise Forbidden("program scope")

def scope_to_offerings(stmt, principal: Principal, offering_col):
    if principal.is_super:
        return stmt
    if principal.role is Role.TEACHER:
        return stmt.where(offering_col.in_(principal.offering_ids))
    if principal.role is Role.PROGRAM_ADMIN:
        return stmt.where(offering_col.in_(select(Offering.id).join(...)
                          .where(Program.id.in_(principal.program_ids))))
    raise Forbidden("offering scope")
```

**4. Shadow mode.** Add a dependency that computes *both* answers and logs mismatches,
without changing the outcome:

```python
async def shadow_check(permission, principal, legacy_allowed: bool):
    new_allowed = principal.role in PERMISSIONS[permission]
    if new_allowed != legacy_allowed:
        logger.warning("policy_mismatch", extra={
            "permission": permission, "role": principal.role,
            "legacy": legacy_allowed, "new": new_allowed,
            "path": request.url.path})
    return legacy_allowed          # legacy still decides
```

Run staging for the rest of the sprint. **Zero mismatches** is the exit condition.

**5. The authorization matrix test** — the most valuable test in the codebase.

```python
# backend/tests/test_authorization_matrix.py
@pytest.mark.parametrize("route", ALL_ROUTES)          # from app.routes
@pytest.mark.parametrize("role", list(Role))
async def test_every_route_enforces_a_permission(client, route, role):
    perm = route_permission(route)
    assert perm is not None, f"{route.path} declares no permission"
    resp = await call_as(client, role, route)
    expected_allowed = role in PERMISSIONS[perm]
    assert (resp.status_code != 403) == expected_allowed
```

This fails on any route added later without a permission. That is the point.

### Frontend
None yet. `src/lib/permissions.ts` is written in S7.

### Done when

- [ ] `Principal` is built with **one** DB round trip (assert query count in a test).
- [ ] Authorization matrix test exists and passes for the current 3 roles.
- [ ] 48 hours on staging with **zero** `policy_mismatch` log lines.
- [ ] `scoping.py` has unit tests proving a scoped admin's query has the `IN (...)` clause.

### Rollback
Shadow mode changes no outcome. Delete the dependency.

### Risk
Mismatches will show up, and each one is a real authorization bug you have today. Do not
"fix" them by loosening the matrix. Investigate each.

---

# Sprint 4 — Split the identity tables

**Goal:** Break the 30-column `users` god table into `users` + three profile tables +
scopes. Keep old columns alive (expand phase).

**Depends on:** S3

### DB — migration `canvasgrade_021`

```python
def upgrade():
    op.create_table("user_profiles",
        sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("full_name", sa.Text, nullable=False),
        sa.Column("phone", sa.Text),
        sa.Column("avatar_key", sa.Text),
        sa.Column("bio", sa.Text),
        sa.Column("github_username", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()))

    op.create_table("student_profiles",
        sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("roll_no", sa.Text, nullable=False, unique=True),
        sa.Column("program_id", sa.String(64), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("admission_year", sa.Integer, nullable=False),
        sa.Column("enrollment_status", sa.Text, nullable=False, server_default="active"))

    op.create_table("teacher_profiles",
        sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("employee_code", sa.Text, nullable=False, unique=True),
        sa.Column("designation", sa.Text))

    op.create_table("admin_program_scopes",
        sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("program_id", sa.String(64), sa.ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True))

    # ---- backfill, in SQL, inside the same transaction ----
    op.execute("""
      INSERT INTO user_profiles (user_id, full_name, phone, avatar_key, bio, github_username)
      SELECT id, name, contact_number, avatar, bio, github_username FROM users
    """)
    op.execute("""
      INSERT INTO student_profiles (user_id, roll_no, program_id, admission_year, enrollment_status)
      SELECT u.id, u.roll_no, u.course_id,
             COALESCE(b.start_year, EXTRACT(YEAR FROM u.created_at)::int), 'active'
      FROM users u LEFT JOIN batches b ON b.id = u.batch_id
      WHERE u.role = 'student' AND u.roll_no IS NOT NULL AND u.course_id IS NOT NULL
    """)
    op.execute("""
      INSERT INTO teacher_profiles (user_id, employee_code, designation)
      SELECT id, COALESCE(teacher_id, 'T-' || substr(id, 1, 8)), designation
      FROM users WHERE role = 'teacher'
    """)
```

**Before you run this**, find the rows that will not backfill:

```sql
-- students that will be skipped — fix them first
SELECT id, email, roll_no, course_id FROM users
WHERE role='student' AND (roll_no IS NULL OR course_id IS NULL);

-- duplicate roll numbers — the unique constraint will fail
SELECT roll_no, count(*) FROM users WHERE role='student'
GROUP BY roll_no HAVING count(*) > 1;
```

Write the fix-ups as a separate data migration **before** `canvasgrade_021`.

**Old columns stay.** They are dropped in Sprint 10's contract migration.

### Backend

1. New ORM models in `app/domain/identity/models.py`. `User` keeps only auth fields;
   profiles are `relationship(uselist=False)`.
2. **Dual-write.** Every place that writes a user must write both old columns and the new
   profile row, for this sprint only. Centralise this in
   `identity/service.py::upsert_user()` so there is exactly one place to delete later.
3. **Delete `models/auth_store.py`.** `build_principal` now reads the ORM directly. Any
   route still doing `user.get("...")` on a dict gets ported to `Principal`.
4. Swap bcrypt → argon2id with rehash-on-login:

   ```python
   from argon2 import PasswordHasher
   from argon2.exceptions import VerifyMismatchError
   ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)

   def verify_and_maybe_rehash(stored: str, plain: str) -> tuple[bool, str | None]:
       if stored.startswith("$argon2"):
           try:
               ph.verify(stored, plain)
               return True, (ph.hash(plain) if ph.check_needs_rehash(stored) else None)
           except VerifyMismatchError:
               return False, None
       if bcrypt.checkpw(plain.encode(), stored.encode()):   # legacy
           return True, ph.hash(plain)                        # upgrade on the spot
       return False, None
   ```

5. **Fix the predictable initial password.** `_generate_teacher_password` returns
   `firstname@last2digits` of the phone; the student version uses the roll number. Any
   classmate can guess these. Delete both. Use `_generate_temporary_password()` —
   already written, already strong — for every new account.

### Frontend

Profile page (`src/app/(dashboard)/profile/page.tsx`, 861 lines) reads fields that now
live in profile tables. The API response shape does not change this sprint (the service
assembles it), so **no frontend change is required**. Verify with the S0 snapshot test.

### Done when

- [ ] `models/auth_store.py` is deleted.
- [ ] Every user row has a `user_profiles` row (`SELECT count(*)` matches).
- [ ] Logging in with an old bcrypt password works and silently upgrades the hash.
- [ ] New accounts get a random temporary password, never `name@digits`.
- [ ] Snapshot tests show identical API responses.

### Rollback
`alembic downgrade -1` drops the four new tables. Old columns are untouched and still
authoritative, so the app keeps working.

### Risk
Duplicate roll numbers and NULL `course_id` will block the backfill. **Run the two audit
queries above on production data in week 1 of this sprint**, not on the day you migrate.

---

# Sprint 5 — Four roles go live

**Goal:** `super_admin` and `program_admin` exist and are enforced. Shadow mode off.

**Depends on:** S4

### DB — migration `canvasgrade_022`

```python
def upgrade():
    # Postgres enums are painful to alter; role is String(20) today, so this is easy.
    op.execute("UPDATE users SET role = 'super_admin' WHERE role = 'admin'")
    op.create_check_constraint(
        "ck_users_role", "users",
        "role IN ('super_admin','program_admin','teacher','student')")

def downgrade():
    op.drop_constraint("ck_users_role", "users")
    op.execute("UPDATE users SET role = 'admin' WHERE role IN ('super_admin','program_admin')")
```

> Every existing admin becomes a **super admin**. That is deliberate — nobody loses
> access on deploy day. Demote to `program_admin` by hand afterwards.

### Backend

1. Turn off shadow mode. `require(Permission.X)` now decides.
2. Replace `require_admin` and `require_roles("admin")` everywhere.
   `grep -rn "require_admin\|require_roles" backend` — **92 hits**. Work through them
   file by file; each one becomes a `require(Permission.X)`.
3. Apply `scope_to_programs()` to every list query a `program_admin` can reach: batches,
   sections, subjects, students, teachers, assignments, reports, audit.
4. New endpoints in `identity/router.py`:
   - `GET /admin/admins` — list admins + their scopes (super only)
   - `POST /admin/admins` — create a program admin with scopes
   - `PUT /admin/admins/{id}/scopes` — replace scopes
5. **Continuity guard.** Today `_assert_admin_continuity` stops you deleting the last
   admin. Port it: the system must always have ≥1 active `super_admin`. Add a test that
   tries to delete/demote the last one and expects 409.

### Frontend

1. `src/lib/session.ts` — widen the type:

   ```ts
   role: "super_admin" | "program_admin" | "teacher" | "student";
   ```

   This will produce compile errors everywhere `role === "admin"` is checked. **That is
   the feature** — TypeScript is showing you every place that needs a decision.
   `grep -rn '"admin"' frontend/src` — **40 hits**, each one a deliberate choice about
   whether it means super admin, program admin, or both.

2. `src/lib/labels.ts` — add display names: "Super Admin", "Program Admin".
3. `src/lib/navigation.ts` — split the `admin` nav into two role entries per the
   navigation table in `ARCHITECTURE.md` §7.5. Program admin loses: Programs, Academic
   Sessions, Session Rollover, Settings.
4. New screen `src/app/(dashboard)/platform/admins/page.tsx` — super admin only. List
   admins, create one, tick which programs they manage.

### Done when

- [ ] Authorization matrix test passes for all **four** roles × all routes.
- [ ] A `program_admin` scoped to "B.Tech CSE" gets an empty list on `/admin/batches` for
      BCA — verified by an integration test that asserts on **SQL**, not just status code.
- [ ] Deleting the last active super admin returns 409.
- [ ] `grep -rn '"admin"' frontend/src` returns nothing.

### Rollback
`alembic downgrade -1` puts everyone back to `admin`. Re-enable shadow mode by feature
flag if a mismatch appears in production.

### Risk
The scope filter is easy to forget on a query. Mitigation: make the repository layer take
`Principal` as a **required** argument, so an unscoped query is a type error, not an
oversight.

---

# Sprint 6 — Cookie session, CSRF, middleware

**Goal:** Move the access token out of `localStorage`. Unlock Next.js middleware and
server components.

**Depends on:** S5

### DB — migration `canvasgrade_023`

```python
op.create_table("auth_sessions",
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    sa.Column("token_hash", sa.Text, nullable=False, unique=True),
    sa.Column("user_agent", sa.Text),
    sa.Column("ip_hash", sa.Text),
    sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("last_used_at", sa.DateTime(timezone=True)),
    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("revoked_at", sa.DateTime(timezone=True)))
op.create_index("ix_auth_sessions_user", "auth_sessions", ["user_id", "revoked_at"])
```

Migrate rows from the existing refresh-token store, then drop it in S10.

### Backend

1. `/login` sets **two** httpOnly cookies:

   | Cookie | Life | Path | Contents |
   |---|---|---|---|
   | `cg_access` | 15 min | `/` | signed JWT |
   | `cg_refresh` | 14 days | `/auth` | opaque token, hashed in DB |

   Both: `httponly=True`, `secure=settings.cookie_secure`, `samesite="lax"`.

2. **CSRF** — double submit. Set a readable `cg_csrf` cookie (not httpOnly). Require
   header `X-CSRF-Token` to match on every `POST/PUT/PATCH/DELETE`. Middleware:

   ```python
   @app.middleware("http")
   async def csrf(request: Request, call_next):
       if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
           cookie = request.cookies.get("cg_csrf", "")
           header = request.headers.get("X-CSRF-Token", "")
           if not cookie or not secrets.compare_digest(cookie, header):
               raise Forbidden("CSRF check failed")
       return await call_next(request)
   ```

   Exempt `/login` and `/auth/refresh` (they mint the token).

3. **Accept both** for one sprint: read the token from the cookie **or** the
   `Authorization` header. This lets the old frontend keep working while the new one
   lands. Remove header support in S10.

4. `GET /auth/me` — returns the `Principal` as JSON. The frontend uses this instead of
   decoding a JWT client-side.

5. `GET /auth/sessions` + `DELETE /auth/sessions/{id}` — the user can see and kill their
   own devices.

### Frontend

1. **`frontend/middleware.ts`** — real, server-side route protection:

   ```ts
   import { NextResponse, type NextRequest } from "next/server";
   import { jwtVerify } from "jose";

   const RULES: [RegExp, string[]][] = [
     [/^\/platform/,   ["super_admin"]],
     [/^\/admin/,      ["super_admin", "program_admin"]],
     [/^\/grading/,    ["teacher"]],
     [/^\/assignments/,["super_admin","program_admin","teacher","student"]],
   ];

   export async function middleware(req: NextRequest) {
     const token = req.cookies.get("cg_access")?.value;
     if (!token) return NextResponse.redirect(new URL("/login", req.url));
     try {
       const { payload } = await jwtVerify(token, SECRET);
       const rule = RULES.find(([re]) => re.test(req.nextUrl.pathname));
       if (rule && !rule[1].includes(payload.role as string)) {
         return NextResponse.redirect(new URL("/dashboard", req.url));
       }
     } catch {
       return NextResponse.redirect(new URL("/login?session=expired", req.url));
     }
     return NextResponse.next();
   }

   export const config = { matcher: ["/((?!login|_next|favicon.ico).*)"] };
   ```

2. `src/lib/api.ts`: remove the `Authorization` header interceptor, add
   `withCredentials: true` (already set) and the CSRF header:

   ```ts
   api.interceptors.request.use((config) => {
     if (!["get","head","options"].includes(config.method ?? "get")) {
       config.headers["X-CSRF-Token"] = readCookie("cg_csrf") ?? "";
     }
     return config;
   });
   ```

3. **Delete** `src/components/AuthGate.tsx` and the token half of `src/lib/session.ts`.
   Keep a small `useSession()` hook backed by `GET /auth/me` + TanStack Query.

4. `src/server/session.ts` — read the cookie in server components:

   ```ts
   import { cookies } from "next/headers";
   export async function getServerSession() {
     const token = (await cookies()).get("cg_access")?.value;
     return token ? await verify(token) : null;
   }
   ```

### Done when

- [ ] `localStorage` contains no token. There are 15 `localStorage` uses today — after
      this sprint the auth ones are gone and only non-auth uses (remembered filters,
      selected academic session) remain.
- [ ] Hitting `/admin/students` as a student redirects **before** the page renders (check
      the network tab: a 307, not a client-side bounce).
- [ ] A `POST` without `X-CSRF-Token` returns 403.
- [ ] Playwright login test passes for all four roles.

### Rollback
Feature flag `AUTH_COOKIE_MODE=false` falls back to header auth. Keep the flag for two
sprints.

### Risk
Cookie domain and `secure` in production. Test on the real hostname over HTTPS in staging
before deploy day. `SameSite=Lax` blocks cookies on cross-site POSTs — fine here because
frontend and API share an origin through the Next rewrite.

---

# Sprint 7 — Frontend shell rebuild

**Goal:** Chrome mounts once. Feature folders exist. Every later frontend change lands in
a sane structure.

**Depends on:** S6. Frontend-led — can run parallel with backend S8.

### DB / Backend
None.

### Frontend

**1. Fix the layout.** Today `(dashboard)/layout.tsx` only wraps `AuthGate`, so **21 of
31 pages import and render `DashboardLayout` themselves**. Sidebar and notifications are
destroyed and refetched on every navigation.

```
app/
  (app)/
    layout.tsx        ← DashboardLayout content moves HERE. Mounts once.
    dashboard/page.tsx
    assignments/...
    admin/...
    platform/...
```

Then strip the wrapper from all 21 pages:

```tsx
// BEFORE
export default function Page() {
  return <DashboardLayout><Content /></DashboardLayout>;
}
// AFTER
export default function Page() {
  return <Content />;
}
```

Delete `src/layouts/`.

**2. Feature folders.** Create the structure, move files, no logic changes:

```
src/features/
  auth/        academics/   people/      assignments/
  grading/     integrity/   ai/          reporting/
```

Each gets `api.ts`, `queries.ts`, `components/`, `schema.ts`, `types.ts`.

**3. Split `src/lib/api.ts`.** It has **108 exported functions** in one file. Move them
into the feature `api.ts` files. Keep `src/lib/http.ts` as the shared axios instance.

**4. Typed client.** Use the generated types from S0:

```ts
import type { paths } from "@/types/api";
type BatchList = paths["/admin/batches"]["get"]["responses"]["200"]["content"]["application/json"];

export const listBatches = (params: BatchQuery) =>
  http.get<BatchList>("/admin/batches", { params }).then(r => r.data);
```

**5. Query layer.** One `queries.ts` per feature, keys centralised:

```ts
export const academicsKeys = {
  all: ["academics"] as const,
  batches: (q: BatchQuery) => [...academicsKeys.all, "batches", q] as const,
};

export const useBatches = (q: BatchQuery) =>
  useQuery({ queryKey: academicsKeys.batches(q), queryFn: () => listBatches(q) });
```

**6. Break up the giants.** Four files must come under 300 lines:

| File | Now | Split into |
|---|---|---|
| `AssignmentDashboardView.tsx` | 1,335 | `features/assignments/components/` — list, filters, card, empty, summary |
| `admin/students/page.tsx` | 1,315 | `features/people/components/` — table, filters, create dialog, import dialog, bulk bar |
| `admin/teachers/page.tsx` | 990 | same shape as students |
| `CreateAssignmentView.tsx` | 880 | brief step, rubric step, targeting step, schedule step, AI panel |

**7. `src/lib/permissions.ts`** — mirror the backend matrix for UI only:

```ts
// UI convenience ONLY. The server is the authority. Never rely on this for security.
export const can = (role: Role, p: Permission) => PERMISSIONS[p].includes(role);
```

**8. Shared states.** Every list gets a real loading skeleton, empty state and error state
with retry. Put them in `components/ui/`.

### Done when

- [ ] No page file over 150 lines; no component over 300.
- [ ] `grep -rn "layouts/DashboardLayout" frontend/src` returns nothing.
- [ ] Navigating between two admin pages does **not** refetch notifications (check the
      network tab).
- [ ] `src/lib/api.ts` no longer exists; every call is typed against `api.d.ts`.
- [ ] Lighthouse: first contentful paint improves on the dashboard.

### Rollback
Pure frontend. Revert the branch.

### Risk
Big diff, easy to lose a behaviour by accident. Mitigation: move files **first** with zero
edits and get CI green; split components in a **second** commit.

---

# Sprint 8 — Programs rename, departments removed

**Goal:** Table `courses` becomes `programs`. `departments` and `institutions` are gone.

**Depends on:** S5

### DB — migration `canvasgrade_024`

```python
def upgrade():
    op.rename_table("courses", "programs")
    op.execute("ALTER INDEX uq_courses_department_name RENAME TO uq_programs_name")
    # FK columns keep their names for now; renaming them is a separate, later step.

    # departments: prove it is single-row before dropping
    op.execute("""
      DO $$ BEGIN
        IF (SELECT count(*) FROM departments) > 1 THEN
          RAISE EXCEPTION 'More than one department exists — review before dropping';
        END IF;
      END $$;
    """)
    op.drop_constraint("fk_courses_department", "programs", type_="foreignkey")
    op.drop_column("programs", "department_id")
    op.drop_constraint("fk_subjects_department", "subjects", type_="foreignkey")
    op.drop_column("subjects", "department_id")
    op.drop_table("departments")
    op.drop_table("institutions")

def downgrade():
    # Recreates the SOET row. Data in dropped columns is not recoverable —
    # it was a single constant value, so nothing real is lost.
    ...
```

Then, migration `canvasgrade_025` (contract, next sprint): rename FK columns
`course_id` → `program_id` across `users`, `batches`, `sections`, `subjects`,
`assignments`.

### Backend

1. Delete `_seed_soet_department()` from `app.py` lifespan and
   `_get_or_create_soet_department` from `admin_routes.py`.
2. Delete `routes_fastapi/institution_routes.py` and `models/institution.py`.
3. Delete `routes_fastapi/admin/departments.py` **and** the duplicate department CRUD in
   `admin_routes.py` (lines ~1503–1633).
4. Add `SOET` as a constant in `config.py` for display only:
   `DEPARTMENT_NAME = "School of Engineering and Technology"`.
5. **Delete the fuzzy matching.** `admin/departments.py` counts students by alias
   matching free-text names. With real FKs the count is:
   `select(func.count()).select_from(StudentProfile).where(StudentProfile.program_id == pid)`.

### Frontend

1. Delete the Departments screen and its nav entry.
2. Rename UI strings: nothing to do — the UI already says "Programs".
3. Update `features/academics/` types after regenerating `api.d.ts`.
4. Remove `department` from the student/teacher create and import forms.

### Done when

- [ ] `grep -rni "department" backend --include="*.py" | grep -v __pycache__` returns only
      the display constant.
- [ ] `\d programs` in psql shows the renamed table; `departments` does not exist.
- [ ] Student counts per program come from a `COUNT(*)`, and match the old fuzzy count on
      staging data (compare before/after — investigate any difference, it is a real bug
      being revealed).

### Rollback
`alembic downgrade -1` renames back and recreates the SOET row.

### Risk
The pre-check raises if more than one department row exists. Run
`SELECT * FROM departments;` on production **before** the sprint.

---

# Sprint 9 — `subject_offerings` ⚠ RISKIEST SPRINT

> One row will replace: a JSON blob, a mirror table, and three columns on `assignments`.
> Budget the whole week. Do not add scope. Do not deploy on a Friday.

**Goal:** One table answers "which teacher teaches which subject, to which section, in
which session".

**Depends on:** S8

### DB — migration `canvasgrade_026` (expand only)

```python
op.create_table("subject_offerings",
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("session_id", sa.String(64), sa.ForeignKey("academic_sessions.id"), nullable=False),
    sa.Column("subject_id", sa.String(64), sa.ForeignKey("subjects.id"), nullable=False),
    sa.Column("section_id", sa.String(64), sa.ForeignKey("sections.id"), nullable=False),
    sa.Column("teacher_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
    sa.Column("state", sa.Text, nullable=False, server_default="running"),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.UniqueConstraint("session_id", "subject_id", "section_id", name="uq_offering"))
op.create_index("ix_offering_teacher_session", "subject_offerings", ["teacher_id", "session_id"])

op.create_table("enrollments",
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("offering_id", sa.String(64), sa.ForeignKey("subject_offerings.id", ondelete="CASCADE"), nullable=False),
    sa.Column("student_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    sa.Column("state", sa.Text, nullable=False, server_default="enrolled"),
    sa.UniqueConstraint("offering_id", "student_id", name="uq_enrollment"))

op.add_column("assignments", sa.Column("offering_id", sa.String(64),
              sa.ForeignKey("subject_offerings.id"), nullable=True))   # nullable for now
```

### The backfill — do this as a **script, not a migration**

Three sources disagree today. You need a human to look at the disagreements before you
commit to one answer.

`backend/scripts/backfill_offerings.py`, with `--dry-run` as the default:

```python
"""
Sources, in priority order:
  1. teacher_session_allocations  (session-aware, newest)
  2. users.assignments JSON       (what the UI actually reads today)
  3. assignments.target_* triple  (what was really used in practice)

Writes a CSV report of every conflict. Applies nothing unless --apply is passed.
"""
```

**Step by step:**

1. **Day 1 — measure.** Run with `--dry-run` against a production copy. Produce:

   ```
   offerings_to_create.csv     teacher_id, subject_id, section_id, session_id, source
   conflicts.csv               same (subject, section, session) claimed by 2+ teachers
   orphans.csv                 allocations pointing at deleted subjects/sections/users
   assignments_unmapped.csv    assignments whose target triple matches no offering
   ```

2. **Day 2 — review with a human.** Sit with whoever runs the department. Resolve every
   row in `conflicts.csv`. Expect surprises: teachers who left, sections that merged.

3. **Day 3 — fix the sources.** Correct bad rows in the *old* structures first, so the
   backfill is deterministic. Re-run the dry run until `conflicts.csv` is empty.

4. **Day 4 — apply on staging.** `--apply`. Then run the verification queries:

   ```sql
   -- every teacher allocation became an offering
   SELECT count(*) FROM teacher_session_allocations tsa
   WHERE NOT EXISTS (SELECT 1 FROM subject_offerings o
                     WHERE o.teacher_id = tsa.teacher_id AND o.session_id = tsa.session_id);
   -- expect 0

   -- every assignment maps to an offering
   SELECT count(*) FROM assignments WHERE offering_id IS NULL;
   -- expect 0

   -- no teacher lost a class
   SELECT u.id, jsonb_array_length(u.assignments::jsonb) AS old_count,
          (SELECT count(*) FROM subject_offerings o WHERE o.teacher_id = u.id) AS new_count
   FROM users u WHERE u.role = 'teacher'
   HAVING jsonb_array_length(u.assignments::jsonb) <> ...;
   ```

5. **Day 5 — apply on production**, inside a maintenance window, with a fresh backup
   taken first.

### Backend

1. `app/domain/academics/offerings/` — full CRUD, scoped to programs.
2. **Switch reads.** Teacher authorization becomes a join instead of a JSON scan:

   ```python
   # BEFORE — scan a JSON blob
   for allocation in teacher.get("assignments") or []:
       if allocation["section_id"] == assignment.target_section_id: ...

   # AFTER
   stmt = select(Offering).where(Offering.id == assignment.offering_id,
                                 Offering.teacher_id == principal.user_id)
   ```

3. Keep dual-write to `users.assignments` for **one** sprint so a rollback is possible.
4. Create the `v_offering_context` view (see `ARCHITECTURE.md` §4.10) and use it for all
   scoping joins.

### Frontend

1. Teacher allocation screen (`admin/teachers/page.tsx`) now edits offerings, not a JSON
   blob. This is the biggest UI change in the sprint: a row per offering, with add/remove,
   instead of a nested array editor.
2. `CreateAssignmentView.tsx` — the targeting step becomes a single "which class?"
   dropdown of the teacher's offerings, replacing the program → batch → section → subject
   cascade. **This is a real UX win**: 4 dropdowns become 1.
3. `GET /assignments/teacher-tools/targets` now returns offerings.

### Done when

- [ ] `conflicts.csv` is empty on production data.
- [ ] `SELECT count(*) FROM assignments WHERE offering_id IS NULL` → 0.
- [ ] Every teacher sees exactly the same classes as before (compare screenshots).
- [ ] Teacher authorization does no JSON parsing (`grep -rn 'get("assignments")' backend`
      → nothing).

### Rollback
The old JSON blob and mirror table are still written and still correct. Revert the
application code; the data is intact. **This is why dual-write matters — do not skip it.**

### Risk
The highest in the plan. Mitigations, all mandatory:
- dry-run first, human review of conflicts
- dual-write for one sprint
- fresh backup before the production run
- a maintenance window, announced
- do not combine with any other change

---

# Sprint 10 — Retire `admin_routes.py`

**Goal:** Delete the 2,606-line god file and the fake `admin/` shim package. Contract the
old columns.

**Depends on:** S9

### DB — migration `canvasgrade_027` (contract)

Only now, one sprint after the expand, is it safe to drop:

```python
op.drop_column("users", "assignments")        # JSON blob
op.drop_column("users", "achievements")
op.drop_column("users", "github_repositories")
op.drop_column("users", "leetcode_username")
op.drop_column("users", "course")             # free text
op.drop_column("users", "batch")              # free text
op.drop_column("users", "department")         # free text
op.drop_column("users", "year")
op.drop_column("users", "semester")
op.drop_column("users", "teacher_id")         # now teacher_profiles.employee_code
op.drop_column("users", "roll_no")            # now student_profiles.roll_no
op.drop_column("users", "designation")
op.drop_column("users", "bio")
op.drop_column("users", "avatar")
op.drop_column("users", "contact_number")
op.drop_column("users", "github_username")
op.drop_table("teacher_session_allocations")  # replaced by subject_offerings
```

**Before dropping**, copy each column into `_backup_users_legacy_20260900` so a mistake is
recoverable for one term:

```sql
CREATE TABLE _backup_users_legacy_20260900 AS
SELECT id, assignments, course, batch, department, year, semester,
       roll_no, teacher_id, designation FROM users;
```

Also rename FK columns now (deferred from S8):
`users.course_id` → `program_id`, `batches.course_id` → `program_id`,
`sections.course_id` → dropped (reachable via batch), `subjects.course_id` → `program_id`.

### Backend

Split 2,606 lines into:

```
app/domain/academics/
  programs/    router.py service.py repository.py schemas.py
  sessions/    …
  batches/     …
  sections/    …
  subjects/    …
  offerings/   …
  rollover/    …
app/domain/identity/
  users/       …
  admins/      …
  imports/     …   ← the CSV/Excel import logic, ~200 lines of admin_routes
  profiles/    …
```

Then:

```bash
rm backend/routes_fastapi/admin_routes.py
rm -r backend/routes_fastapi/admin/
```

**Remember:** `admin_routes.py` decorated 30 endpoints on a router that was **never
mounted**. Only 28 were re-registered by the shims. Before deleting, diff the two lists —
the 2 unreachable endpoints are either dead features or a bug where someone thought a
route existed.

```bash
grep -o '@router\.\w*("[^"]*"' backend/routes_fastapi/admin_routes.py | sort > /tmp/decorated
grep -o 'add_api_route("[^"]*"'  backend/routes_fastapi/admin/*.py     | sort > /tmp/mounted
diff /tmp/decorated /tmp/mounted
```

Also remove header-based auth (the S6 compatibility path) and the `AUTH_COOKIE_MODE` flag.

### Frontend

Regenerate `api.d.ts`. Paths stay the same (`/admin/batches` etc.), so the change should
be types-only. If a path must change, keep the old one as a 308 redirect for one release.

### Done when

- [ ] `admin_routes.py` and `routes_fastapi/admin/` do not exist.
- [ ] No backend file exceeds 400 lines.
- [ ] `\d users` shows ~12 columns, not 30+.
- [ ] Backup table exists and row count matches `users`.

### Rollback
Restore columns from `_backup_users_legacy_20260900`. Keep that table for one full term,
then drop it in a dated ticket.

### Risk
Something you did not know was reading a dropped column — a script, a report, the seed
file. `grep -rn "\.assignments\|\.roll_no\|\.course\b" backend/` including
`seed_academic_data.py`, `bootstrap_admin.py` and `scripts/`.

---

# Sprint 11 — Assignments domain and state machine

**Goal:** Split assignment CRUD out of the 1,921-line router. Replace 11 timestamp
columns with one state machine plus an event log.

**Depends on:** S10

### DB — migration `canvasgrade_028`

```python
op.create_table("assignment_state_events",
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("assignment_id", sa.String(64), sa.ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False),
    sa.Column("from_state", sa.Text),
    sa.Column("to_state", sa.Text, nullable=False),
    sa.Column("actor_id", sa.String(64), sa.ForeignKey("users.id", ondelete="SET NULL")),
    sa.Column("reason", sa.Text),
    sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
op.create_index("ix_ase_assignment", "assignment_state_events", ["assignment_id", "occurred_at"])

op.add_column("assignments", sa.Column("state", sa.Text, nullable=False, server_default="draft"))
op.add_column("assignments", sa.Column("submission_kind", sa.Text, nullable=False, server_default="repository"))
op.add_column("assignments", sa.Column("late_policy", sa.Text, nullable=False, server_default="none"))
```

Backfill `state` from the existing timestamps, then seed one event per assignment from
the historical timestamps so no history is lost. Drop the 11 columns in S12's contract
migration.

Also convert all `DateTime` to `DateTime(timezone=True)`. Today they are naive UTC — the
cause of the `20260722_09_normalize_assignment_schedule_utc` class of bug:

```python
op.execute("ALTER TABLE assignments ALTER COLUMN due_at TYPE timestamptz USING due_at AT TIME ZONE 'UTC'")
```

### Backend

`app/domain/assignments/`:

```
router.py          # ~180 lines: CRUD + state transitions
service.py         # business rules
repository.py      # queries, all scoped by offering
state_machine.py   # the transition table
schemas.py
models.py
```

`state_machine.py` — explicit, testable:

```python
TRANSITIONS: dict[State, set[State]] = {
    State.DRAFT:      {State.SCHEDULED, State.ARCHIVED},
    State.SCHEDULED:  {State.OPEN, State.DRAFT, State.ARCHIVED},
    State.OPEN:       {State.CLOSED},
    State.CLOSED:     {State.EVALUATING, State.OPEN},      # reopen with a reason
    State.EVALUATING: {State.PUBLISHED, State.CLOSED},
    State.PUBLISHED:  {State.ARCHIVED},
    State.ARCHIVED:   set(),
}

def transition(assignment, to: State, actor: Principal, reason: str | None = None):
    if to not in TRANSITIONS[assignment.state]:
        raise Conflict(f"Cannot go from {assignment.state} to {to}")
    ...  # writes assignment_state_events
```

Rules to enforce in the service:

- Submissions accepted only in `OPEN`, or `CLOSED` when `late_policy != none`.
- Rubric is **frozen** once any grade exists. Today this is caught late, by comparing a
  `rubric_digest` at AI-import time. Catch it at edit time instead.
- Publishing results requires every participant to have a grade in `ready` or a
  `is_missing` marker.

### Frontend

1. `features/assignments/` — the state machine drives which buttons show. Replace
   scattered `if (assignment.due_at < now)` checks with `assignment.state`.
2. Show a **timeline** on the assignment page, built from `assignment_state_events`. Free
   feature: teachers can see exactly when results were published and by whom.
3. `CreateAssignmentView` split completes (started in S7).

### Done when

- [ ] `assignments.state` matches what the old timestamp logic computed, for every row on
      staging (write a comparison script).
- [ ] Every transition writes an event row.
- [ ] Editing a rubric after a grade exists returns 409.
- [ ] All datetime columns are `timestamptz`.

### Rollback
The 11 old columns are still present until S12. Revert code; data is intact.

### Risk
Timezone conversion. `AT TIME ZONE 'UTC'` assumes the naive values really are UTC. Verify
on a sample before running: pick 5 assignments, check `due_at` against what the UI showed.

---

# Sprint 12 — Submissions and repository split

**Goal:** Get the 12 repository columns out of `submissions`. Make a non-repo submission
kind possible.

**Depends on:** S11

### DB — migration `canvasgrade_029`

```python
op.create_table("repository_links",
    sa.Column("submission_id", sa.String(64), sa.ForeignKey("assignment_submissions.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("provider", sa.Text, nullable=False, server_default="github"),
    sa.Column("owner", sa.Text, nullable=False),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("default_branch", sa.Text),
    sa.Column("url", sa.Text, nullable=False),
    sa.Column("generation", sa.Integer, nullable=False, server_default="1"),
    sa.Column("sync_state", sa.Text, nullable=False, server_default="idle"),
    sa.Column("latest_remote_sha", sa.Text),
    sa.Column("last_checked_at", sa.DateTime(timezone=True)),
    sa.Column("next_check_at", sa.DateTime(timezone=True)),
    sa.Column("error_message", sa.Text),
    sa.Column("failure_count", sa.Integer, nullable=False, server_default="0"))

op.create_table("repository_snapshots",
    sa.Column("version_id", sa.String(64), sa.ForeignKey("assignment_submission_versions.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("commit_sha", sa.Text, nullable=False),
    sa.Column("commit_message", sa.Text),
    sa.Column("commit_at", sa.DateTime(timezone=True)),
    sa.Column("file_count", sa.Integer),
    sa.Column("total_bytes", sa.BigInteger),
    sa.Column("language_stats", postgresql.JSONB),
    sa.Column("readme_md", sa.Text),
    sa.Column("analysis_state", sa.Text, nullable=False, server_default="queued"),
    sa.Column("analysis_error", sa.Text))
```

Backfill from the existing columns, then drop them in S13's contract migration — along
with the 11 assignment columns deferred from S11.

### Backend

```
app/domain/submissions/
  router.py           # student submit, teacher view
  service.py
  repository.py
  providers/
    base.py           # RepositoryProvider Protocol
    github.py         # moved from services/github_repository_service.py (605 lines)
```

The provider port:

```python
class RepositoryProvider(Protocol):
    async def head(self, owner: str, name: str, branch: str) -> CommitRef: ...
    async def archive(self, owner: str, name: str, ref: str) -> bytes: ...
```

Hardening while you are in here:

- Enforce `github_max_archive_bytes` **before** extraction, not after (zip-bomb defence).
- Cap extracted file count and per-file size.
- Reject path traversal in archive entries (`../`).
- Keep the existing `SECRET_PATTERNS` redaction — it is good, just move it into
  `providers/github.py`.

### Frontend

`features/submissions/` — the student submit flow and the teacher's repository browser.
The submission-kind field means the UI can later show a file upload; build the switch now
even if only `repository` is implemented.

### Done when

- [ ] `assignment_submissions` has no repository columns.
- [ ] A 200 MB repository is rejected before extraction (test with a crafted archive).
- [ ] An archive containing `../../etc/passwd` is rejected.
- [ ] Repository browsing still works for existing submissions.

### Rollback
Old columns still present. Revert code.

### Risk
`github_repository_service.py` is 605 lines and central. Move it in one commit with no
edits, refactor in a second.

---

# Sprint 13 — Grading and per-criterion scores

**Goal:** Get `rubric_scores` out of JSON and into rows, so rubric analytics is a query.

**Depends on:** S12

### DB — migration `canvasgrade_030`

```python
op.create_table("grade_criterion_scores",
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("grade_id", sa.String(64), sa.ForeignKey("assignment_grades.id", ondelete="CASCADE"), nullable=False),
    sa.Column("criterion_id", sa.String(64), sa.ForeignKey("assignment_rubric_criteria.id", ondelete="RESTRICT"), nullable=False),
    sa.Column("awarded", sa.Numeric(6, 2), nullable=False),
    sa.Column("strengths_note", sa.Text),
    sa.Column("gaps_note", sa.Text),
    sa.UniqueConstraint("grade_id", "criterion_id", name="uq_grade_criterion"))
```

Backfill by expanding the JSON:

```sql
INSERT INTO grade_criterion_scores (id, grade_id, criterion_id, awarded)
SELECT gen_random_uuid()::text, g.id, kv.key, kv.value::numeric
FROM assignment_grades g,
     LATERAL jsonb_each_text(g.rubric_scores::jsonb) AS kv
WHERE g.rubric_scores IS NOT NULL AND g.rubric_scores::text <> '{}';
```

Add a check so totals can never silently disagree:

```sql
-- run as a nightly data-quality job, not a constraint (floating point)
SELECT g.id FROM assignment_grades g
JOIN grade_criterion_scores s ON s.grade_id = g.id
GROUP BY g.id, g.total_awarded
HAVING abs(sum(s.awarded) - g.total_awarded) > 0.01;
```

Contract migration in the same sprint (safe — the 11 assignment columns and 12 submission
columns have now been unused for two sprints):

```python
op.drop_column("assignments", "submission_locked_at")     # …and the other 10
op.drop_column("assignment_submissions", "repository_url")# …and the other 11
op.drop_column("assignment_grades", "rubric_scores")      # after backfill verified
```

### Backend

```
app/domain/grading/
  router.py        # grade CRUD, publish, withdraw, gradebook export
  service.py       # mark validation, publish rules
  repository.py
  gradebook.py     # CSV/XLSX export
```

Rules:

- `awarded` must be `0 <= awarded <= criterion.max_marks`. Enforce in the service, not the
  route.
- `total_awarded` is **computed** from the criterion rows, never accepted from the client.
- Publishing writes a `grade_revisions` snapshot.
- Withdrawing requires a reason and notifies the student.

New analytics that become trivial:

```sql
-- average score per criterion for a class
SELECT c.title, avg(s.awarded), c.max_marks
FROM grade_criterion_scores s
JOIN assignment_rubric_criteria c ON c.id = s.criterion_id
WHERE c.assignment_id = :id
GROUP BY c.id, c.title, c.max_marks ORDER BY c.position;
```

### Frontend

1. `features/grading/` — the grading screen
   (`assignments/[id]/review/page.tsx`, 693 lines) splits into roster, marking panel,
   rubric editor, feedback panel.
2. New: **per-criterion class chart** on the assignment page. "Everyone lost marks on
   criterion 3" is the single most useful thing a teacher can learn, and it is now one
   query away.
3. Student result view shows per-criterion strengths and gaps, not one blob of feedback.

### Done when

- [ ] `assignment_grades.rubric_scores` is dropped.
- [ ] Sum of criterion rows equals `total_awarded` for every grade (nightly check green).
- [ ] The per-criterion chart renders for a real assignment.
- [ ] Gradebook CSV export matches the old export byte-for-byte on the same data.

### Rollback
Keep `rubric_scores` for one extra sprint if you are nervous — move the drop to S14.

### Risk
Grades are the most sensitive data in the app. Take a dedicated backup of
`assignment_grades` before this migration, separate from the normal nightly.

---

# Sprint 14 — Jobs table and worker

**Goal:** One job runtime. Delete the in-process scheduler, `BackgroundTasks` fallbacks,
Redis and RQ. The API becomes stateless.

**Depends on:** S10 (can run parallel with S11–S13)

### DB — migration `canvasgrade_031`

```python
op.create_table("jobs",
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("payload", postgresql.JSONB, nullable=False, server_default="{}"),
    sa.Column("state", sa.Text, nullable=False, server_default="ready"),   # ready|running|done|failed|dead
    sa.Column("run_after", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
    sa.Column("max_attempts", sa.Integer, nullable=False, server_default="5"),
    sa.Column("locked_by", sa.Text),
    sa.Column("locked_until", sa.DateTime(timezone=True)),
    sa.Column("dedupe_key", sa.Text),
    sa.Column("last_error", sa.Text),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("completed_at", sa.DateTime(timezone=True)))
op.create_index("ix_jobs_claim", "jobs", ["state", "run_after"])
op.create_index("ix_jobs_dedupe", "jobs", ["dedupe_key"], unique=True,
                postgresql_where=sa.text("state IN ('ready','running')"))
```

### Backend

**1. Transactional enqueue.** The job is inserted in the *same transaction* as the change
that caused it. A rolled-back request never leaves a stray job; a committed one never
loses it.

```python
async def enqueue(db, kind: str, payload: dict, *, run_after=None, dedupe_key=None):
    db.add(Job(id=uuid7(), kind=kind, payload=payload,
               run_after=run_after or utcnow(), dedupe_key=dedupe_key))
    # no commit here — the request's transaction owns it
```

**2. The runner** — `app/workers/runner.py`, a separate process:

```python
async def claim(db, kinds: list[str], worker_id: str, limit: int = 5):
    rows = (await db.scalars(
        select(Job).where(Job.state == "ready", Job.run_after <= utcnow(),
                          Job.kind.in_(kinds))
                   .order_by(Job.run_after)
                   .limit(limit)
                   .with_for_update(skip_locked=True))).all()
    for job in rows:
        job.state, job.locked_by = "running", worker_id
        job.locked_until = utcnow() + timedelta(minutes=10)
    return rows
```

`SKIP LOCKED` means N workers never fight over the same job. Backoff on failure:
`run_after = now + 2^attempts minutes`, dead-letter at `max_attempts`.

**3. Job kinds** — one handler module each in `app/workers/handlers/`:

| Kind | Replaces | Schedule |
|---|---|---|
| `repo.sync` | `sync_due_repositories` | every 5 min, per submission |
| `repo.analyze` | RQ `analyze_repository_version` | on submit |
| `similarity.scan` | inline call | after analyze |
| `results.publish` | lifespan loop | every minute |
| `sessions.purge` | lifespan loop | hourly |
| `rollover.notice` | lifespan loop | daily |
| `ai.grade_batch` | new (S16) | on request |
| `notification.digest` | new | daily |

**4. Delete:**

- the `scheduler()` loop in `app.py` lifespan
- every `BackgroundTasks` fallback in `github_repository_service.py`
- `backend/assignment_worker.py`
- `backend/core/redis.py`
- `redis[hiredis]` and `rq` from `pyproject.toml`
- `REDIS_URL`, `REDIS_REQUIRED` from `.env.example`

**5. Prove statelessness.** Run **two** API replicas behind a load balancer in staging.
Nothing should double-fire, because scheduled work now lives in the runner, and the runner
uses `SKIP LOCKED`.

### Frontend

Small: a job status indicator on the assignment page ("Analysing 12 of 40 repositories").
Poll `GET /assignments/{id}/jobs/summary` every 5 s while any job is running.

### Done when

- [ ] `grep -rni "redis\|rq\b" backend --include="*.py" | grep -v __pycache__` → nothing.
- [ ] Two API replicas run for 24 h with no duplicate result publication.
- [ ] Killing the worker mid-job leaves the job reclaimable (test: kill -9, restart,
      job completes).
- [ ] A failed job retries with backoff and lands in `dead` after 5 attempts.

### Rollback
Keep the lifespan loop behind a flag `LEGACY_SCHEDULER=true` for one sprint. Do not run
both at once — you will double-publish results.

### Risk
Double-publishing results if the old loop and the new job both run. The `dedupe_key`
unique index is the safety net — use it on `results.publish`.

---

# Sprint 15 — AI gateway, ledger, pseudonymisation

**Goal:** All external AI goes through one module. Every call is recorded. **Student names
stop leaving the building.**

**Depends on:** S13

### DB — migration `canvasgrade_032`

```python
op.create_table("ai_runs",
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("purpose", sa.Text, nullable=False),
    sa.Column("assignment_id", sa.String(64), sa.ForeignKey("assignments.id", ondelete="SET NULL")),
    sa.Column("offering_id", sa.String(64), sa.ForeignKey("subject_offerings.id", ondelete="SET NULL")),
    sa.Column("requested_by", sa.String(64), sa.ForeignKey("users.id", ondelete="SET NULL")),
    sa.Column("provider", sa.Text, nullable=False),
    sa.Column("model", sa.Text),
    sa.Column("transport", sa.Text, nullable=False, server_default="api"),  # api | manual_export
    sa.Column("prompt_version", sa.Text, nullable=False),
    sa.Column("prompt_hash", sa.Text, nullable=False),
    sa.Column("request_payload_key", sa.Text),      # object storage, NOT the DB
    sa.Column("response_payload_key", sa.Text),
    sa.Column("status", sa.Text, nullable=False, server_default="pending"),
    sa.Column("latency_ms", sa.Integer),
    sa.Column("input_tokens", sa.Integer),
    sa.Column("output_tokens", sa.Integer),
    sa.Column("cost_micros", sa.BigInteger),
    sa.Column("error_code", sa.Text),
    sa.Column("error_message", sa.Text),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("completed_at", sa.DateTime(timezone=True)))
op.create_index("ix_ai_runs_requester", "ai_runs", ["requested_by", "created_at"])
```

### Backend

```
app/domain/aiservices/
  gateway.py
  providers/
    base.py  azure_openai.py  openai.py  anthropic.py  manual.py
  prompts/
    grade_batch.v3.md   draft_assignment.v2.md   draft_rubric.v1.md
  pseudonymiser.py
  validators.py
  runs.py
```

**1. The port.** No module outside this package may import a provider.

```python
class AiProvider(Protocol):
    name: str
    async def complete_json(self, system: str, user: str, *,
                            max_tokens: int, temperature: float) -> AiResponse: ...
```

**2. Pseudonymisation** — the security win of this sprint.

Today `render_prompt()` sends `student_name` and `roll_no` to the provider. It does not
need to.

```python
# pseudonymiser.py
def pseudonymise(students: list[Student]) -> tuple[list[dict], dict[str, str]]:
    alias_of = {s.id: f"S{i:03d}" for i, s in enumerate(students, 1)}
    safe = [{"student_id": alias_of[s.id],
             "submission_version_id": s.version_id} for s in students]
    return safe, alias_of

def resolve(response: dict, alias_of: dict[str, str]) -> dict:
    real_of = {v: k for k, v in alias_of.items()}
    for row in response["students"]:
        row["student_id"] = real_of[row["student_id"]]   # KeyError = reject the response
    return response
```

`alias_of` never leaves the process. Also strip names from `matched_student` in duplicate
evidence — send `S007`, not "Priya Sharma".

**3. Prompt injection defence.** Student repositories are attacker-controlled.

```python
fence = secrets.token_hex(8)         # per run, unguessable
block = f"<<<REPO-{fence}>>>\n{content}\n<<<END-REPO-{fence}>>>"
```

The system prompt says: text inside a fence is **data**, never instructions. Content
cannot close a fence it cannot guess. Record any stripped injection phrases in
`ai_runs.request_payload_key`.

**But output validation is the real defence.** Move `_validate_external_result` (currently
inline in `assignment_routes.py`) into `validators.py` and cover it with tests for:

| Case | Expected |
|---|---|
| missing student | reject |
| extra student | reject |
| duplicate student | reject |
| `awarded > max_marks` | reject |
| `awarded < 0` | reject |
| total ≠ sum | reject |
| unknown criterion id | reject |
| rubric changed since export | 409 |
| submission changed since export | 409 |
| alias not in map | reject |
| markdown fences around JSON | accept (strip them) |
| prose before JSON | accept (extract) |

**4. Delete** `backend/ai/assignment_ai.py` and the three private cross-module imports in
`assignment_routes.py` line 38.

### Frontend

`features/ai/` — a run history panel. The teacher can see: what was sent (purpose, not
content), when, which model, how long, what it cost, and whether it succeeded.

### Done when

- [ ] `grep -rn "azure\|openai\|anthropic" backend --include="*.py" -i | grep -v aiservices/`
      returns nothing.
- [ ] No student name or roll number appears in any captured request payload (assert it
      in a test with a real student fixture).
- [ ] Every AI call creates an `ai_runs` row, success or failure.
- [ ] All 12 validator cases have a passing test.

### Rollback
Feature flag `AI_GATEWAY=false` falls back to the old path for one sprint. Keep
`ai/assignment_ai.py` on disk (unimported) until the flag is removed.

### Risk
Alias mapping bugs would attach marks to the wrong student — the worst possible failure.
Mitigation: `resolve()` raises on any unknown alias, and the count of returned students
must exactly equal the count sent. Both are already partly enforced; make them absolute.

---

# Sprint 16 — AI proposals, budgets, dual transport

**Goal:** AI output becomes a **proposal** a teacher accepts. Spending is capped. The
manual copy-paste path becomes a transport, not a separate code path.

**Depends on:** S15

### DB — migration `canvasgrade_033`

```python
op.create_table("ai_grade_proposals",
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("run_id", sa.String(64), sa.ForeignKey("ai_runs.id", ondelete="CASCADE"), nullable=False),
    sa.Column("assignment_id", sa.String(64), sa.ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False),
    sa.Column("student_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    sa.Column("version_id", sa.String(64), sa.ForeignKey("assignment_submission_versions.id", ondelete="SET NULL")),
    sa.Column("proposed_total", sa.Numeric(6, 2), nullable=False),
    sa.Column("confidence", sa.Numeric(4, 3)),
    sa.Column("needs_review", postgresql.ARRAY(sa.Text)),
    sa.Column("state", sa.Text, nullable=False, server_default="proposed"),  # proposed|accepted|edited|rejected
    sa.Column("decided_by", sa.String(64), sa.ForeignKey("users.id", ondelete="SET NULL")),
    sa.Column("decided_at", sa.DateTime(timezone=True)),
    sa.UniqueConstraint("run_id", "student_id", name="uq_proposal_student"))

op.create_table("ai_grade_proposal_scores",
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("proposal_id", sa.String(64), sa.ForeignKey("ai_grade_proposals.id", ondelete="CASCADE"), nullable=False),
    sa.Column("criterion_id", sa.String(64), sa.ForeignKey("assignment_rubric_criteria.id"), nullable=False),
    sa.Column("awarded", sa.Numeric(6, 2), nullable=False),
    sa.Column("strengths_note", sa.Text),
    sa.Column("gaps_note", sa.Text))

op.create_table("ai_budgets",
    sa.Column("scope_type", sa.Text, primary_key=True),   # global | program | user
    sa.Column("scope_id", sa.String(64), primary_key=True),
    sa.Column("window", sa.Text, primary_key=True),       # day | month
    sa.Column("max_runs", sa.Integer),
    sa.Column("max_cost_micros", sa.BigInteger))
```

Migrate any rows from `assignment_ai_suggestions` into proposals, then drop that table.

### Backend

**1. The one-way door.** There is exactly one function that turns AI output into a grade:

```python
async def accept_proposal(db, principal: Principal, proposal_id: str,
                          edits: dict[str, Decimal] | None = None) -> Grade:
    require_permission(principal, Permission.ASSIGNMENT_GRADE)
    proposal = await get_proposal(db, proposal_id)
    assert_owns_offering(principal, proposal.assignment)

    grade = await upsert_grade(db, ..., source="ai_assisted", ai_run_id=proposal.run_id)
    proposal.state = "edited" if edits else "accepted"
    proposal.decided_by, proposal.decided_at = principal.user_id, utcnow()
    await audit.record(db, principal, "grade.accepted_from_ai", grade.id,
                       {"run_id": proposal.run_id, "edited": bool(edits)})
    return grade
```

No other path exists. Write a test that greps for one: any INSERT into `grades` with
`source='ai_assisted'` outside this function is a bug.

**2. Budgets.** Checked before the call, recorded after:

```python
async def assert_within_budget(db, principal, purpose):
    used = await runs_today(db, principal.user_id)
    cap = settings.ai_max_runs_per_teacher_per_day
    if used >= cap:
        raise RateLimited(f"You have used your {cap} AI evaluations for today")
```

Without this, one teacher clicking "evaluate all" on 300 submissions burns a month's
budget in ten minutes.

**3. Dual transport, one pipeline.**

```
build request → pseudonymise → ledger row
      ├── transport=api            → provider.complete_json()
      └── transport=manual_export  → teacher copies prompt, pastes JSON back
                                        ↓
              validate → resolve aliases → proposals → teacher accepts → grades
```

Same prompt builder. Same validator. Same proposal table. Same ledger. The manual path
exists because university networks sometimes block the provider — keep it, but stop it
being a second implementation.

### Frontend

1. **Proposal review screen** — the most important new UI. Side by side: AI proposed marks
   vs the teacher's marks, per criterion, with the AI's strengths/gaps notes. Buttons:
   accept all, accept one, edit, reject.
2. Never auto-fill the grade form. The teacher must click.
3. Show `confidence` and `needs_review` flags prominently.
4. `BulkExternalEvaluationDialog.tsx` (404 lines) is rewritten against the new endpoints,
   with a transport switch (API / manual).
5. Budget indicator: "12 of 40 evaluations used today".

### Done when

- [ ] No code path writes a grade from AI output except `accept_proposal`.
- [ ] Every AI-assisted grade has `source='ai_assisted'` and a resolvable `run_id`.
- [ ] Exceeding the daily cap returns 429 with a clear message.
- [ ] Both transports produce identical proposals from the same submission set (test it).
- [ ] `assignment_ai_suggestions` is dropped.

### Rollback
Proposals are additive — they do not touch `grades` until accepted. Turning the feature
off leaves grading fully manual and working.

### Risk
Teachers may click "accept all" without reading. That is a policy problem, not a code
one — but surface `confidence` and `needs_review` loudly, and record who accepted what.

---

# Sprint 17 — Integrity domain

**Goal:** Similarity detection out of the assignment router, with a proper review
workflow.

**Depends on:** S13

### DB — migration `canvasgrade_034`

```python
op.create_table("similarity_pairs",
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("assignment_id", sa.String(64), sa.ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False),
    sa.Column("left_version_id", sa.String(64), sa.ForeignKey("assignment_submission_versions.id", ondelete="CASCADE"), nullable=False),
    sa.Column("right_version_id", sa.String(64), sa.ForeignKey("assignment_submission_versions.id", ondelete="CASCADE"), nullable=False),
    sa.Column("method", sa.Text, nullable=False),
    sa.Column("score", sa.Numeric(4, 3), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.CheckConstraint("left_version_id < right_version_id", name="ck_pair_ordered"),
    sa.UniqueConstraint("assignment_id", "left_version_id", "right_version_id", "method",
                        name="uq_similarity_pair"))

op.create_table("similarity_reviews",
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("pair_id", sa.String(64), sa.ForeignKey("similarity_pairs.id", ondelete="CASCADE"), nullable=False, unique=True),
    sa.Column("decision", sa.Text, nullable=False, server_default="pending"),
    sa.Column("reviewed_by", sa.String(64), sa.ForeignKey("users.id", ondelete="SET NULL")),
    sa.Column("reviewed_at", sa.DateTime(timezone=True)),
    sa.Column("notes", sa.Text))
```

The `CHECK (left < right)` constraint removes today's ability to store (A,B) and (B,A) as
two separate flags. **Before migrating**, deduplicate:

```sql
-- find mirrored duplicates in the current table
SELECT a.id, b.id FROM assignment_duplicate_flags a
JOIN assignment_duplicate_flags b
  ON a.left_version_id = b.right_version_id
 AND a.right_version_id = b.left_version_id
 AND a.flag_type = b.flag_type;
```

### Backend

```
app/domain/integrity/
  router.py
  service.py
  detectors/
    exact.py         # same repo, same commit, identical digest
    fingerprint.py   # code similarity (moved from github_repository_service)
```

- Detection runs as a `similarity.scan` job (from S14), not inline on a web request.
- Keep the existing automatic rule — code similarity above 70% caps marks at 50% of total
  — but move it into `integrity/service.py` and make it configurable per assignment
  instead of hardcoded in a prompt string.
- Review decisions are auditable: who dismissed a flag, when, why.

### Frontend

`features/integrity/` — a review queue. Side-by-side file diff for a flagged pair, with
the matched student's identity shown only to those who may see it (a teacher sees their
own class; a program admin sees their programs read-only).

### Done when

- [ ] No mirrored duplicate pairs exist (constraint enforces it).
- [ ] Similarity runs in a job, not on the request thread.
- [ ] The 70% cap is configurable and covered by a test.
- [ ] Review decisions appear in the audit log.

### Rollback
Old `assignment_duplicate_flags` stays until S18. Revert code.

### Risk
Deduplication may reveal that some pairs were double-counted, changing similarity
statistics. Expect the numbers to move slightly; that is a correction, not a regression.

---

# Sprint 18 — Reporting and role dashboards

**Goal:** Each of the four roles gets a landing screen that answers their actual question.

**Depends on:** S14, S13

### DB — migration `canvasgrade_035`

Materialised views for the expensive aggregates, refreshed by a job:

```sql
CREATE MATERIALIZED VIEW mv_assignment_stats AS
SELECT a.id AS assignment_id, a.offering_id,
       count(DISTINCT e.student_id)                        AS eligible,
       count(DISTINCT s.student_id)                        AS submitted,
       count(DISTINCT g.student_id) FILTER (WHERE g.state='published') AS published,
       avg(g.total_awarded) FILTER (WHERE g.state='published')          AS avg_mark
FROM assignments a
JOIN subject_offerings o ON o.id = a.offering_id
JOIN enrollments e       ON e.offering_id = o.id
LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.student_id = e.student_id
LEFT JOIN assignment_grades g      ON g.assignment_id = a.id AND g.student_id = e.student_id
GROUP BY a.id, a.offering_id;

CREATE UNIQUE INDEX ON mv_assignment_stats (assignment_id);
```

Refreshed `CONCURRENTLY` by a `reports.refresh` job every 10 minutes.

### Backend

`app/domain/reporting/` — every query goes through `scope_to_programs` or
`scope_to_offerings`, so a report cannot leak across scope.

| Role | Endpoint | Answers |
|---|---|---|
| Super admin | `/reports/platform` | Which programs are behind on grading? What is AI spend by program? |
| Program admin | `/reports/program` | Which teachers have overdue evaluations in my programs? |
| Teacher | `/reports/teaching` | Which of my classes has ungraded work? Where did the class lose marks? |
| Student | `/reports/progress` | My marks over time, per subject, versus the class median |

Exports: CSV and XLSX, generated in a job for anything over 1,000 rows, delivered as a
signed download link.

### Frontend

1. Four dashboards, one per role, replacing the current generic `/dashboard`.
2. Recharts is already a dependency — use it. Per-criterion bars, submission-rate lines,
   grading-backlog counts.
3. **Server components** for first paint: the dashboard renders with real numbers before
   any JavaScript loads. This is only possible because of S6.

### Done when

- [ ] Each role's dashboard loads in under 300 ms p95.
- [ ] A program admin's report contains zero rows from another program (test asserts on
      SQL).
- [ ] Materialised views refresh without blocking reads (`CONCURRENTLY`).
- [ ] Student "versus class median" never reveals another student's identity.

### Rollback
Views are additive. Drop them; the app falls back to live queries.

### Risk
Materialised views go stale. Show "as of HH:MM" on every dashboard so nobody is confused
by a 10-minute lag.

---

# Sprint 19 — Hardening and launch

**Goal:** Prove it holds under load, prove it can be restored, prove it cannot be broken
into.

**Depends on:** everything

### Load test

`k6` or `locust`, at **2× expected peak**. Realistic peak for SOET: assignment deadline
day, 400 students submitting within one hour, 40 teachers grading.

| Scenario | Target |
|---|---|
| 400 concurrent students loading their dashboard | p95 < 300 ms |
| 200 repository submissions in 10 minutes | all analysed within 30 min |
| 40 teachers opening a 60-student gradebook | p95 < 800 ms |
| AI batch of 10 students × 20 teachers | queue drains, no timeout |

Fix what you find. Common results: missing index on `enrollments(offering_id)`, N+1 on the
gradebook, unbounded page size.

### Backup and restore drill

Do it for real, on a copy:

1. `pg_dump` nightly + WAL archiving to object storage.
2. Restore last night's dump to a fresh database.
3. Point staging at it. Log in. Check an assignment, a grade, a repository archive.
4. Write down how long it took. That number is your RTO.
5. Repeat every term. Put it in the calendar.

### Security review

Checklist, each item either passing or ticketed:

- [ ] Authorization matrix test covers 100% of routes × 4 roles.
- [ ] No endpoint returns another user's data without a scope filter (review every
      `select()` that lacks a `scope_to_*` call).
- [ ] Upload: size cap, type allowlist, extension/content-type match, path traversal
      rejected, zip bomb rejected.
- [ ] Prompt injection: fenced blocks, output validation, alias resolution — all tested.
- [ ] Secrets: `gitleaks` on the full history. Rotate anything found. Rotate `SECRET_KEY`
      before launch (this logs everyone out — do it on a quiet day).
- [ ] Rate limits: login 10/min/IP, AI 20/hr/teacher, uploads 50/hr/user.
- [ ] Dependencies: `pip-audit` and `npm audit` clean of highs.
- [ ] Headers: HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy` (some exist —
      add CSP).
- [ ] Logs contain no PII, no tokens, no repository content.
- [ ] Private storage URLs are signed and short-lived; no public bucket.

### Observability

- Structured JSON logs shipped somewhere searchable.
- Metrics: request rate, error rate, p95 latency, job queue depth, job failure rate,
  AI spend per day, DB pool saturation.
- Alerts, with an owner for each: error rate > 1% for 5 min; queue depth > 500;
  any `dead` job; AI spend > 80% of monthly cap; disk > 80%.
- `/health` (liveness, cheap) and `/ready` (dependencies) already exist — keep them, add
  the job runner's heartbeat to `/ready`.

### Runbook

`docs/RUNBOOK.md`, written so someone who is not you can follow it at 2 a.m.:

deploy · rollback a release · roll back a migration · restore from backup · rotate
`SECRET_KEY` · rotate the AI key · drain and restart workers · unstick a dead job ·
what to do when the AI provider is down · who to call.

### Documentation

- Rewrite `CLAUDE.md` to match the new architecture. It is currently wrong in at least
  one place: it says `backend/alembic/` is a stale leftover, but that directory does not
  exist.
- Archive `MIGRATION_PLAN.md`, `PLAN_CAMPUSGRADE_CHANGES.md` and
  `PLAN_ACADEMIC_SESSIONS_AND_BATCHES.md` into `docs/history/`. They describe a system
  that no longer exists.
- `docs/ONBOARDING.md`: clone → run → make a change → ship it, in under an hour.

### Done when

- [ ] Load test passes at 2× peak with no errors.
- [ ] A restore drill completed and the RTO is written down.
- [ ] Security checklist has zero open highs.
- [ ] Alerts fire correctly in a deliberate test.
- [ ] A new developer follows `ONBOARDING.md` and ships a change on day one.

### Rollback
Nothing to roll back — this sprint changes no behaviour. The one exception is the
`SECRET_KEY` rotation, which logs every user out. Announce it, do it on a quiet day, and
keep the old key available for 15 minutes so in-flight access tokens finish cleanly.

### Risk
The load test will find something. It always does. Leave two spare days in the week for
the fixes it turns up — if you plan this sprint at 100% capacity you will ship the
findings as tickets instead of fixes, and they will never get done.

---

## Summary table

| # | Sprint | DB | BE | FE | Risk |
|---|---|---|---|---|---|
| 0 | Guardrails and baseline | — | ●●● | ●● | low |
| 1 | Config, errors, logging | — | ●●● | ● | low |
| 2 | One async DB layer | — | ●●●● | — | **med** |
| 3 | Policy engine (shadow) | — | ●●● | — | low |
| 4 | Split identity tables | ●●● | ●●● | — | **med** |
| 5 | Four roles go live | ●● | ●●● | ●●● | **med** |
| 6 | Cookie session + CSRF | ●● | ●●● | ●●● | **med** |
| 7 | Frontend shell rebuild | — | — | ●●●● | low |
| 8 | Programs rename, drop dept | ●●● | ●● | ●● | low |
| 9 | `subject_offerings` | ●●●● | ●●● | ●●● | **HIGH** |
| 10 | Retire `admin_routes.py` | ●●● | ●●●● | ● | **med** |
| 11 | Assignments + state machine | ●●● | ●●● | ●● | med |
| 12 | Submissions + repo split | ●●● | ●●● | ●● | med |
| 13 | Grading + criterion scores | ●●● | ●●● | ●●● | **HIGH** |
| 14 | Jobs table + worker | ●● | ●●● | ● | med |
| 15 | AI gateway + ledger | ●● | ●●●● | ● | med |
| 16 | AI proposals + budgets | ●●● | ●●● | ●●● | med |
| 17 | Integrity domain | ●● | ●● | ●● | low |
| 18 | Reporting + dashboards | ●● | ●● | ●●● | low |
| 19 | Hardening and launch | — | ●● | ●● | low |

**Three sprints carry real danger:** 9 (offerings backfill), 13 (grade data), and 2
(volume of mechanical change). Give each of those its own week with nothing else in it,
take a fresh backup first, and do not deploy them on a Friday.

## If you only have time for four sprints

Do 0, 1, 2, 3 — in that order.

They add no features. They also stop the bleeding: you get a test net, one config, one
database layer, and an authorization model that new code can be built on. Everything after
that becomes cheaper. Skipping them means every later sprint pays the same tax again.
