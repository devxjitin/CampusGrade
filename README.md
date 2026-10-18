# CampusGrade

**An assignment, GitHub-repository analysis and grading platform for a university.**
Teachers publish assignments with rubrics, students submit a public GitHub repository, the platform snapshots and analyses each submission and flags copied code, and teachers grade against the rubric (optionally with help from an external AI tool) before releasing results.

![CampusGrade sign-in](docs/screenshots/01-login.png)

> Screenshots in this README were captured from a local development stack with seeded demo data (names, repositories and marks are fictional).

## Contents

- [Highlights](#highlights)
- [Product tour](#product-tour)
- [How an assignment moves through the system](#how-an-assignment-moves-through-the-system)
- [Features in detail](#features-in-detail)
- [Roles and permissions](#roles-and-permissions)
- [Architecture](#architecture)
- [Run it locally](#run-it-locally)
- [Run it like production](#run-it-like-production)
- [Tests and checks](#tests-and-checks)
- [Repository layout](#repository-layout)

## Highlights

- **GitHub-native submissions.** Students link one repository per assignment. The newest commit is tracked while the assignment is open, and the repository is downloaded and analysed once, at the deadline or when the teacher starts evaluating. Later pushes do not count.
- **Repository analysis.** File and folder counts, language mix, dependency files, README rendering, commit activity and a browsable snapshot of the exact submitted commit.
- **Similarity and integrity review.** Identical repositories, commits and file contents are flagged automatically, and near-duplicate code above 70 % similarity caps both students at 50 % of the marks until a teacher reviews it.
- **Rubric grading with an AI option that protects student data.** Prompts for an external AI tool never contain names, roll numbers, e-mails or GitHub logins. Students appear as `Student-NN`, and the mapping back lives only in a signed token held by the teacher's browser.
- **Whole-institution structure.** Programs, batches, sections, subjects, academic sessions, end-of-session rollover, per-area admin access levels and a full audit log.
- **Production-minded stack.** Async FastAPI + PostgreSQL, a separate job worker, S3-compatible storage, Caddy with HTTPS, hardened containers, nightly backups with a tested restore, and one-command deploy and rollback.

## Product tour

### Teacher workspace

| Home | Create assignment |
|---|---|
| ![Teacher home](docs/screenshots/02-teacher-home.png) | ![Create assignment wizard](docs/screenshots/03-teacher-create-assignment.png) |
| Workload at a glance: active assignments, assigned students, programs, subjects and what is awaiting review. | A guided 7-step wizard (class and subject, basics, schedule, rubric, results, resources, review) with an optional AI assignment assistant. |

**Review and grade.** Each assignment has a per-student review workspace: overview and language distribution, repository files, rendered README, commit activity, dependencies and rubric grading with per-criterion feedback.

![Rubric grading](docs/screenshots/06-teacher-rubric-grading.png)

**Code similarity report.** Pairs of students whose code overlaps are surfaced at the top of the review page with the similarity score and the system mark limit.

![Code similarity report](docs/screenshots/05-teacher-similarity-report.png)

**External AI evaluation.** A guided four-step flow: copy the prompt, paste the AI's JSON, review a per-criterion diff against the saved grade, then save. Choose *whole class with GitHub links* (one prompt, commit-pinned URLs) or *full files in batches* (anonymised, works with private repositories).

![External AI evaluation dialog](docs/screenshots/04-teacher-external-ai-evaluation.png)

| History and gradebook | Analytics |
|---|---|
| ![Assignment history](docs/screenshots/07-teacher-history.png) | ![Teacher analytics](docs/screenshots/08-teacher-analytics.png) |

### Student workspace

| Home | Submission |
|---|---|
| ![Student home](docs/screenshots/09-student-home.png) | ![Student submission](docs/screenshots/10-student-submission.png) |
| To do, upcoming, awaiting result and results, with a progress donut and a marks chart. | Link the repository once, see sync status and the exact commit analysed, and browse the synchronised files. |

**Feedback.** Once a teacher publishes results, the student sees the total, the marks for each rubric criterion and what was done well or is missing.

![Student feedback](docs/screenshots/11-student-feedback.png)

**Mobile.** Student and teacher screens are responsive and checked at 360 px with axe accessibility tests.

| Home on a phone | Assignment on a phone |
|---|---|
| ![Mobile home](docs/screenshots/12-mobile-student-home.png) | ![Mobile assignment](docs/screenshots/13-mobile-student-assignment.png) |

### Administration

<details open>
<summary><strong>Admin: people and academic structure</strong></summary>

| Students directory | Batches |
|---|---|
| ![Admin students](docs/screenshots/14-admin-students.png) | ![Admin batches](docs/screenshots/15-admin-batches.png) |

</details>

<details open>
<summary><strong>Super Admin: programs, sessions and oversight</strong></summary>

| Programs | Academic sessions |
|---|---|
| ![Programs](docs/screenshots/16-super-programs.png) | ![Academic sessions](docs/screenshots/17-super-academic-sessions.png) |

| Session rollover | All assignments |
|---|---|
| ![Session rollover](docs/screenshots/18-super-session-rollover.png) | ![All assignments](docs/screenshots/19-super-all-assignments.png) |

**Assignment oversight.** Rankings, average and highest marks, per-student status, plus audited governance controls (lock submissions, archive, delete).

![Assignment oversight](docs/screenshots/20-super-assignment-oversight.png)

</details>

<details open>
<summary><strong>Super Admin: platform operations</strong></summary>

| Administrators and access levels | Background jobs |
|---|---|
| ![Administrators](docs/screenshots/21-super-administrators.png) | ![Background jobs](docs/screenshots/22-super-background-jobs.png) |

| Data exports | Audit log |
|---|---|
| ![Data exports](docs/screenshots/23-super-data-exports.png) | ![Audit log](docs/screenshots/24-super-audit-log.png) |

</details>

## How an assignment moves through the system

```mermaid
flowchart LR
    A[Teacher creates assignment<br/>rubric, schedule, class] --> B[Students link a GitHub repository]
    B --> C[Newest commit tracked<br/>while the assignment is open]
    C --> D{Deadline passes or<br/>teacher starts evaluating}
    D --> E[Worker downloads and analyses<br/>the repository once, then freezes it]
    E --> F[Similarity and integrity checks]
    F --> G[Teacher grades by rubric<br/>manually or via external AI import]
    G --> H[Teacher publishes results]
    H --> I[Student sees marks and feedback<br/>e-mail notification]
```

## Features in detail

### Assignments
- Targeted at a program, batch, section and subject; published with open and due dates, optional late window and a manual or scheduled result release.
- Markdown instructions (including Mermaid and TeX), learning outcomes, tags, starter repository, attachments and a weighted rubric.
- Announcements per assignment, in-app notifications and optional e-mail (per-type opt-outs in Settings).
- Teachers can validate their own assignment JSON, or use the AI assistant to draft the brief and rubric.

### Repository submissions and analysis
- One permanent repository link per student per assignment, with a manual **Update repository** check.
- Analysis of the frozen commit: files, folders, size, languages, declared dependencies, README, branches, contributors and recent commits.
- Secrets in submitted code are redacted before fingerprints are computed.
- Submissions are frozen per student when evaluation starts, or for everyone at the deadline.

### Similarity and integrity
- Flags for the same repository, same commit, identical content, high file overlap and code similarity (fingerprint based).
- Code similarity above 70 % applies an automatic 50 % mark limit to both students; teachers review and decide.

### Grading and results
- Rubric scores with *what was done well* and *what is missing* per criterion, late-submission markers and missing-work handling.
- Grades are drafts until published, with a revision history; results can be withdrawn with a reason.
- Gradebook CSV export per assignment, and a Super Admin session export (grades plus audit log as a ZIP, built by the worker).

### External AI evaluation (human in the loop)
- There is no in-app model call. The teacher copies a generated prompt into an institution-approved AI tool and pastes the JSON back.
- Prompts use pseudonyms (`Student-NN`) and a random batch reference; names, roll numbers, e-mails and GitHub logins are scrubbed from file contents too.
- Import validation lists every problem per field and shows a per-criterion diff against the saved grade. Nothing is written until the teacher saves.
- *Links mode* lets browsing-capable AI tools open commit-pinned GitHub links for the whole class. It is not anonymous (links name the repository owner) and the UI says so.

### Academic administration
- Programs, batches, sections, subjects, teachers, students (bulk import with validation) and teaching allocations.
- Academic sessions with a single current session, a switcher in the top bar and an undoable end-of-session **rollover** that carries students, repeaters and allocations forward.
- Admin accounts with per-area access (*view*, *edit* or *full*) for batches, sections, subjects, users, assignments and the audit log.

### Operations
- Postgres-backed job queue and periodic tasks in a separate worker (repository analysis, e-mail, deadline reminders, publishing, cleanup), with retries, backoff and a dead-job list a Super Admin can retry.
- Health (`/health`) and readiness (`/ready`) endpoints, structured logs, request rate limiting on sign-in and a full audit trail.

## Roles and permissions

| Role | Can do |
|---|---|
| **Super Admin** | Everything: creates administrators and sets their access levels, sessions and rollover, background jobs, data exports, audit log. |
| **Admin** | Manages the areas granted by a Super Admin (batches, sections, subjects, users, assignments, audit log) at *view*, *edit* or *full* level. |
| **Teacher** | Creates assignments and rubrics for their allocated classes, reviews repositories, grades, publishes results. |
| **Student** | Links a repository, checks sync status, sees published marks and feedback. |

Authorisation is enforced server-side by a policy engine (`backend/core/policy.py`) and mirrored in the UI (`frontend/src/lib/permissions.ts`).

## Architecture

```mermaid
flowchart TB
    Browser --> Caddy[Caddy<br/>HTTPS, security headers]
    Caddy -->|/api/*| API[FastAPI x2<br/>gunicorn + uvicorn]
    Caddy -->|everything else| Web[Next.js standalone]
    Web -->|server-side calls| API
    API --> PG[(PostgreSQL 16)]
    API --> S3[(S3-compatible storage<br/>RustFS)]
    Worker[Worker<br/>jobs and periodic tasks] --> PG
    Worker --> S3
    Worker --> SMTP[SMTP / Mailpit]
    Worker --> GH[GitHub]
    Backup[Backup service] --> PG
    Backup --> S3
```

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2 (async), Alembic, Pydantic v2 |
| Database | PostgreSQL 16 (also the job queue and rate-limit store) |
| Storage | S3-compatible object storage (RustFS locally, AWS S3 compatible), private presigned downloads |
| Frontend | Next.js (App Router), React 19, TypeScript, Tailwind CSS v4, TanStack Query, Recharts |
| Auth | httpOnly cookie JWT (short-lived access plus rotating refresh), double-submit CSRF token, per-session revocation |
| Packaging | Docker Compose, Caddy reverse proxy, hardened non-root images with read-only filesystems |
| Quality | pytest (with Testcontainers), mypy, ruff, ESLint, Vitest, Playwright and axe |

> **Sign-in note.** Accounts currently sign in with an e-mail address only (no passwords). Because of that, the backend refuses to start with `APP_ENV=production` until a real verification step exists. Use the development and local stacks until then.

## Run it locally

Requirements: Docker Desktop (4 CPUs, 8 GB RAM, 60 GB disk recommended) with Compose v2, PowerShell on Windows, and for development outside Docker Python 3.12 with [uv](https://docs.astral.sh/uv/) and Node 22.

> The Docker Compose definitions (`compose*.yaml`) are maintained locally and are not published in this repository, so the Docker commands below assume you have them in the project root.

```powershell
scripts\init-secrets.ps1                 # once: generates ./secrets/*.txt (git-ignored)
scripts\dev-local.ps1                    # Postgres in Docker, API, worker and web as local processes
```

- App: http://localhost:3000, API: http://localhost:5001 (interactive docs at `/docs`).
- `scripts\dev-local.ps1 -Status` shows what is running and `-Stop` stops it. Logs are in `.local\logs`.
- Create the first Super Admin with `scripts\bootstrap-admin.ps1`, or the Docker equivalent:

```powershell
docker compose -f compose.yaml -f compose.dev.yaml run --rm -e BOOTSTRAP_ADMIN_EMAIL=you@example.com api python bootstrap_admin.py
```

### Demo data

`backend/seed_dev.py` seeds temporary demo data: programs, batches, sections, subjects, teachers, students and one limited admin, all under `@seed.campusgrade.dev` addresses. It is safe to run twice and `--remove` deletes everything it created. Never run it against real data.

```powershell
cd backend
python seed_dev.py            # create
python seed_dev.py --remove   # delete
```

## Run it like production

The production stack runs the same images behind Caddy with HTTPS and hardened containers.

```powershell
scripts\init-secrets.ps1                         # once
scripts\deploy.ps1 -Version v0.1.0               # pulls ghcr.io/devxjitin/campusgrade-{api,web}:v0.1.0
scripts\bootstrap-admin.ps1                      # once: first Super Admin
scripts\trust-caddy-ca.ps1                       # once: let your browser trust the local certificate
```

Open https://campusgrade.localhost. `deploy.ps1` backs up the database, runs migrations as a one-shot container, starts everything, smoke-tests `/api/ready` and the login page, and redeploys the previous version if anything fails. `scripts\rollback.ps1` redeploys the previous version (the schema is not downgraded). On Linux use `scripts/deploy.sh`.

To deploy locally built images instead of pulling:

```powershell
docker build -f backend/Dockerfile  -t ghcr.io/devxjitin/campusgrade-api:local-test .
docker build -f frontend/Dockerfile -t ghcr.io/devxjitin/campusgrade-web:local-test .
scripts\deploy.ps1 -Version local-test -NoPull
```

### Configuration and secrets

- Non-secret settings: copy `.env.prod.example` to `.env.prod` (git-ignored) and edit (address, TLS mode, tuning).
- Secrets live only in `secrets/*.txt`, generated by `scripts\init-secrets.ps1` and mounted into containers at `/run/secrets`. Back this folder up: losing `secret_key` signs every user out and losing the database password locks you out of the data.
- To serve a real domain set `SITE_ADDRESS`, `ALLOWED_ORIGINS`, `PRIVATE_S3_PUBLIC_ENDPOINT` and `CADDY_TLS=<your email>` in `.env.prod`; Caddy then obtains a Let's Encrypt certificate.
- Set a GitHub token with `scripts\init-secrets.ps1 -GithubToken <token>` to avoid GitHub's low anonymous rate limit. For e-mail, set `SMTP_*` (development uses Mailpit at http://localhost:8025).

### Backups

A `backup` service writes a nightly `pg_dump` and object-storage copy to `BACKUP_DIR` (14 daily and 8 weekly kept). Restore with `scripts\restore.ps1 -From <backup>`; add `-ScratchDb <name>` to restore into a scratch database first. The round trip is exercised by `scripts/test-backup-restore.sh`.

### Known limitations on Docker Desktop

- **Client IP:** Docker Desktop on Windows NATs published ports, so the API may see the Docker gateway address instead of the real browser address and login rate limiting is shared across clients. A Linux host does not have this problem.
- **Single machine:** if this PC is off, CampusGrade is off. Restart policies cover container restarts and reboots, not hardware failure. PRD Appendix A describes moving to a server or AWS.

## Tests and checks

Everything runs locally; there is no hosted CI.

```powershell
scripts\check-local.ps1            # ruff, mypy, pytest, eslint, tsc, vitest, API types freshness
scripts\check-local.ps1 -Quick     # skip pytest
scripts\test-e2e-local.ps1         # full Playwright suite incl. axe, on a throwaway Docker stack
```

Or by hand:

```powershell
$env:SECRET_KEY = "any-unique-value-of-at-least-32-characters"
uv sync
uv run pytest backend/tests          # DB-backed tests need Docker (testcontainers)
uv run mypy
cd frontend; npm ci; npm run lint; npx vitest run; npm run build
```

End-to-end details: [frontend/e2e/README.md](frontend/e2e/README.md).

## Repository layout

| Path | What |
|---|---|
| `backend/` | FastAPI app (`routes_fastapi/`, `services/`, `models/`, `schemas/`, `worker/`), Alembic migrations, tests, `Dockerfile` |
| `frontend/` | Next.js app (`src/app` routes, `src/features/<domain>` components, queries and API clients), Playwright tests, `Dockerfile` |
| `docker/` | Caddy configuration, backup image |
| `scripts/` | Secrets, local dev, deploy, rollback, backup and restore, bootstrap-admin, checks |
| `docs/screenshots/` | Images used in this README |
| `PRD.md` | Requirements, known issues and target architecture |
| `secrets/` | Generated secret files (git-ignored) |

## Repository synchronisation

Students link one public GitHub repository per assignment. While the assignment is open, the periodic sync and the student's **Update repository** button only record the newest commit, so students can push as often as they like and nothing is downloaded. When the deadline passes, or when a teacher starts evaluating a student (allowed at any time), the worker downloads and analyses that commit once and freezes the submission, so later pushes do not count.
