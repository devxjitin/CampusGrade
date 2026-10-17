# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CampusGrade: an assignment, repository-analysis, and grading platform for one institution. FastAPI + PostgreSQL backend, Next.js (App Router, TypeScript, Tailwind CSS v4, TanStack Query) frontend in `frontend/`, deployed as a Docker Compose stack. `PRD.md` holds the requirements, known issues and target architecture; `Sprint.md` is the delivery plan (check which sprint is current before starting work).

## Commands

### Fast local loop (use this while developing)

- `scripts\dev-local.ps1` runs Postgres in Docker (`compose.local.yaml` makes it reachable on `127.0.0.1:5433`) and the API (`uvicorn --reload`), worker and Next dev server as plain processes on the host. It is much faster than the Docker dev stack, which mounts the source into containers and proxies every request. App `http://localhost:3000`, API `http://localhost:5001`; files go to `.local\storage`, logs to `.local\logs`; `-Status` shows what is up, `-Stop` stops it. The worker does not auto-reload: restart the stack after changing worker or job code. It reuses the dev stack's database and stops the containerized api/web/worker, which would otherwise take the same ports.
- `scripts\check-local.ps1` runs what GitHub CI runs (the ruff file list is read from `ci.yml`, mypy, pytest, eslint, tsc, vitest, and the `api.d.ts` freshness check when the API is up). `-Quick` skips pytest, `-Build` adds `npm run build`. Push when it is green; GitHub CI is then a confirmation, not the first feedback.

### Whole stack (Docker Desktop)

- Dev (hot reload, no HTTPS): `scripts\init-secrets.ps1` once, then `docker compose -f compose.yaml -f compose.dev.yaml up --build` → app `http://localhost:3000`, API `http://localhost:5001`.
- Prod-like: `scripts\deploy.ps1 -Version <tag>` pulls images from GHCR, migrates, starts the stack behind Caddy at `https://campusgrade.localhost`, smoke-tests, and rolls back on failure. `-NoPull` deploys locally built images (tag them `ghcr.io/devxjitin/campusgrade-{api,web}:<tag>`).
- First admin: `scripts\bootstrap-admin.ps1`. Trust Caddy's local CA once: `scripts\trust-caddy-ca.ps1`.
- Compose files: `compose.yaml` (base), `compose.dev.yaml`, `compose.prod.yaml` (hardened, pinned images). Secrets are files in `secrets/` (git-ignored), mounted at `/run/secrets/*` and read by `backend/config.py`; never put secrets in env vars, images or committed files.

### Backend (from repo root)

- Install deps: `uv sync` (`pyproject.toml`/`uv.lock` at repo root, `.venv` at repo root)
- Run all tests: `uv run pytest backend/tests` (set `SECRET_KEY` to any ≥32-char non-trivial value). Tests import backend modules directly (`from app import ...`). Database-backed tests (`requires_docker`, the `database_url` fixture) start a throwaway Postgres via testcontainers, or use `TEST_DATABASE_URL=postgresql+psycopg://...` pointing at an empty disposable database (it is migrated for you). CI runs them on Linux; the Windows event loop prints noisy `proactor_events` errors, so for a CI-faithful run use a Linux container on the same Docker network as the test database.
- Single test: `uv run pytest backend/tests/test_readiness.py::test_ready_returns_200_when_database_and_storage_are_ready`
- Lint/types: `uv run ruff check <files>` (CI checks an explicit clean-file list, see `pyproject.toml`) and `uv run mypy`.
- Migrations (Alembic; config `backend/alembic.ini`, scripts `backend/migrations/`): `cd backend && alembic upgrade head`; new one: `alembic revision -m "description"`. In Docker they run as the one-shot `migrate` service, never in the API entrypoint. Migrations must be backward compatible with the previous app version (expand → migrate → contract).

### Frontend (from `frontend/`)

- `npm ci`, `npm run dev` (port 3000; `/api/*` is rewritten to `BACKEND_ORIGIN` in dev only), `npm run build`, `npm run lint`, `npx vitest run`, `npm run e2e` (Playwright; needs a running seeded stack, see `e2e/README.md`).
- `frontend/AGENTS.md` warns this Next.js version has breaking changes: read the guide in `node_modules/next/dist/docs/` before changing framework-level code. The request interceptor file is `src/proxy.ts` (this version's name for middleware).

## Architecture

### Request path (production)

Browser → Caddy (`docker/caddy/Caddyfile`: TLS, security headers) → `/api/*` to the `api` replicas (prefix stripped, so backend routes stay unprefixed, e.g. `/login`, `/ready`) and everything else to `web` (Next.js standalone). Postgres and the S3-compatible store (`storage`, RustFS) are only on the internal `backend` network. Server-side calls from Next.js to the API use `API_INTERNAL_URL` (`http://api:5001`).

### Backend

- `app.py` is the ASGI entrypoint; in containers it runs under gunicorn (`gunicorn.conf.py`, UvicornWorker). `GET /health` is liveness, `GET /ready` checks DB reachability, Alembic head and the storage check done at startup. The prod stack runs 2 `api` replicas behind Caddy (round-robin, health-checked on `/ready`) plus 1 `worker`.
- Background work runs in a separate `worker` service (`python -m worker`, same image as the API), never in the API process. It is built on the Postgres `jobs` table: `services/jobs.py` (transactional `enqueue`, claim with `FOR UPDATE SKIP LOCKED`, exponential backoff, `dead` after `max_attempts`, stale-lock recovery), handlers registered in `worker/handlers.py` (repository analysis is the `repository.analyze` job), and periodic tasks in `worker/periodic.py` (publish results, purge sessions, rollover notice, repo auto-sync, rate-limit purge) that run once per interval across any number of workers via a Postgres advisory lock. The worker touches a heartbeat file that its compose health check reads. Super Admins list and retry jobs at `/admin/jobs`. Redis and RQ are gone; do not add background work to the API process. Login/refresh rate limiting is a shared Postgres counter table (`services/rate_limiter.py`).
- Database access is async: `models/database.py` builds the async engine/`async_session_factory`; routes use `Depends(db_session)` from `core/db.py`. Some helpers still use sync Sessions through `db.run_sync(...)`. `DATABASE_URL` uses the `postgresql+psycopg://` form; the asyncpg URL is derived.
- Auth (`routes_fastapi/auth_routes.py`, `deps.py`): httpOnly cookies `campusgrade_access` (15 min), `campusgrade_refresh` (rotating, days) and a readable `campusgrade_csrf` double-submit token (`core/csrf.py` enforces it on POST/PUT/PATCH/DELETE). Access tokens carry `session_version` and `sid` and are validated against the user's current session on every request. `GET /auth/me` returns the `Principal`. Roles: `super_admin`, `program_admin`, `teacher`, `student`; authorization via `require_roles(...)`/`require(Permission...)` and the policy engine in `core/policy.py`, `core/scoping.py`, `core/principal.py`.
- Models: `models/sql_models.py` (users and identity/profile tables, programs, academic sessions, batches, sections, subjects, enrollments, audit log, settings) and `models/assignment.py` (assignments, rubric, resources, submissions + versions, grades + revisions, similarity flags, discussions).
- `routes_fastapi/assignments/` is the assignment API, one router per concern (crud, submissions, external_ai, grading, discussions, admin) plus shared helpers (common, workflow, payloads); `routes_fastapi/admin/` holds the per-resource admin routers mounted under `/admin`; `services/admin_helpers.py` holds the shared admin normalizers and import parsers.
- GitHub submissions: `services/github_repository_service.py` fetches/archives repos and computes similarity fingerprints (secrets redacted via `SECRET_PATTERNS`); `services/assignment_external_evaluation.py` builds the full-repository export for the external-AI workflow.
- Storage: `services/object_storage.py` (`LocalPrivateObjectStorage` for tests/dev scripts, `S3PrivateObjectStorage` for S3-compatible stores (RustFS locally) and AWS S3; `PRIVATE_S3_*` settings). Production always uses the S3 backend. `scripts/ensure_bucket.py` (run by the `storage-init` service) creates the bucket.
- Config: `config.py` (pydantic-settings) reads environment variables, `.env`, then `/run/secrets/<field_name>` files. The app refuses to start on a weak `SECRET_KEY`.
- AI: there is no in-app model call. The external-AI workflow is human-in-the-loop (generate prompt → teacher uses an external tool → import JSON → validate and save). `ai/assignment_ai.py` still contains an unused Azure OpenAI client slated for removal; only `extract_text_from_document` is live.

### Frontend

- App Router under `src/app/`; authenticated pages live in the `(app)` route group sharing `src/app/(app)/layout.tsx` (persistent shell). `src/app/session/refresh/page.tsx` silently refreshes an expired access cookie (see `src/proxy.ts`). Route `page.tsx` files are thin and render components from `src/features/<domain>/components` (`academics`, `ai`, `assignments`, `auth`, `grading`, `integrity`, `people`, `reporting`); each feature has `api.ts`, `queries.ts` (TanStack Query), `schema.ts`, `types.ts`.
- Auth is cookie-based; no token in `localStorage`. `src/lib/http.ts` is the shared axios instance: sends cookies, adds the CSRF header on mutating requests, and on a 401 calls `/auth/refresh` once (deduplicated) and retries. `src/lib/session.ts` caches `GET /auth/me` in memory. `src/proxy.ts` gates `/admin/*` and `/platform/*` by role server-side and routes expired-access/valid-refresh visits through `/session/refresh`.
- `src/types/api.d.ts` is generated from the backend OpenAPI (`npm run gen:types`); CI fails if it is stale. `src/types/api-client.ts` is the typed request facade.
- Next.js builds with `output: "standalone"`; the production image runs `node server.js` as a non-root user.

### CI/CD

`.github/workflows/ci.yml`: lint/types/tests/migration round-trip/frontend build, then builds both images, Trivy-scans them, starts `compose.prod.yaml` and runs Playwright against `https://campusgrade.localhost`; a merge to `main` pushes the tested images to `ghcr.io/devxjitin/campusgrade-{api,web}` (tags `main`, `sha-<commit>`), with no second build. `.github/workflows/release.yml` runs on `v*.*.*` tags: it waits for that commit's `sha-<commit>` images and re-tags them with the version (and `latest` for stable versions); version tags do not re-run CI.
