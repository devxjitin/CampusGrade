# CampusGrade — Product Requirements Document (PRD)

| | |
|---|---|
| **Status** | Draft v2 — plan only, no code changed yet |
| **Date** | 2026-10-16 |
| **Owner** | Jitin Kumar Sengar |
| **Target** | Production-ready Docker stack, running on **Docker Desktop** for now. Cloud-ready: AWS is a later, optional step (Appendix A). |
| **Supersedes** | All earlier planning, sprint-status, architecture and changelog documents (deleted; they remain in git history). |

---

## 1. Product summary

CampusGrade is an assignment, GitHub-repository-analysis and grading platform for one
institution (School of Engineering and Technology). Teachers publish assignments,
students submit a public GitHub repository (or files), the platform snapshots and
analyzes each commit, flags code similarity between students, and teachers grade
against a rubric — optionally with AI help — before releasing results.

### 1.1 Users and roles

| Role | Does |
|---|---|
| **Super Admin** | Owns the platform: creates Program Admins, sees everything, audit log. |
| **Program Admin** | Manages one or more programs: academic sessions, batches, sections, subjects, students, teachers, session rollover. |
| **Teacher** | Creates assignments + rubrics, monitors submissions, reviews repositories, grades, publishes results, answers discussions. |
| **Student** | Links a repository / uploads work, re-syncs commits before the deadline, sees grades and feedback, asks questions. |

### 1.2 Goals for this release

1. **Production-grade Docker stack** that runs on Docker Desktop today with the same images, config and process that a server or cloud would use later. No AWS for now.
2. **CI/CD**: every merge is tested, built into versioned images, and published to GitHub Container Registry. Deploying or rolling back a version is one command.
3. **Production-grade behaviour**: no single process doing hidden work, a reverse proxy with HTTPS, secrets out of env files, health checks, restart policies, backups with a tested restore, and structured logs.
4. **Fix the known bugs** (section 4) and **finish the half-done migrations** (sync→async, background jobs).
5. **Trim dead features, add the missing ones** that a real college deployment needs (password reset email, presigned downloads).

### 1.3 Non-goals

- Multi-tenant / multi-institution SaaS.
- Self-hosted ML models, embeddings, vector DBs.
- Native mobile apps (responsive web only).
- Rewriting the stack in another language.
- Cloud deployment (AWS) in this release — the design stays cloud-ready (Appendix A).

---

## 2. Current state (audited 2026-10-16)

### 2.1 Tech stack today

| Layer | Today |
|---|---|
| Backend | Python 3.12, FastAPI 0.115, Uvicorn, Pydantic v2 + pydantic-settings, SQLAlchemy 2.0 (async via asyncpg, plus `run_sync` bridges), Alembic (24 migrations), PyJWT, argon2/bcrypt |
| Database | PostgreSQL 16 |
| Jobs | Redis 7 + RQ worker (`assignment_worker.py`), **plus** FastAPI `BackgroundTasks`, **plus** an `asyncio` scheduler loop inside the API process |
| Storage | `PrivateObjectStorage` abstraction — local disk or S3 (boto3, synchronous) |
| AI | Azure OpenAI client in `ai/assignment_ai.py` (**not called by any route** — dead), plus a human copy-paste "external AI" prompt/proposal workflow |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, TanStack Query 5, axios, recharts, mermaid, framer-motion, lucide |
| Auth | httpOnly cookie JWT (15 min access / refresh rotation), double-submit CSRF, session-version revocation, 4 roles + policy engine |
| Tests | pytest (~15 files, testcontainers for Postgres), vitest (few unit tests), Playwright (4 smoke specs, not run in CI) |
| Infra | `docker-compose.yml` (postgres, redis, api, web), GitHub Actions CI (lint/mypy on a file allow-list, pytest, migration round-trip, frontend build). **No deployment, no IaC.** |

### 2.2 Feature inventory

| Area | Features | Status |
|---|---|---|
| Identity | Login, cookie sessions, refresh rotation, device sessions list/revoke, profile + GitHub links, temporary passwords from admin | Works |
| Academic structure | Programs, academic sessions, batches, sections, subjects, teacher allocations, session rollover (preview/execute/undo) | Works |
| People | Add/edit/import students & teachers (CSV/XLSX with row validation), user detail, activate/deactivate | Works |
| Assignments | Create/edit/publish, rubric, resources/attachments, audience targeting, schedule (UTC), late policy | Works |
| Submissions | GitHub repo link, manual "Update repository", up to 3 versions, archive + manifest to storage, source viewer | Works, but see bugs B2/B3 |
| Live repository sync | Automatic polling of linked repos until deadline (`sync_due_repositories`) | **Broken — never scheduled** |
| Integrity | Cross-submission code-similarity fingerprints, review flags, automatic mark cap | Works |
| Grading | Rubric grading, grade revisions, freeze cohort, publish/withdraw, auto-release by condition, gradebook export | Works |
| External AI | Generate prompt → teacher pastes into external chat → paste JSON back → validate & save (draft assignments + bulk evaluation of ≤10 students) | Works, clumsy UX |
| In-app AI suggestions | `POST /teacher/{id}/ai-suggestions/{student}` | **Dead — returns 410** (to be removed) |
| Discussions / announcements / notifications | Threads per assignment, in-app notifications | Works |
| Analytics / reporting | Teacher & admin dashboards, audit log | Works |
| Password reset | `password_reset` model exists | **No route, no email** |

---

## 3. The main architecture issue

### Background work is embedded in, and leaks into, the web process.

This is the single issue that blocks running in production, because it makes
the API impossible to scale or deploy safely:

1. **In-process scheduler** — `app.py` `lifespan` runs an infinite loop every 15 s that
   auto-publishes results, finalizes deadlines, purges sessions and checks rollover.
   Run 2 API replicas behind the reverse proxy → the loop runs twice. Restart the API
   during a deploy → nothing runs. It also shares the request event loop.
2. **Three job runtimes with silent fallback** — `enqueue_repository_analysis` tries RQ,
   else FastAPI `BackgroundTasks`, else runs the whole clone/zip/fingerprint **inline on
   the user's HTTP request** (`asyncio.to_thread(analyze_repository_version)`).
   Three failure modes, retries only in one, no visibility in any.
3. **Event-loop misuse** — `analyze_repository_version` calls `asyncio.run(...)` on the
   process-global async engine. In the `BackgroundTasks`/`to_thread` paths that runs a
   *second* event loop in a thread against a connection pool owned by the main loop →
   intermittent `attached to a different loop` / `another operation is in progress` errors.
4. **Half-finished sync→async port** — most heavy logic still runs as sync SQLAlchemy
   inside `db.run_sync(...)`, with 14 "sync original + async twin" helper pairs in
   `assignment_routes.py` that exist only because the scheduler needs sync code.
5. **Blocking I/O in async handlers** — synchronous boto3 S3 `get_bytes`/`put_bytes` and
   whole-archive reads run directly inside `async def` routes, stalling every request
   on that worker while a large repository zip downloads.
6. **Migrations run in the container entrypoint** — every replica runs
   `alembic upgrade head` on boot; parallel replicas race.

### Decision

Split the backend into **two deployables from one codebase** and give jobs **one** runtime:

- `api` — stateless HTTP only. Never runs jobs, never schedules.
- `worker` — the only place background work runs. Pulls from a **Postgres `jobs` table**
  (`SELECT … FOR UPDATE SKIP LOCKED`), with retries, backoff, dead-letter status, and
  per-job timeouts. Periodic tasks run in the worker under a Postgres advisory lock so
  exactly one worker executes each tick no matter how many run.
- Enqueue is **transactional**: the job row is inserted in the same transaction as the
  submission version, so a job can never be lost or run before its data is committed.
- **Remove Redis and RQ entirely** (one less container to run, back up and secure).
- Migrations run as a **one-shot `migrate` container** that must finish successfully
  before `api` and `worker` start (`depends_on: condition: service_completed_successfully`).

Why Postgres over SQS: job volume is small (hundreds/day), enqueue must be
transactional with domain writes, and the team gets job state/history with a plain
SQL query and an admin page. SQS can be swapped in later behind the same `enqueue()`
interface if volume grows 100×.

---

## 4. Bugs and issues found

Severity: **P0** = breaks prod / security, **P1** = user-visible bug, **P2** = debt that
hurts operations.

| # | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| B1 | P0 | `backend/app.py` `/ready` | `schema_revision_status()` is `async` but called without `await`; `revision["ready"]` on a coroutine raises `TypeError` → `/ready` always returns 500. A container health check on `/ready` would mark every replica unhealthy. | `await` it; add a test. |
| B2 | P0 | `frontend/src/proxy.ts` + `auth_routes.py` | Access cookie `max_age` = 15 min. `proxy.ts` redirects to `/login` when the access cookie is **absent**, before the client can use the still-valid refresh cookie. Users get logged out on any full navigation/refresh after 15 minutes idle. | In `proxy.ts`, treat presence of the refresh cookie as "maybe signed in" and let the page/axios refresh; or call `/auth/refresh` server-side in the proxy and forward `Set-Cookie`. |
| B3 | P0 | `services/github_repository_service.py` | `asyncio.run()` on the shared engine from a thread (see §3.3); inline analysis on the web request when Redis is down. | Replaced by worker (§3). |
| B4 | P1 | `services/github_repository_service.py` | `sync_due_repositories()` (live auto-sync until deadline) has **no caller**. Students' latest pushes are only captured if they press "Update repository"; README/UI promise otherwise. | Schedule it in the worker every `REPOSITORY_SYNC_INTERVAL_SECONDS`. |
| B5 | P1 | `ai/assignment_ai.py` `_invoke_prompt_with_timeout` | `with ThreadPoolExecutor(...)` waits for the worker thread on exit, so the "timeout" never returns early (blocks up to the 70 s `urlopen` timeout). | Delete with the Azure client (§6); no in-app AI client is needed. |
| B6 | P1 | `utils/rate_limit.py` | Login rate-limit is process-local and keyed on `request.client.host`. Behind a reverse proxy every request comes from the proxy's IP → one shared bucket for the whole college (10 logins/min total) and the limit doesn't hold across replicas. | Trust `X-Forwarded-For` from the proxy only (`--proxy-headers --forwarded-allow-ips`), store counters in Postgres. |
| B7 | P1 | `assignment_routes.py` | Sync boto3 + full-archive `get_bytes` inside async routes; file downloads stream through the API (`Response(content=...)`). | `asyncio.to_thread` for storage calls short-term; serve downloads via **S3 presigned URLs** (§6). |
| B8 | P1 | `docker/api-entrypoint.sh` | `alembic upgrade head` + admin bootstrap on every container start → races with >1 replica. | One-shot `migrate` container; bootstrap admin as a manual one-off `docker compose run`. |
| B9 | P2 | `backend/Dockerfile` | Runs as root, installs from `requirements.txt` (can drift from `uv.lock`), no healthcheck, single Uvicorn worker. | Multi-stage `uv sync --frozen`, non-root user, `gunicorn -k uvicorn.workers.UvicornWorker` (2 workers/task), `HEALTHCHECK`. |
| B10 | P2 | `frontend/Dockerfile` | Copies whole build incl. dev `node_modules` (~1 GB image); `BACKEND_ORIGIN` baked at build time via `rewrites`. | `output: "standalone"`, copy `.next/standalone` + `static` only; route `/api/*` at the reverse proxy, not via Next rewrites. |
| B11 | P2 | `routes_fastapi/assignment_routes.py` | 3,151 lines / 50 routes / 119 functions in one file; 14 sync+async twin helpers. | Split into `assignments/`, `submissions/`, `grading/`, `integrity/`, `discussions/`, `external_ai/` routers + services; delete sync twins once the scheduler moves to the async worker. |
| B12 | P2 | `routes_fastapi/admin_routes.py` | 1,642 lines of mostly dead legacy code; only `_get_or_create_soet_department` and some string helpers are live. | Move helpers to `services/`, delete file. |
| B13 | P2 | CI | ruff runs on an allow-list of files; mypy covers 3 dirs; Playwright not run; no container build, no deploy. | Ruff + mypy on all of `backend/`, Playwright against the production compose stack in CI, image build + publish jobs (§8). |
| B14 | P2 | Docs | `CLAUDE.md` still describes `localStorage` JWT, `(dashboard)` route group, `src/hooks/`; README says Vite on 5174. 10 overlapping planning `.md` files. | Rewrite README + CLAUDE.md after this PRD; archive plans. |
| B15 | P2 | Repo hygiene | `frontend/src/app/(dashboard)/layout.tsx.bak`, empty `src/hooks`/`src/layouts`, `frontend/run_frontend.py`, `frontend/dev.js`, `setup.ps1`, Windows re-exec in `backend/main.py`. | Delete. |
| S1 | P1 security | AWS account (not used by this release) | The AWS CLI on this PC is authenticated as the **account root user** (`arn:aws:iam::143920986615:root`). Root keys on a dev PC are a risk even if CampusGrade doesn't use AWS. | Enable root MFA, delete root access keys, create an IAM Identity Center admin user. Required before Appendix A. |
| S2 | P1 security | `services/assignment_external_evaluation.py` | Student names + roll numbers go into the generated prompts the teacher pastes into an external AI tool, in plain text. | Pseudonymize (`Student-07`) in the prompt/export; map back server-side when the teacher imports the JSON. |
| S3 | P1 security | Secrets | `SECRET_KEY`, DB password, GitHub token come from `.env` files and plain environment variables. | Docker Compose **secrets** (files mounted at `/run/secrets/*`, git-ignored); config reads `*_FILE` variables. |

---


## 5. Target tech stack (decision)

Keep what is good; the stack is modern and the team already knows it. Change only what
blocks production. Every infrastructure choice below is a standard container or protocol
(S3 API, SMTP, Postgres), so moving to a server or cloud later is a config change, not a rewrite.

| Layer | Choice | Why / change |
|---|---|---|
| Backend | **FastAPI + Python 3.12 + SQLAlchemy 2.0 async (asyncpg) + Pydantic v2 + Alembic** | Keep. Finish the async port; delete `run_sync` bridges. Serve all routes under the `/api` prefix. |
| App server | **Gunicorn + UvicornWorker**, `--proxy-headers` | Multiple workers per container, trusted forwarded headers. |
| Worker | Same image, `python -m worker` command | Postgres job queue + advisory-lock periodic tasks (§3). |
| Database | **PostgreSQL 16** container, named volume, not exposed to the host in prod | Same engine as today; tuned config, nightly backups (F10). |
| Cache / queue | **None** (Redis + RQ removed) | Postgres covers jobs, rate-limit counters, sessions. |
| File storage | **MinIO** (S3-compatible) container, private bucket | The existing `S3PrivateObjectStorage` runs unchanged against it, so the code is exercised exactly as it would be on AWS S3. Presigned URLs (F4) go through the proxy at `/storage/*`. |
| Reverse proxy | **Caddy 2** | HTTPS out of the box (`tls internal` locally, Let's Encrypt on a real domain), HTTP/2+3, compression, security headers (HSTS, CSP), load-balances api replicas, routes `/api/*` → api, `/storage/*` → MinIO, `/*` → web. |
| AI | **None in-app.** Keep the existing human-in-the-loop external-AI flow (generate prompt → teacher uses an external AI tool → import JSON → validate & save) | No AI vendor, keys, or cost in our infrastructure. Dead Azure code is deleted. |
| Email | **SMTP** interface. **Mailpit** container in dev/CI; any SMTP provider (Google Workspace relay, Brevo, SES SMTP…) in prod by config | One protocol everywhere; no vendor lock-in. |
| Frontend | **Next.js 16 (App Router, `output: "standalone"`) + React 19 + TS + Tailwind v4 + TanStack Query** | Keep. Add generated OpenAPI types end-to-end, Zod form validation. |
| Runtime | **Docker Desktop** (WSL 2 backend) running **Docker Compose** | What exists today on this PC. The same compose file runs on any Linux server with Docker. |
| Secrets | **Docker Compose secrets** (`./secrets/*.txt`, git-ignored) | Never in images, committed env files, or `docker inspect` output. |
| Observability | JSON logs with request ID (already in place) + Docker log rotation; `/api/metrics` (Prometheus format); optional `monitoring` compose profile with Prometheus + Grafana | Lightweight by default, real dashboards when needed. |
| CI/CD | **GitHub Actions** → images to **GitHub Container Registry (GHCR)**, tagged with git SHA and semver on release; one-command deploy/rollback script | Already on GitHub (`devxjitin/CampusGrade`); GHCR is free for this use. |
| Supply chain | **Trivy** image scan, **Dependabot** for pip/npm/actions/Docker | Catch vulnerable dependencies before they ship. |

---

## 6. Feature changes

### 6.1 Remove

| Remove | Reason |
|---|---|
| Redis, RQ, `assignment_worker.py`, `core/redis.py`, FastAPI `BackgroundTasks` usage | Replaced by Postgres job worker. |
| Azure OpenAI client (`ai/assignment_ai.py` invoke/config functions) and its env vars | Never called. Keep `extract_text_from_document`. |
| `POST /teacher/{id}/ai-suggestions/{student}` (410 stub) and the `assignment_ai_suggestions` table | Dead endpoint; superseded by AI evaluation proposals. |
| `admin_routes.py` legacy file | Dead code (B12). |
| `PRIVATE_STORAGE_BACKEND=local` in production | Prod always uses the S3 API (MinIO now, S3 later); local disk stays for unit tests only. |
| Repo clutter (B15) | Hygiene. |
| `AUTH_COOKIE_MODE=false` header-auth fallback | Cookie mode has been live; the escape hatch is now just attack surface. |

### 6.2 Add

| # | Feature | Description | Priority |
|---|---|---|---|
| F1 | **Background job system** | `jobs` table (type, payload, status, attempts, run_after, last_error, locked_by), worker service, retries with backoff, dead-letter, Super Admin "Jobs" page to view/retry. | Must |
| F2 | **Live repository auto-sync** | Worker polls linked repos before the deadline (B4); respects GitHub rate limits using the app token; shows "last synced" to student and teacher. | Must |
| F3 | **Self-service password reset** | "Forgot password" → email with single-use, 30-min token (model already exists) → set new password → revoke all sessions. | Must |
| F4 | **Presigned downloads/uploads** | Attachments and repository archives served via 5-min presigned URLs from MinIO; large uploads go browser → storage directly. | Must |
| F5 | **Improve the external-AI flow** | Keep the manual flow (no in-app model calls). Pseudonymize students in prompts/exports (S2), validate imported JSON against the rubric with clear per-field errors, and show a diff of proposal vs. current grade before the teacher saves. | Should |
| F6 | **Email notifications** | Results published, deadline in 24 h, discussion reply — opt-out in settings. Sent by the worker over SMTP. | Should |
| F7 | **Distributed rate limiting** | Postgres-backed limiter for login, password reset and refresh, shared by all api replicas. | Must |
| F8 | **Operational endpoints** | `/api/health` (liveness), `/api/ready` (DB + migration head + storage), fixed (B1); `/api/metrics`. | Must |
| F9 | **Data export** | Super Admin can export a session's grades + audit log (CSV/XLSX). | Could |
| F10 | **Backup & restore** | `backup` container: nightly `pg_dump` + MinIO bucket mirror, 14 daily / 8 weekly retention, copied to a host folder outside Docker; `restore` script tested in CI. | Must |

### 6.3 UI changes

- Session-expiry fix (B2) — no surprise logouts.
- Submission page: live sync status ("Last synced 2 min ago · commit `abc123`"), analysis progress from the job table instead of a spinner.
- External-AI dialogs: clearer steps (copy prompt → paste JSON → review diff → save) and friendlier validation errors.
- Login page: "Forgot password?" link and reset screens.
- Super Admin: Jobs page.
- Consistent empty/error/loading states (already started in `components/ui/FeedbackStates.tsx`) on every page; accessibility pass (keyboard nav, focus rings, contrast) on the shell and forms.

---

## 7. Deployment architecture (Docker Desktop)

```
   Browser ── https://campusgrade.localhost  (or a LAN hostname / real domain later)
                              │ :443 / :80
                       ┌──────┴──────┐
                       │   proxy     │  Caddy: TLS, HSTS/CSP, gzip/zstd, body-size limit
                       └──┬────┬───┬─┘
              /api/*      │    │   │ /storage/*  (presigned URLs only)
        ┌─────────────────┘    │   └──────────────────┐
        ▼                      ▼ /*                   ▼
   api ×2 (gunicorn)       web (Next.js standalone)   minio
        │                                              ▲
        │        network "backend" (internal: true)    │
        ├──────────► postgres ◄────── worker ──────────┤
        │               ▲               │              │
   migrate (one-shot) ──┘               ├──► SMTP (Mailpit in dev / provider in prod)
                                        └──► github.com (repo fetch)
   backup (nightly pg_dump + bucket mirror → ./backups on the host)
```

### 7.1 Compose layout

| File | Purpose |
|---|---|
| `compose.yaml` | Base service definitions shared by every environment. |
| `compose.dev.yaml` | Local development: source bind-mounts, hot reload, Mailpit, ports exposed for debugging. |
| `compose.prod.yaml` | Production: pinned GHCR images (`${CAMPUSGRADE_VERSION}`), no bind mounts, no published ports except the proxy, resource limits, `restart: unless-stopped`. |
| `compose.monitoring.yaml` | Optional profile: Prometheus + Grafana. |
| `secrets/` (git-ignored) | `secret_key.txt`, `postgres_password.txt`, `minio_root_password.txt`, `github_token.txt`, `smtp_password.txt`. A `scripts/init-secrets` command generates strong values. |

### 7.2 Production container standards

Every service in `compose.prod.yaml`:

- Runs as a **non-root** user, `read_only: true` root filesystem with `tmpfs` for scratch, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`.
- Has a **health check**; dependants use `depends_on: condition: service_healthy`.
- Has **CPU/memory limits** sized to fit Docker Desktop's allocation (target: whole stack ≤ 6 GB RAM).
- Uses `restart: unless-stopped` and the `json-file` log driver with rotation (`max-size: 10m`, `max-file: 5`).
- Is on the narrowest network it needs: only `proxy` publishes ports; `postgres`, `minio` and `worker` sit on an `internal: true` network (the worker also joins an egress network for GitHub and SMTP).

Sizing on Docker Desktop (give Docker ≥ 4 CPUs / 8 GB in Settings → Resources):

| Service | Replicas | Limit each |
|---|---|---|
| proxy | 1 | 0.5 CPU / 256 MB |
| web | 1 | 1 CPU / 512 MB |
| api | 2 | 1 CPU / 768 MB |
| worker | 1 | 1 CPU / 1 GB (repo zips) |
| postgres | 1 | 1.5 CPU / 1.5 GB |
| minio | 1 | 0.5 CPU / 512 MB |
| backup | 1 | 0.25 CPU / 256 MB |

### 7.3 Security baseline

- HTTPS only; HTTP redirects to HTTPS. Locally, Caddy's internal CA (trust it once on this PC); with a real domain, Let's Encrypt.
- Cookies `Secure`, `SameSite=Lax`; HSTS, CSP, `X-Content-Type-Options` and `Referrer-Policy` set at the proxy.
- Postgres and MinIO are never reachable from the host or LAN in prod; admin access is via `docker compose exec`.
- Secrets only as Compose secrets; `.env` holds non-secret settings only.
- MinIO bucket private, no anonymous policy; presigned URLs expire in 5 minutes.
- Images scanned by Trivy in CI; a CRITICAL vulnerability fails the build.
- Docker Desktop: keep it updated and don't expose the daemon on TCP.

### 7.4 Prerequisites from the owner

1. Docker Desktop resources set to ≥ 4 CPUs / 8 GB RAM / 60 GB disk.
2. GitHub repository `devxjitin/CampusGrade` with Actions and GHCR enabled; a token with `read:packages` on this PC to pull images.
3. A GitHub token for repository fetching (rate limits).
4. An SMTP account for real emails (only needed when real users use it).
5. Lock down the AWS root user (S1) — not used by this release, but the risk is on this PC today.

---

## 8. CI/CD

```
PR  ──► lint (ruff + mypy whole backend, eslint, tsc) ─► pytest (testcontainers) ─► vitest
        ─► migration up/down/up ─► docker build all images ─► Trivy scan
        ─► start compose.prod.yaml in CI ─► Playwright e2e ─► backup/restore test
main ─► all of the above ─► push images to GHCR (tags: git SHA, `main`)
tag vX.Y.Z ─► re-tag the tested SHA as `vX.Y.Z` + `latest` ─► GitHub Release with notes
```

**Deploy (on this PC, or any Docker host)** — one command, e.g. `scripts\deploy.ps1 -Version v1.4.0`
(with a `scripts/deploy.sh` twin for Linux):

1. `docker compose pull` the requested version from GHCR.
2. Take a pre-deploy database backup.
3. Run the one-shot `migrate` container; stop if it fails.
4. `docker compose up -d --wait` (api replicas restart one at a time).
5. Smoke test `/api/ready` and the login page through the proxy.
6. On any failure → automatically redeploy the previous version (`scripts\rollback.ps1`).

Optional: register this PC as a **self-hosted GitHub Actions runner** so a published release
deploys itself (continuous deployment). Off by default; available from Sprint 3.

- Migrations must be backward compatible with the previous app version (expand → migrate → contract) so a rollback never meets a schema it can't read.

---

## 9. Non-functional requirements

| Area | Requirement |
|---|---|
| Availability | Services restart automatically on crash and after a Docker Desktop/PC restart; a deploy or rollback completes in < 5 min with < 30 s of errors. A single PC is not highly available; that comes with Appendix A. |
| Performance | p95 API < 300 ms for reads, < 800 ms for writes (excluding repo jobs); repo analysis job < 2 min for a 100 MB repo. |
| Scale (on the §7.2 sizing) | 200 concurrent users; 2,000 students, 150 teachers. Higher targets need a server (Appendix A). |
| Durability | Nightly backups, 14 daily + 8 weekly kept, copied outside Docker's disk; restore tested in CI and once by hand before launch. RPO 24 h, RTO 1 h. |
| Security | OWASP ASVS L2 for auth/session; no secrets in repo/images; non-root, read-only containers; AI prompts pseudonymized. |
| Observability | Structured JSON logs with request ID; `/api/metrics`; optional Grafana dashboard; health status visible in `docker compose ps`. |
| Accessibility | WCAG 2.1 AA on core flows (login, submit, grade). |
| Browser support | Last 2 versions of Chrome, Edge, Firefox, Safari; mobile ≥ 360 px wide. |
| Portability | The same images and `compose.prod.yaml` run unchanged on a Linux server with Docker. |

---

## 10. Delivery plan

The detailed, sprint-by-sprint plan lives in [Sprint.md](Sprint.md). The CI/CD pipeline and
the production compose stack are built first, so every sprint ships working software:

| Sprint | Weeks | Delivers |
|---|---|---|
| 0 | before start | Owner prerequisites: Docker Desktop resources, GitHub/GHCR access, tokens |
| 1 | 1–2 | Production compose stack (Caddy, MinIO, secrets, non-root images) + CI publishing to GHCR + deploy script; B1, B2, B8, B9, B10, `/api` prefix |
| 2 | 3–4 | Worker + Postgres jobs (the architecture fix); live repo auto-sync; Redis removed |
| 3 | 5–6 | Presigned files, backend split + dead code removed, backups + rollback, release tagging |
| 4 | 7–8 | Password reset + email notifications (SMTP) |
| 5 | 9–10 | External-AI flow pseudonymized + diff preview; UX and accessibility polish |
| 6 | 11 | Load test, restore drill, security review, monitoring, v1.0.0 release |

**Total ≈ 11 weeks** for one developer with AI assistance.

---

## 11. Success metrics

- 0 P0/P1 bugs open at v1.0.0; deploy frequency ≥ 1/week with change-failure rate < 10 %.
- Any version can be deployed or rolled back with one command in < 5 minutes.
- 100 % of repository submissions analyzed within 5 min of push before the deadline.
- Restore from backup verified in CI on every `main` build.

## 12. Open questions

1. Who uses the Docker Desktop deployment — only you for demos, or real students over the LAN? (Decides when a real hostname/TLS cert and SMTP provider are needed.)
2. Is SSO with the college's Google Workspace / Microsoft 365 wanted, or are local passwords enough for v1?
3. Expected peak users at deadlines — confirms whether a single PC is enough.

---

## Appendix A — Moving to a server or AWS later (not in this release)

Because everything uses standard interfaces, the move is mostly configuration:

| Docker Desktop (now) | Linux server (next step) | AWS (later) |
|---|---|---|
| Compose on Docker Desktop | Same `compose.prod.yaml` on a VM | ECS Fargate services `web`, `api`, `worker` |
| Caddy `tls internal` | Caddy + Let's Encrypt | CloudFront + ALB + ACM + WAF |
| Postgres container + `backup` | Same, or managed Postgres | RDS PostgreSQL Multi-AZ, PITR |
| MinIO | MinIO or any S3 provider | Amazon S3 (only `PRIVATE_S3_ENDPOINT` changes) |
| Mailpit / SMTP provider | SMTP provider | Amazon SES (SMTP or API) |
| Compose secrets | Compose secrets | Secrets Manager |
| `migrate` one-shot container | Same | One-off ECS task in the pipeline |
| GHCR images | GHCR images | ECR (or keep GHCR) |
| Deploy script | Deploy script / self-hosted runner | GitHub Actions OIDC → CDK deploy |

Before Appendix A: fix S1 (AWS root user) and add infrastructure-as-code (AWS CDK).
