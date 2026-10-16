# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project

CampusGrade: an assignment, repository-analysis, and grading platform. FastAPI + PostgreSQL backend, Next.js (App Router, TypeScript, Tailwind CSS v4, TanStack Query) frontend in `frontend/`. The old Vite/React frontend (`frontend-legacy/`) has been removed after cutover; see `MIGRATION_PLAN.md` for the migration history.

## Commands

### Backend (run from `backend/`, or point tools at `backend/`)

- Install deps: `uv sync` (uv reads `pyproject.toml`/`uv.lock` at repo root; `.venv` also lives at repo root)
- Run dev server: `cd backend && python app.py` (set `FASTAPI_RELOAD=true` for autoreload) or `uvicorn app:app --reload`
- Run all tests: `uv run pytest backend/tests` (from repo root) — tests import backend modules directly (`from app import ...`), so pytest must resolve `backend/` onto `sys.path`; running from repo root against `backend/tests` works because of the package layout
- Run a single test: `uv run pytest backend/tests/test_security.py::PasswordSecurityTests::test_rejects_predictable_jwt_secrets`
- DB migrations (Alembic, config lives in `backend/alembic.ini`, scripts in `backend/migrations/`, not `backend/alembic/` which is a stale leftover): `cd backend && alembic upgrade head`, create one with `alembic revision -m "description"`
- Required env vars are documented in `backend/.env.example` (`SECRET_KEY` must be >=32 chars and not a common/weak value, `DATABASE_URL`, `ALLOWED_ORIGINS`, Azure OpenAI settings, private storage backend settings)

### Frontend (run from `frontend/`)

- Install deps: `npm install`
- Dev server: `npm run dev` (Next.js on port 3000; `/api/*` is rewritten to the FastAPI backend at `BACKEND_ORIGIN`, default `http://127.0.0.1:5001` — see `next.config.ts`)
- Build: `npm run build`
- Lint: `npm run lint`
- No frontend test suite exists yet.

## Architecture

### Backend

- `app.py` is the FastAPI entrypoint (ASGI `app` object); `main.py` is a thin `python main.py` runner that re-execs into the project venv on Windows. Both just call `uvicorn.run("app:app", ...)`.
- App startup (`lifespan` in `app.py`) verifies the DB is reachable and its Alembic revision matches head, does a private-storage read/write health check, initializes Redis, and starts an in-process background loop that (a) auto-publishes assignment results whose release condition has been met and (b) periodically purges stale sessions. There is no separate worker process for this — it runs inside the API process's asyncio loop.
- Auth is JWT-based (`routes_fastapi/deps.py`): access tokens are short-lived, carry a `session_version` and `sid` (refresh-token session id) claim, and are validated against the user's current `session_version`/session-active state on every request — this is how server-side session revocation works despite stateless JWTs. `require_roles(...)` and `require_permission(...)` are the two authorization dependencies used on routes; roles are `admin`, `teacher`, `student`.
- Two SQLAlchemy database layers coexist: a sync `engine`/`SessionLocal` (used by most existing route/service code and by Alembic) and an async `async_engine`/`async_session_factory` (`get_db()`) that new code is meant to use going forward (see comment in `models/database.py`). `DATABASE_URL` uses the `postgresql+psycopg://` sync driver form; the async engine URL is derived automatically from it.
- Domain models live in `models/sql_models.py` (users, departments, courses, batches, sections, subjects, enrollments, audit log, app settings) and `models/assignment.py` (assignments, rubric criteria, resources, submissions + versions, grades + grade revisions, duplicate-similarity flags, announcements, discussion threads, AI suggestions). Non-ORM data-access helpers (`auth_store.py`, `settings_store.py`) sit alongside the ORM models for pieces not yet migrated to full SQLAlchemy models.
- `routes_fastapi/assignment_routes.py` is the largest and most central router (~1900 lines): assignment CRUD, submission handling (including GitHub-repository submissions), grading, duplicate/plagiarism similarity detection across submissions, discussions, and analytics all live here. `routes_fastapi/admin/` is a package of smaller per-resource routers (batches, courses, sections, subjects, departments, users) mounted under the `/admin` prefix in `app.py`; `routes_fastapi/admin_routes.py` and `routes_fastapi/admin_settings.py` are separate, older files (temporary-password generation, audit-log endpoints) — don't confuse the `admin/` package with `admin_routes.py`.
- GitHub-repository assignment submissions are their own subsystem: `services/github_repository_service.py` fetches/archives a submitted repo and computes code-similarity fingerprints (secrets are redacted via `SECRET_PATTERNS` before any content is stored or shown); `services/assignment_external_evaluation.py` builds the full-repository export (no size/token budget — every file is included, binary as base64) used to hand a submission to an external evaluator/AI grader.
- Private file storage (submission archives, uploaded documents) is abstracted behind `services/object_storage.py` (`PrivateObjectStorage` base class with `LocalPrivateObjectStorage` and `S3PrivateObjectStorage` implementations, selected by `PRIVATE_STORAGE_BACKEND`); `services/assignment_storage.py` builds on top of this for assignment-specific paths/keys.
- `ai/assignment_ai.py` handles document text extraction (PDF/DOCX/etc.) and calls Azure OpenAI (endpoint/deployment/key from env) for assignment-drafting assistance.
- Background scheduled work needing to run outside the API process (rather than the in-process lifespan loop) goes through Redis + RQ (`core/redis.py`, `assignment_worker.py`).

### Frontend

- Routing uses the Next.js App Router under `src/app/`. Authed pages live inside the `(dashboard)` route group and share `src/app/(dashboard)/layout.tsx` (ported from legacy's `DashboardLayout.jsx` — sidebar/nav/topbar chrome). Role gating is client-side: pages/components check the session user's role directly rather than a single central router guard, since the JWT only exists in `localStorage` (not visible during server rendering).
- Session state lives in `localStorage` (`campusgrade_token`, `campusgrade_user`), read/written via `src/lib/session.ts`. Not a global store — zustand is not used for auth here either.
- `src/lib/api.ts` is the single axios instance for all API calls, a straight TypeScript port of legacy's `services/api.js`: attaches the bearer token on every request, transparently calls `/auth/refresh` once on a 401 (de-duplicated via a shared `refreshPromise`) and retries the original request, and flattens FastAPI's `{"detail": ...}` error shape onto `error.response.data.message`.
- Data fetching goes through TanStack Query hooks in `src/hooks/` (e.g. `useAcademicStructure.ts`), wrapping the calls in `lib/api.ts` — this is new versus legacy, which had no query/cache layer.
- Some pages are shared client components rendered by multiple thin route `page.tsx` files with different props (e.g. `AssignmentDashboardView` with an `initialView` prop, `CreateAssignmentView` used by both `/assignments/create` and `/assignments/[id]/edit`) — this replicates legacy's single-component-multiple-routes pattern (`AssignmentDashboard initialView="..."` in `App.jsx`) under App Router.
- The external-AI grading workflow (prompt generation, proposal import, repo-bundle export, validate + save) is human-in-the-loop only — no internal embeddings/RAG. It's UI embedded in `CreateAssignmentView.tsx` and `BulkExternalEvaluationDialog.tsx`, calling `lib/api.ts` functions that hit `/assignments/teacher-tools/external-ai-*` and `/assignments/teacher/:id/external-evaluation/*`.
- In dev, `next.config.ts` rewrites `/api/*` to the FastAPI backend (`BACKEND_ORIGIN`, default `http://127.0.0.1:5001`) and redirects the old `/login/student` and `/login/teacher` paths to `/login`. The frontend's real API base URL is `NEXT_PUBLIC_API_URL` (defaults to `/api`).
- See `MIGRATION_PLAN.md` for the full Vite→Next.js migration history (the pre-migration `frontend-legacy/` app has been removed).

## Imported Claude Cowork project instructions

You have to help me to Build this App Production ready
