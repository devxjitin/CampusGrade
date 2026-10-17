# CampusGrade — Sprint Plan

Derived from [PRD.md](PRD.md). IDs in brackets (B1, F3, S2 …) refer to the PRD's bug,
feature and security tables.

**Target for this release:** a production-ready Docker stack running on **Docker Desktop**
on this PC. No AWS. The same images and `compose.prod.yaml` must later run unchanged on
any Linux server (PRD Appendix A).

## Ground rules

1. **Every sprint ends with working software** that CI built, tested and published
   to GHCR, deployed to Docker Desktop with the one-command deploy script. Nothing is
   deployed from a hand-built image.
2. That is why the production compose stack and the pipeline are built in **Sprint 1**.
   Every later sprint adds features on top of a pipeline that already works.
3. Sprint length is **2 weeks** (Sprint 6 is 1 week). Total ≈ **11 weeks**.
4. `main` is always releasable. Work happens on short-lived branches → PR → green CI →
   merge → images published to GHCR as `:<git-sha>` and `:main`.
5. Each sprint ends by tagging a release (`v0.1.0`, `v0.2.0` … `v1.0.0`) and deploying
   that tag on Docker Desktop with `scripts\deploy.ps1 -Version vX.Y.Z`.
6. Database migrations are **expand → migrate → contract**: a migration must work with
   both the old and the new app version, so rollback is always safe.

### Two ways to run on this PC

| Mode | Command | Used for |
|---|---|---|
| **dev** | `docker compose -f compose.yaml -f compose.dev.yaml up` | Coding: bind mounts, hot reload, Mailpit UI, DB port open |
| **prod** | `scripts\deploy.ps1 -Version vX.Y.Z` | The real deployment: GHCR images, HTTPS via Caddy at `https://campusgrade.localhost`, non-root read-only containers, backups |

Both can't run at once on the same ports; dev uses `:3000`/`:8000`, prod uses `:443`/`:80`.

### Definition of Done (applies to every ticket)

- Merged to `main` through a PR with green CI.
- Tests added: backend pytest for logic/routes, vitest for frontend logic, Playwright for
  any changed user flow.
- Works in the **prod** compose stack, not just dev mode (CI runs e2e against `compose.prod.yaml`).
- No new P0/P1 issues; no secrets in code, images or logs; Trivy shows no CRITICAL findings.
- `README.md` / `CLAUDE.md` updated if setup, commands or architecture changed.

### Pipeline flow

```
feature branch ──PR──► CI: lint · types · pytest · vitest · migrations up/down/up
                          · build images · Trivy · compose.prod up · Playwright e2e
                         │ green
                         ▼
                       main ──► push images to GHCR  (:<sha>, :main)
                                 │
                       git tag vX.Y.Z ──► re-tag tested images :vX.Y.Z + GitHub Release
                                 │
                                 ▼
             Docker Desktop:  scripts\deploy.ps1 -Version vX.Y.Z
             pull → backup → migrate → up --wait → smoke test → auto-rollback on failure
             (from Sprint 3, optional self-hosted runner does this automatically on release)
```

### How the pipeline grows

| Sprint | CI/CD capability added |
|---|---|
| 1 | Image builds for api/web, push to GHCR, Trivy scan, `compose.prod.yaml` started in CI with Playwright smoke tests, `deploy.ps1` |
| 2 | Worker image role, job-system integration tests, 2 api replicas in the CI stack |
| 3 | Full e2e suite, ruff + mypy on the whole backend, release tagging workflow, backup/restore test in CI, `rollback.ps1`, optional self-hosted runner for automatic deploys, Dependabot |
| 4 | Email e2e tests (Mailpit API in CI) |
| 5 | axe accessibility checks in Playwright |
| 6 | k6 load-test job (manual trigger), monitoring profile |

---

## Sprint 0 — Owner prerequisites (before Sprint 1, no code)

| ID | Task | Ref |
|---|---|---|
| S0-01 | Docker Desktop → Settings → Resources: ≥ 4 CPUs, 8 GB RAM, 60 GB disk | PRD §7.2 |
| S0-02 | Confirm GitHub Actions and GHCR (Packages) are enabled on `devxjitin/CampusGrade`; create a token with `read:packages` and run `docker login ghcr.io` on this PC | PRD §7.4 |
| S0-03 | Create a GitHub token for repository fetching (higher rate limits) | F2 |
| S0-04 | Lock down the AWS root user (MFA on, delete root access keys) — not used by this release, but the keys are on this PC | S1 |
| S0-05 | Answer PRD open questions (who uses it, SSO, peak users) | PRD §12 |

**Exit:** `docker login ghcr.io` works and Docker Desktop has the resources.

---

## Sprint 1 — Production stack + CI/CD skeleton (weeks 1–2) → `v0.1.0`

> **Status: done. Released as `v0.1.0`** (PR #1, squash-merged to `main` as `e33dbe3`).
>
> **Verified**
> - CI (GitHub Actions, Linux) is green on the PR, on `main` and on the tag: lint, mypy, 200 backend
>   tests (database-backed ones included), migration upgrade/downgrade/upgrade round-trip, frontend
>   lint/build/unit tests, and the `stack` job, which builds both images, scans them with Trivy
>   (no fixable CRITICAL findings), starts `compose.prod.yaml`, smoke-tests it through the HTTPS
>   proxy and runs the Playwright session test.
> - Images published to `ghcr.io/devxjitin/campusgrade-{api,web}` with tags `v0.1.0`, `latest`,
>   `main` and `sha-<commit>` (confirmed from the publish job logs).
> - Locally on Docker Desktop: `scripts\deploy.ps1` deploys, smoke-tests and tears down cleanly;
>   login, cookies, CSRF, the expired-access-cookie refresh redirect and the security headers
>   behave through the proxy; app containers run non-root, read-only, all capabilities dropped.
>
> **Not verified**
> - Pulling the published images: the GHCR packages are private, so `docker login ghcr.io` (token
>   with `read:packages`) or making the packages public is needed before `scripts\deploy.ps1
>   -Version v0.1.0` can pull them. Not yet done on this PC.
> - The production stack has not been opened in a real browser (Caddy's local certificate must be
>   trusted first: `scripts	rust-caddy-ca.ps1`).
>
> **Deviations from the plan**
> - `/api` prefix is stripped by Caddy instead of served by the backend (S1-02).
> - RustFS replaced MinIO, which no longer publishes container images (S1-12).
> - Redis is not in the stack; analysis uses the in-process fallback until Sprint 2.
> - The web image is ~281 MB, not under 250 MB (S1-10); the Node binary alone is 124 MB.
> - Trivy runs from its official container image because the `trivy-action` installer failed.
>
> **Found and fixed on the way (pre-existing, not in the original plan)**
> - `frontend/src/lib/` was never committed (a Python `.gitignore` rule ignored every `lib/`).
> - Seven migration downgrades failed on a fresh database, so the round-trip had never passed.
> - 22 database-backed backend tests had always been skipped in CI; their setup was broken.
> - Fixable CRITICAL advisories: PyJWT 2.10.1 -> 2.14.0, Next.js 16.2.11 -> 16.4.2.
> - A developer `backend/.env` was baked into the backend image and could override Docker secrets.

**Goal:** the current CampusGrade app runs in a production-grade compose stack on Docker
Desktop at `https://campusgrade.localhost`, from images CI built and published, with the
worst bugs fixed.

**Working feature delivered:** log in, create an assignment, submit a GitHub repo and
grade it over HTTPS, and stay logged in past 15 minutes. Deploying a new version is one command.

### Backend
| ID | Task | Ref |
|---|---|---|
| S1-01 | Fix `/ready`: `await schema_revision_status()`; check DB, migration head and storage; add a test | B1, F8 |
| S1-02 | `/api` prefix: **done at the proxy** — Caddy strips `/api/` and the backend keeps its unprefixed routes (`/login`, `/ready`, …). Browser-visible URLs are `/api/*`; no CSRF-path or test churn | PRD §5 |
| S1-03 | Gunicorn + UvicornWorker with `--proxy-headers --forwarded-allow-ips=<proxy>`; rate limiter keys on the real client IP | B6 (part 1), B9 |
| S1-04 | Remove `alembic upgrade` and admin bootstrap from the entrypoint; add `migrate` and `bootstrap-admin` commands | B8 |
| S1-05 | Config reads `*_FILE` variables (`SECRET_KEY_FILE`, `DATABASE_PASSWORD_FILE`, `GITHUB_TOKEN_FILE`, …) for Compose secrets | S3 |
| S1-06 | S3 storage settings split into internal endpoint (`http://storage:9000`) and public endpoint (`https://campusgrade.localhost/storage`) so presigned URLs work later | F4 prep |

### Frontend
| ID | Task | Ref |
|---|---|---|
| S1-07 | Fix session expiry: the proxy treats a present refresh cookie as signed-in and refreshes server-side; Playwright test that idles past the access-token lifetime | B2 |
| S1-08 | `output: "standalone"`; remove the `/api` rewrite (Caddy routes `/api/*` now) | B10 |

### Docker / infra
| ID | Task |
|---|---|
| S1-09 | Backend Dockerfile: multi-stage `uv sync --frozen`, non-root user, `HEALTHCHECK`, no build tools in the final image |
| S1-10 | Frontend Dockerfile: standalone output only, non-root, final image kept lean (Alpine + the Node binary only; ~280 MB uncompressed, of which the Node binary is 124 MB, so the original 250 MB target was dropped) |
| S1-11 | Split compose into `compose.yaml` (base), `compose.dev.yaml` (bind mounts, hot reload, Mailpit, open ports) and `compose.prod.yaml` (GHCR images by `${CAMPUSGRADE_VERSION}`, only the proxy publishes ports) |
| S1-12 | Add **Caddy** (`tls internal`, HSTS/CSP headers, compression, `/api/*` → api, `/*` → web) and **RustFS** (S3-compatible; MinIO no longer publishes container images) plus a one-shot `storage-init` that creates the private bucket with the app's own boto3 client (`backend/scripts/ensure_bucket.py`); prod uses `PRIVATE_STORAGE_BACKEND=s3` against RustFS |
| S1-13 | Prod hardening on every service: non-root, `read_only` + `tmpfs`, `cap_drop: ALL`, `no-new-privileges`, health checks, resource limits, `restart: unless-stopped`, log rotation, `internal: true` backend network |
| S1-14 | Compose secrets from `./secrets/*.txt` (git-ignored) + `scripts\init-secrets.ps1` that generates strong values |
| S1-15 | One-shot `migrate` service; `api` waits for it with `service_completed_successfully` |

### CI/CD
| ID | Task |
|---|---|
| S1-16 | Workflow builds api + web images on every PR, scans them with Trivy (fail on CRITICAL) |
| S1-17 | CI job starts `compose.prod.yaml` with the just-built images and runs the Playwright smoke tests (login, `/api/ready`, create assignment) |
| S1-18 | On `main`: push images to `ghcr.io/devxjitin/campusgrade-{api,web}:<sha>` and `:main` |
| S1-19 | `scripts\deploy.ps1 -Version <tag>` (+ `deploy.sh`): pull → migrate → `up -d --wait` → smoke test; prints the URL |

### Hygiene
| ID | Task | Ref |
|---|---|---|
| S1-20 | Delete clutter: `layout.tsx.bak`, empty `src/hooks`/`src/layouts`, `run_frontend.py`, `dev.js`, `setup.ps1`, Windows re-exec in `main.py`; remove stale `IMPLEMENTATION_PLAN.md`/`ARCHITECTURE.md` references in code comments | B15 |
| S1-21 | Rewrite `README.md` (dev mode, prod mode, deploy, secrets) and `CLAUDE.md`/`AGENTS.md` (cookie auth, `(app)` route group, `features/` layout, `/api` prefix, compose files) | B14 |

Redis is not in the stack: it was already optional, and the old compose file never ran an RQ
worker, so queued analysis jobs would never have been consumed. With no Redis, analysis uses
the existing in-process fallback until the worker arrives in Sprint 2.

**Demo script:** merge a one-line PR → CI publishes images → `scripts\deploy.ps1 -Version v0.1.0`
→ open `https://campusgrade.localhost` → admin creates a teacher and a student → teacher
publishes an assignment → student links a repo → teacher sees the analysis and grades →
leave the tab idle 20 min, reload, still logged in → `docker compose ps` shows everything healthy.

**Exit criteria:** `v0.1.0` deployed from GHCR images; `/api/ready` is 200; the B2 Playwright test
passes; no container runs as root; no port open except 80/443.

---

## Sprint 2 — Reliable background jobs, the architecture fix (weeks 3–4) → `v0.2.0`

**Goal:** the API does only HTTP. All background work runs in a separate `worker`
container with retries and visibility.

**Working feature delivered:** a student pushes a commit and it shows up for the teacher
automatically, with no "Update repository" click. A Super Admin can see and retry failed jobs.

### Backend
| ID | Task | Ref |
|---|---|---|
| S2-01 | Migration: `jobs` table (type, payload, status, attempts, max_attempts, run_after, locked_by, locked_at, last_error, created_at, finished_at) | F1 |
| S2-02 | `enqueue(session, type, payload)`, called inside the caller's transaction (transactional enqueue) | F1 |
| S2-03 | `worker` entrypoint: claims with `FOR UPDATE SKIP LOCKED`, per-job timeout, exponential backoff, `dead` after max attempts, graceful shutdown on SIGTERM | F1 |
| S2-04 | Periodic tasks in the worker under a Postgres advisory lock: publish ready results, finalize deadlines, purge stale sessions, rollover notice, **repo auto-sync** | F2, B4 |
| S2-05 | Make repository analysis fully async on the worker loop; delete `asyncio.run` and the `to_thread`/`BackgroundTasks`/inline fallbacks | B3 |
| S2-06 | Remove the `lifespan` scheduler; delete Redis, RQ, `assignment_worker.py`, `core/redis.py` and the Redis settings | PRD §3, §6.1 |
| S2-07 | Delete the 14 sync/async twin helpers in `assignment_routes.py` now that nothing sync calls them | PRD §3 |
| S2-08 | Postgres-backed rate limiter (login, refresh) shared by all replicas | F7, B6 |
| S2-09 | Super Admin endpoints: list jobs (filter by status/type), retry a dead job | F1 |
| S2-10 | Worker heartbeat; worker health check in compose reads it | PRD §9 |

### Frontend
| ID | Task | Ref |
|---|---|---|
| S2-11 | Submission page: "Last synced 2 min ago · commit `abc123`" and analysis status from the job instead of a spinner | §6.3 |
| S2-12 | Super Admin → **Jobs** page: table, status filter, error detail, Retry button | F1 |

### Docker / CI
| ID | Task |
|---|---|
| S2-13 | `worker` service in all compose files (same image, `python -m worker`), on the internal network plus an egress network for GitHub |
| S2-14 | Remove the `redis` service; prod stack runs **2 api replicas + 1 worker**; Caddy load-balances the api replicas with health checks |
| S2-15 | CI integration tests: a job is retried after the worker is killed mid-run; periodic tasks run exactly once with 2 workers |

**Demo script:** deploy `v0.2.0` → student pushes a commit → within the sync interval the
teacher sees the new commit with no click → `docker compose kill worker` mid-analysis →
it restarts and the job is retried and succeeds → a broken repo URL shows as `dead` on
the Jobs page → Retry.

**Exit criteria:** no background code left in the API process; golden-path tests pass with
2 api replicas; Redis is gone from every compose file.

---

## Sprint 3 — Files, cleanup, backups and releases (weeks 5–6) → `v0.3.0`

**Goal:** fast, safe file handling, a maintainable backend, data that can be recovered,
and a release process with tested rollback.

**Working feature delivered:** attachments and repository archives download directly
from storage, so large files no longer slow the API. Nightly backups run, and any version
can be rolled back with one command.

### Backend
| ID | Task | Ref |
|---|---|---|
| S3-01 | Presigned GET for attachments/archives (5 min), presigned PUT for teacher uploads, via the object store's public endpoint | F4 |
| S3-02 | Move remaining storage calls off the event loop (`to_thread` or `aioboto3`) | B7 |
| S3-03 | Split `assignment_routes.py` into `assignments/`, `submissions/`, `grading/`, `integrity/`, `discussions/`, `external_ai/` (router + service each); no file over 800 lines | B11 |
| S3-04 | Move the live helpers out of `admin_routes.py`; delete the file | B12 |
| S3-05 | Remove dead features: Azure OpenAI client + env vars, the 410 AI-suggestions route, the `assignment_ai_suggestions` table (contract migration), the `AUTH_COOKIE_MODE` fallback | §6.1, B5 |
| S3-06 | Fix all ruff findings; mypy on the whole backend | B13 |

### Frontend
| ID | Task |
|---|---|
| S3-07 | Use presigned URLs for downloads/uploads, with an upload progress bar |
| S3-08 | Regenerate `src/types/api.d.ts`; replace loose `unknown`/`any` request types with generated types in feature `api.ts` files |

### Docker / CI/CD
| ID | Task | Ref |
|---|---|---|
| S3-09 | Caddy routes `/storage/*` → RustFS (presigned requests only, no listing) | F4 |
| S3-10 | `backup` service: nightly `pg_dump` + RustFS bucket mirror, 14 daily / 8 weekly retention, written to a host folder (e.g. `D:\CampusGradeBackups`) outside Docker's disk | F10 |
| S3-11 | `scripts\restore.ps1 -From <backup>`; CI test: seed → back up → wipe → restore → data matches | F10 |
| S3-12 | `deploy.ps1` takes a backup before migrating; `scripts\rollback.ps1` redeploys the previous version; deploy auto-rolls back if smoke tests fail | PRD §8 |
| S3-13 | Release workflow: on tag `vX.Y.Z`, re-tag the tested `:<sha>` images (**done early** in `.github/workflows/release.yml`); still to do: create a GitHub Release with generated notes | PRD §8 |
| S3-14 | Full Playwright e2e suite in CI (login, create assignment, submit, grade, publish); ruff/mypy run on all of `backend/` (delete the file allow-list) | B13 |
| S3-15 | Dependabot for pip, npm, GitHub Actions and Docker base images | PRD §5 |
| S3-16 | Optional: self-hosted GitHub Actions runner on this PC that runs `deploy.ps1` when a release is published | PRD §8 |

**Demo script:** teacher uploads a 20 MB attachment (progress bar) → student downloads it
(the URL is `/storage/…`, not `/api/…`) → tag `v0.3.0` → deploy → deliberately deploy a
broken build → it auto-rolls back → restore last night's backup into a scratch database
and show the data.

**Exit criteria:** the backup/restore CI test passes; rollback was demonstrated; CI is
lint-clean on the whole backend; no backend file over 800 lines.

---

## Sprint 4 — Accounts and email (weeks 7–8) → `v0.4.0`

**Goal:** users can recover their own accounts and get notified without logging in.

**Working feature delivered:** "Forgot password" works end to end by email, and students
get emails when results are published or a deadline is near.

### Backend
| ID | Task | Ref |
|---|---|---|
| S4-01 | Email service over SMTP (Mailpit in dev/CI, provider in prod by config + `smtp_password` secret); plain-text + HTML templates | F3, F6 |
| S4-02 | `POST /api/auth/forgot-password` (always 200, rate limited) → single-use, hashed, 30-min token → email via a worker job | F3 |
| S4-03 | `POST /api/auth/reset-password` → set password, bump `session_version`, revoke all sessions, audit log | F3 |
| S4-04 | Notification jobs: results published, deadline in 24 h (periodic), reply on my discussion thread | F6 |
| S4-05 | Per-type email opt-out in the existing preferences model | F6 |

### Frontend
| ID | Task |
|---|---|
| S4-06 | "Forgot password?" link, request screen, reset screen with a password-strength hint |
| S4-07 | Settings → Notifications: email toggles |

### Docker / CI
| ID | Task |
|---|---|
| S4-08 | Mailpit in `compose.dev.yaml` and the CI stack; prod `compose.prod.yaml` takes SMTP host/port/user from `.env` and the password from secrets |
| S4-09 | CI e2e: forgot → read the mail via Mailpit's API → reset → log in; old session is rejected |

**Demo script:** deploy `v0.4.0` → student clicks "Forgot password" → email appears in
Mailpit (or a real inbox if SMTP is configured) → sets a new password → the old session in
another browser is logged out → teacher publishes results → the student gets an email.

**Exit criteria:** the reset flow e2e test passes in CI; reset tokens are single-use and expire;
emails are sent only by the worker.

---

## Sprint 5 — External-AI flow and UX polish (weeks 9–10) → `v0.5.0`

**Goal:** the human-in-the-loop external-AI workflow is safe and easy to use, and every page
feels finished.

**Working feature delivered:** a teacher runs a bulk external-AI evaluation where students
are pseudonymized in the prompt, sees a per-student diff before saving, and gets clear
errors for bad JSON.

### Backend
| ID | Task | Ref |
|---|---|---|
| S5-01 | Pseudonymize students (`Student-07`) in generated prompts and repo exports; signed mapping restores real IDs on import | S2, F5 |
| S5-02 | Validate imported JSON against the rubric, with per-field error messages (criterion, max marks, missing students) | F5 |
| S5-03 | Preview endpoint: proposal vs. current grade diff, without saving | F5 |
| S5-04 | Super Admin data export: a session's grades + audit log as CSV/XLSX (worker job, presigned download) | F9 |

### Frontend
| ID | Task | Ref |
|---|---|---|
| S5-05 | External-AI dialogs as a stepper: copy prompt → paste JSON → review diff → save | §6.3 |
| S5-06 | Consistent loading/empty/error states on every page (`FeedbackStates`) | §6.3 |
| S5-07 | Accessibility pass on shell, login, submit and grade flows: keyboard navigation, focus rings, contrast, labels (WCAG 2.1 AA) | PRD §9 |
| S5-08 | Mobile check at 360 px for student pages | PRD §9 |

### CI
| ID | Task |
|---|---|
| S5-09 | axe accessibility checks inside Playwright for core flows; fail on serious/critical violations |
| S5-10 | Unit tests: no real student name or roll number ever appears in a generated prompt |

**Demo script:** teacher selects 10 students → copies the prompt (only `Student-01…10`
inside) → pastes the external AI's JSON with one wrong mark → sees a clear error → fixes it →
reviews the diff → saves → grades show real student names again.

**Exit criteria:** zero PII in prompts (test-enforced); axe passes on core flows; `v0.5.0` deployed.

---

## Sprint 6 — Hardening and v1.0.0 (week 11) → `v1.0.0`

**Goal:** the Docker Desktop deployment is proven under load, recoverable, observable,
and ready for real users.

**Working feature delivered:** CampusGrade `v1.0.0`, production-ready on Docker Desktop.

| ID | Task | Ref |
|---|---|---|
| S6-01 | k6 load test against the prod stack: 200 concurrent users at a deadline (submit + sync + dashboard); meets p95 targets | PRD §9 |
| S6-02 | Tune gunicorn workers, Postgres config (`shared_buffers`, `max_connections`), pool sizes and container limits from load-test results | PRD §7.2 |
| S6-03 | Manual restore drill from a real nightly backup into a fresh stack; time it against RTO 1 h | PRD §9 |
| S6-04 | `/api/metrics` + optional `compose.monitoring.yaml` (Prometheus + Grafana) with a dashboard: requests, latency, errors, jobs, DB connections | PRD §5 |
| S6-05 | Security review: OWASP ASVS L2 checklist for auth/session, CSP + HSTS verified, Trivy clean, secrets audit (`git log` + image layers) | PRD §7.3 |
| S6-06 | Docker Desktop resilience check: reboot the PC → the stack comes back healthy on its own | PRD §9 |
| S6-07 | Bootstrap the Super Admin (one-off `docker compose run`); import real programs, teachers and students | — |
| S6-08 | `docs/runbook.md`: deploy, rollback, backup/restore, rotate secrets, retry jobs, read logs, common failures | PRD §8 |

**Exit criteria (v1.0.0):** load-test targets met, restore drill done, runbook merged, the PC
reboot check passed, no open P0/P1 bugs, and the owner signs off.

---

## Traceability: PRD item → sprint

| PRD item | Sprint |
|---|---|
| S1 root lockdown (advisory) | 0 |
| B1, B2, B8, B9, B10, B14, B15, S3, F8, `/api` prefix, Caddy, RustFS, prod compose, CI/CD | 1 |
| B3, B4, B6, F1, F2, F7, Redis/RQ removal | 2 |
| B5, B7, B11, B12, B13, F4, F10, dead-feature removal, releases + rollback | 3 |
| F3, F6 | 4 |
| S2, F5, F9, UI polish, accessibility | 5 |
| NFR verification, monitoring, v1.0.0 | 6 |
| Server / AWS move | after v1.0.0 (PRD Appendix A) |

## Risks

| Risk | Mitigation |
|---|---|
| Docker Desktop runs out of memory with the whole stack | Resource limits per service (PRD §7.2), stack target ≤ 6 GB; S0-01 gives Docker 8 GB |
| A single PC is a single point of failure (power, Windows updates, disk) | Backups copied outside Docker's disk (S3-10); restart policies; PC reboot test (S6-06); Appendix A is the real fix |
| Sprint 2 job refactor breaks the grading publish logic | Golden-path and concurrency tests run before the old scheduler is deleted; keep the old loop behind a flag for one release |
| Route split (S3-03) causes regressions | Pure move first (same behaviour, new files), behaviour changes in later PRs; e2e suite must pass |
| GitHub rate limits during deadline-time auto-sync | Authenticated token, conditional requests (ETag), back off on 403/429, configurable interval |
| Presigned RustFS URLs don't work from the browser | Internal vs. public endpoint split from Sprint 1 (S1-06); e2e test downloads through the proxy |
| Caddy's local certificate isn't trusted by browsers | Trust Caddy's root CA once on this PC (documented in README); real domain → Let's Encrypt |
