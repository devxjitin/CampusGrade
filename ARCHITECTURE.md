# CampusGrade — Target Architecture

**Status:** proposed
**Date:** 2026-07-25
**Scope:** SOET (School of Engineering and Technology) only. One department, one institution.
**Stakeholders:** Super Admin, Program Admin, Teacher, Student.
**AI:** all AI work is done by an external provider. No self-hosted models, no embeddings, no vector DB.

This document replaces ad-hoc plans (`MIGRATION_PLAN.md`, `PLAN_CAMPUSGRADE_CHANGES.md`,
`PLAN_ACADEMIC_SESSIONS_AND_BATCHES.md`). Those describe how we got here. This one
describes where we go.

---

## Part 1 — What is wrong today

These are not opinions. Each item was checked against the code.

### 1.1 The admin router package is fake

`routes_fastapi/admin/` looks modular. It is not. Four of its eight files are three-line
shims:

```python
# routes_fastapi/admin/batches.py — the whole file
from routes_fastapi import admin_routes as legacy
router.add_api_route("/batches", legacy.get_batches, methods=["GET"])
```

The real code stays in `admin_routes.py` — **2,606 lines**, holding users, imports,
departments, programs, batches, sections and subjects together.

Worse: `admin/departments.py` has its *own* full copy of department CRUD, with its own
`_admin` guard, while `admin_routes.py` lines 1503–1633 has another copy with
`require_admin`.

And here is the trap. `admin_routes.py` declares `router = APIRouter(tags=["admin"])` and
decorates **30 endpoints** on it — but that router is **never included in `app.py`**.
Only the shim package is mounted, and it re-registers 28 of those functions by hand.

So `admin_routes.py`'s department endpoints are **dead code wearing live decorators**.
They read as working HTTP routes. They are not reachable. Anyone reading the file to fix
a department bug will edit the wrong copy. Two of the 30 decorated endpoints are silently
unreachable with nothing to tell you which.

### 1.2 Two database layers, one database

`models/database.py` builds **two engines** against the same Postgres:

- sync `engine` + `SessionLocal` — used by every route
- async `async_engine` + `get_db()` — used by **zero** routes

So the app holds two connection pools, and the "new code uses async" comment has never
been true. Meanwhile every route repeats this by hand:

```python
db = SessionLocal()
try:
    ...
finally:
    db.close()
```

No dependency injection, no transaction boundary, no rollback on error.

### 1.3 Identity is a dict, not a type

`models/auth_store.py` turns a `SqlUser` row into a hand-written dict with a `_id` key —
a leftover from MongoDB. Every request re-queries the user and hands routes an untyped
`dict`. Route code then does `teacher.get("assignments")` with no type safety and no
schema. `get_user_by_id` also opens its own session on **every single request**.

### 1.4 The same fact is stored in three places

| Fact | Stored in | Also stored in | Also in |
|---|---|---|---|
| Teacher's teaching load | `users.assignments` (JSON blob) | `teacher_session_allocations` table | — |
| Student's year/semester | `users.year`, `users.semester` | `student_session_records` table | — |
| Student's program | `users.course` (free text) | `users.course_id` (FK) | — |
| Student's batch | `users.batch` (free text) | `users.batch_id` (FK) | — |
| Student's department | `users.department` (free text) | `courses.department_id` | — |

The code comments admit it: the table is a "mirror", the JSON is "the source every
existing screen reads from". Dual writes always drift.

The cost is visible in `admin/departments.py`, which counts students by **fuzzy string
matching** on free-text names because it cannot trust the foreign keys:

```python
candidate = names.get(legacy._normalize_lookup_text(department), set())
if len(candidate) != 1:
    candidate = aliases.get(legacy._normalize_lookup_text(course), set())
```

A student count should be a `COUNT(*)` with a `WHERE`, not alias matching.

### 1.5 There is no Super Admin and no Program Admin

The whole system knows three roles: `admin`, `teacher`, `student`. `require_admin` is
global — any admin can do anything, everywhere. There is no way to say "this admin only
manages B.Tech CSE".

Adding scoped admins to the current design means editing every one of ~60 admin endpoints
by hand.

### 1.6 `users` is a god table

One table, 30+ columns: login fields, lockout fields, student fields, teacher fields,
profile fields, and three JSON blobs. A teacher row carries `roll_no`, `semester` and
`batch_id` as dead NULLs. A student row carries `designation` and `teacher_id` as dead
NULLs.

### 1.7 "Single department" is a boot-time hack

`app.py` calls `_seed_soet_department()` on every startup to make sure one row exists.
But `departments` is still a real table with full CRUD exposed over HTTP, and
`subjects.department_id` is still nullable. The single-department rule lives in a startup
function, not in the schema.

### 1.8 The assignment router is a second god file

`routes_fastapi/assignment_routes.py` is **1,921 lines** and 50 endpoints. It contains
teacher CRUD, student submission, GitHub repository sync, plagiarism similarity, grading,
grade publishing, discussions, announcements, analytics, admin tools and the external AI
flow. Functions are 100+ characters wide with multiple statements per line.

### 1.9 AI has three overlapping paths

1. `ai/assignment_ai.py` — direct Azure OpenAI calls over `urllib`. Its **private**
   functions (`_azure_openai_config`, `_invoke_prompt_with_timeout`,
   `_extract_json_payload`) are imported straight into `assignment_routes.py`.
2. A manual copy-paste flow — build a prompt, teacher pastes it into an external chat,
   pastes JSON back, server validates it against a signed batch token.
3. `assignment_ai_suggestions` table — a third, queued path.

There is one provider hardcoded, no record of what was sent, no cost tracking, and
student names + roll numbers are sent to the provider in plain text
(`render_prompt` in `services/assignment_external_evaluation.py`).

### 1.10 Background work runs in three runtimes

- an `asyncio` loop inside the API process (`lifespan` in `app.py`)
- FastAPI `BackgroundTasks`
- an RQ worker (`assignment_worker.py`)

`enqueue_repository_analysis` falls through all three: try RQ → else BackgroundTasks →
else run it inline on the web request. Three failure modes, no visibility, no retries in
two of them. And the in-process loop means you cannot run more than one API replica
safely.

### 1.11 Frontend cannot use the server

The access token lives in `localStorage`. Next.js server components and `middleware.ts`
cannot read it. So:

- every protected page is a client component
- role checks are client-side only (`AuthGate`) — cosmetic, not security
- no server rendering of real data anywhere

The route-group layout is empty of chrome — `(dashboard)/layout.tsx` only wraps
`AuthGate`. So **21 of 31 pages each import and render `DashboardLayout` themselves**.
That means on every navigation the sidebar, topbar and notification bell are torn down
and rebuilt, and `getAcademicSessions()` + `getNotifications()` are re-fetched. Layout
state cannot survive a route change, because there is no shared layout.

Page files reach 1,315 lines (`admin/students/page.tsx`) and 1,335 lines
(`AssignmentDashboardView.tsx`). `useAcademicStructure.ts` (119 lines) is the only
TanStack Query hook; everything else calls axios directly from components.
`npm run gen:types` is configured but `src/types/` does not exist at all, so the
frontend is untyped against the API.

### 1.12 Migration thrash

20 Alembic migrations in 7 days, several undoing earlier ones
(`05_remove_linkedin_skills`, `06_remove_account_username`,
`08_remove_assignment_drafts`). This is what happens when there is no agreed model.

### 1.13 No test safety net

7 backend test files, mostly around security helpers and imports. No test suite on the
frontend at all. No CI gate.

---

## Part 2 — Design rules

Everything below follows from six rules.

1. **One fact, one place.** No mirrors, no "compatibility" columns, no JSON blobs holding
   relational data.
2. **SOET is a constant, not a row.** Department is dropped from the schema.
3. **Authorization is data, not `if` statements.** One permission matrix, one scope
   resolver, applied by a dependency — never re-checked per route.
4. **Thin routers.** A router validates input, calls one service function, returns a
   schema. Business logic never lives in a router.
5. **AI is a gateway with a ledger.** Every external AI call goes through one module, is
   recorded, is pseudonymised, and produces a *proposal* that a human confirms.
6. **The server owns the session.** httpOnly cookies, so Next.js middleware and server
   components can do real work.

---

## Part 3 — Roles and permissions

### 3.1 The four roles

| Role | Scope | Cannot |
|---|---|---|
| `super_admin` | All of SOET | — |
| `program_admin` | One or more programs | Create sessions, run rollover, create admins, change global settings |
| `teacher` | Their subject offerings | See other teachers' assignments or students |
| `student` | Their own enrollments | See other students |

Scope is stored, not guessed:

```
admin_program_scopes(user_id, program_id)
```

A `super_admin` has no rows and is treated as "all programs". A `program_admin` with zero
rows can see nothing — a safe default.

### 3.2 The Principal

One dependency builds one object per request, from a single query:

```python
@dataclass(frozen=True)
class Principal:
    user_id: str
    role: Role
    status: UserStatus
    session_id: str
    program_ids: frozenset[str] | AllPrograms   # admins
    offering_ids: frozenset[str]                # teachers
    student_id: str | None                      # students
```

Routes depend on `Principal`, never on a dict.

### 3.3 The permission matrix

A table, checked in one place (`core/policy.py`):

| Permission | super_admin | program_admin | teacher | student |
|---|---|---|---|---|
| `session.manage` | ✅ | — | — | — |
| `rollover.execute` | ✅ | — | — | — |
| `program.manage` | ✅ | — | — | — |
| `admin.manage` | ✅ | — | — | — |
| `settings.manage` | ✅ | — | — | — |
| `batch.manage` | ✅ | scoped | — | — |
| `section.manage` | ✅ | scoped | — | — |
| `subject.manage` | ✅ | scoped | — | — |
| `offering.manage` | ✅ | scoped | — | — |
| `user.manage` | ✅ | scoped | — | — |
| `assignment.create` | — | — | own offering | — |
| `assignment.grade` | — | — | own offering | — |
| `grade.publish` | — | — | own offering | — |
| `integrity.review` | ✅ | scoped (read) | own offering | — |
| `ai.evaluate` | — | — | own offering | — |
| `submission.create` | — | — | — | own |
| `report.view` | ✅ all | scoped | own offering | own |
| `audit.view` | ✅ | scoped (read) | — | — |

"scoped" means the query is filtered by `program_id ∈ principal.program_ids`. That filter
is applied by a shared query helper, not by hand in each endpoint:

```python
stmt = scope_to_programs(select(Batch), principal, Batch.program_id)
```

Note that admins **do not grade**. They oversee. This keeps the audit trail clean and is
a change from today, where admin tooling can reassign and act on assignments.

---

## Part 4 — Database design

Postgres 16. All ids are UUIDv7 (`uuid` column type, time-ordered — good index locality).
All timestamps are `timestamptz` stored in UTC. No naive datetimes anywhere — this fixes
the current `utcnow().replace(tzinfo=None)` pattern and the
`20260722_09_normalize_assignment_schedule_utc` class of bug.

### 4.1 Naming fix

Today the table `courses` means *program* (B.Tech CSE) and `subjects` means *course*
(Data Structures). The UI already says "Programs". The teacher allocation payload already
says `program_id` but points at `courses.id`. Fix the names:

| Old | New | Meaning |
|---|---|---|
| `courses` | `programs` | B.Tech CSE, BCA, M.Tech |
| `subjects` | `subjects` | Data Structures, DBMS |
| `departments` | *dropped* | SOET is a constant |
| `institutions` | *dropped* | single institution |

### 4.2 Identity

```sql
users
  id                uuid pk
  email             citext unique not null
  password_hash     text not null
  role              user_role not null           -- enum: super_admin|program_admin|teacher|student
  status            user_status not null         -- enum: active|suspended|archived
  must_change_password  boolean not null default false
  session_version   int not null default 0
  failed_attempts   int not null default 0
  locked_until      timestamptz
  last_login_at     timestamptz
  created_by        uuid references users(id) on delete set null
  created_at, updated_at

user_profiles                     -- 1:1, shared human fields
  user_id           uuid pk references users(id) on delete cascade
  full_name         text not null
  phone             text
  avatar_key        text
  bio               text
  github_username   text

student_profiles                  -- 1:1, only for students
  user_id           uuid pk references users(id) on delete cascade
  roll_no           text unique not null
  program_id        uuid not null references programs(id)
  admission_year    int not null
  enrollment_status student_status not null      -- active|repeating|on_leave|dropped|graduated

teacher_profiles                  -- 1:1, only for teachers
  user_id           uuid pk references users(id) on delete cascade
  employee_code     text unique not null
  designation       text

admin_program_scopes              -- program_admin only
  user_id           uuid references users(id) on delete cascade
  program_id        uuid references programs(id) on delete cascade
  primary key (user_id, program_id)

auth_sessions                     -- refresh tokens / devices
  id                uuid pk
  user_id           uuid not null references users(id) on delete cascade
  token_hash        text not null unique
  user_agent, ip_hash
  issued_at, last_used_at, expires_at, revoked_at
```

Gone: `users.course`, `users.batch`, `users.department`, `users.year`, `users.semester`,
`users.assignments`, `users.achievements`, `users.github_repositories`,
`users.leetcode_username`, `users.teacher_id`, `users.roll_no`.

A partial unique index guarantees the system is never left without an owner:

```sql
create unique index one_super_admin_min
  on users (role) where role = 'super_admin' and status = 'active';
-- enforced in service layer instead if more than one super admin is wanted
```

(In practice: enforce "at least one active super_admin" in the service layer, which is
what `_assert_admin_continuity` tries to do today.)

### 4.3 Academic structure

```sql
programs
  id, code unique, name, degree_type, duration_years, total_semesters,
  is_active, created_at, updated_at

academic_sessions
  id, code unique          -- '2026-27-ODD'
  label, term              -- 'odd' | 'even'
  starts_on, ends_on       -- date
  state                    -- planned | active | closed
  create unique index one_active_session on academic_sessions (state)
    where state = 'active';

batches
  id, program_id fk, admission_year, graduation_year, label,
  state                    -- upcoming | active | completed
  unique (program_id, admission_year)

sections
  id, batch_id fk, name, capacity
  unique (batch_id, name)
  -- program_id is NOT stored: it is reachable through batch

subjects
  id, program_id fk, code, name, semester int, credits int,
  kind                     -- core | elective
  unique (program_id, code)

subject_offerings           -- ⭐ the central table
  id
  session_id  fk academic_sessions
  subject_id  fk subjects
  section_id  fk sections
  teacher_id  fk users
  state                    -- planned | running | closed
  unique (session_id, subject_id, section_id)
  index (teacher_id, session_id)

enrollments
  id, offering_id fk, student_id fk,
  state                    -- enrolled | dropped | completed
  unique (offering_id, student_id)

student_terms               -- per-session snapshot, single source of truth
  id, student_id fk, session_id fk,
  batch_id fk, section_id fk, study_year int, semester int,
  status                   -- active | repeating | on_leave | dropped | graduated
  is_manual_override bool, rollover_run_id fk
  unique (student_id, session_id)

rollover_runs
  id, from_session_id, to_session_id, executed_by, executed_at,
  counts jsonb, undone_at
```

**`subject_offerings` is the fix for four problems at once.** It replaces
`users.assignments` (JSON), `teacher_session_allocations` (mirror table), and the
`target_course_id` / `target_batch_id` / `target_section_id` triple on assignments. One
row answers: which teacher, which subject, which section, which session.

Teacher authorization becomes a join, not a JSON scan:

```sql
select 1 from subject_offerings
where id = :offering_id and teacher_id = :principal_user_id
```

### 4.4 Assignments

```sql
assignments
  id
  offering_id     fk subject_offerings not null   -- gives teacher+subject+section+session
  title, brief_md, short_description
  difficulty, estimated_minutes
  submission_kind                 -- repository | file | text
  total_marks numeric(6,2)
  learning_outcomes jsonb, tags text[]
  opens_at, due_at timestamptz
  late_policy                     -- none | until | penalty
  late_until timestamptz, late_penalty_percent numeric
  state                           -- draft | scheduled | open | closed | evaluating | published | archived
  results_release                 -- manual | on_due | at_time
  results_release_at timestamptz
  created_by, created_at, updated_at
  index (offering_id, state), index (due_at)

assignment_rubric_criteria
  id, assignment_id fk, position, title, description, max_marks
  unique (assignment_id, position)

assignment_attachments
  id, assignment_id fk, kind, label, storage_key, filename,
  content_type, size_bytes, position

assignment_state_events          -- replaces 8 lock/publish timestamp columns
  id, assignment_id fk, from_state, to_state, actor_id, reason, occurred_at
```

Today `assignments` carries `submission_locked_at/by/reason`,
`evaluation_locked_at/by/trigger`, `repository_fetch_started_at/by`,
`repository_fetch_completed_at`, `results_published_at/by` — 11 columns that are really
one state machine with an event log. `assignment_state_events` replaces them and gives a
full history for free.

### 4.5 Submissions

```sql
submissions
  id, assignment_id fk, student_id fk,
  state                            -- draft | submitted | frozen | withdrawn
  current_version_id, frozen_version_id
  first_submitted_at, last_submitted_at
  unique (assignment_id, student_id)

submission_versions               -- immutable
  id, submission_id fk, sequence int,
  source                           -- student | teacher_sync | system
  submitted_at, is_late bool, seconds_late int,
  content_digest text,
  archive_key, manifest_key
  unique (submission_id, sequence)

repository_links                  -- repo fields OUT of submissions
  submission_id pk fk
  provider                         -- github
  owner, name, default_branch, url
  generation int
  sync_state                       -- idle | syncing | ready | error
  latest_remote_sha, last_checked_at, next_check_at,
  error_message, failure_count

repository_snapshots              -- per version, repo-specific
  version_id pk fk submission_versions
  commit_sha, commit_message, commit_at,
  file_count, total_bytes, language_stats jsonb,
  readme_md, analysis_state, analysis_error
```

Today `assignment_submissions` has 12 repository columns mixed with submission state. If
a file-upload assignment is added, those are all NULL. Splitting them means a new
submission kind does not touch the core table.

### 4.6 Grading

```sql
grades
  id, assignment_id fk, student_id fk, version_id fk,
  total_awarded numeric(6,2),
  source                           -- manual | ai_assisted | system_missing
  state                            -- draft | ready | published | withdrawn
  revision int not null default 1
  evaluated_by, evaluated_at, published_at, withdrawn_at, withdrawal_reason
  unique (assignment_id, student_id)

grade_criterion_scores            -- replaces the rubric_scores JSON blob
  id, grade_id fk, criterion_id fk,
  awarded numeric(6,2),
  strengths_note text,
  gaps_note text
  unique (grade_id, criterion_id)

grade_revisions
  id, grade_id fk, action, snapshot jsonb, actor_id, reason, created_at
```

Moving `rubric_scores` out of JSON into rows makes per-criterion analytics a `GROUP BY`
instead of application-side JSON parsing. "Average marks on criterion 3 across the batch"
becomes one query.

### 4.7 Integrity

```sql
similarity_pairs
  id, assignment_id fk,
  left_version_id fk, right_version_id fk,
  method                            -- same_repo | same_commit | identical_content | code_fingerprint
  score numeric(4,3)
  unique (assignment_id, left_version_id, right_version_id, method)
  check (left_version_id < right_version_id)   -- store each pair once

similarity_reviews
  id, pair_id fk, decision,         -- pending | confirmed | dismissed
  reviewed_by, reviewed_at, notes
```

The `check` constraint removes today's possibility of storing (A,B) and (B,A) as two
different flags.

### 4.8 AI ledger

```sql
ai_runs                           -- one row per external AI call
  id
  purpose                          -- draft_assignment | draft_rubric | grade_proposal | feedback_polish
  assignment_id, offering_id, requested_by
  provider, model, transport       -- api | manual_export
  prompt_hash, prompt_token_estimate
  request_payload_key              -- object storage, not the DB
  response_payload_key
  status                           -- pending | succeeded | failed | rejected
  latency_ms, input_tokens, output_tokens, cost_micros
  error_code, error_message
  created_at, completed_at

ai_grade_proposals
  id, run_id fk, assignment_id, student_id, version_id,
  proposed_total numeric,
  confidence numeric,
  needs_review text[],
  state                            -- proposed | accepted | edited | rejected
  decided_by, decided_at
  unique (run_id, student_id)

ai_grade_proposal_scores
  id, proposal_id fk, criterion_id fk, awarded, strengths_note, gaps_note

ai_budgets
  scope_type, scope_id,            -- global | program | user
  window                           -- day | month
  max_runs int, max_cost_micros bigint
```

Nothing here can publish a grade. A proposal must be accepted by a teacher, which writes
a normal `grades` row with `source = 'ai_assisted'` and links the run id.

### 4.9 Platform

```sql
notifications      id, user_id, kind, title, body, action_url,
                   dedupe_key, is_read, read_at, created_at
audit_events       id, actor_id, actor_role, action, entity_type, entity_id,
                   program_id, before jsonb, after jsonb, ip_hash,
                   request_id, occurred_at
jobs               id, kind, payload jsonb, run_after, attempts, max_attempts,
                   state, locked_by, locked_until, last_error, created_at
app_settings       key pk, value jsonb, updated_by, updated_at
```

`audit_events` gains `program_id` so a program admin can read the audit trail for their
own programs only.

`jobs` is a transactional outbox. Work is enqueued **in the same transaction** as the
change that caused it, so a job is never lost and never fires for a rolled-back change.

### 4.10 Views to keep queries simple

```sql
create view v_offering_context as
select o.id as offering_id, o.session_id, o.teacher_id,
       s.id as subject_id, s.name as subject_name, s.semester,
       sec.id as section_id, sec.name as section_name,
       b.id as batch_id, b.admission_year,
       p.id as program_id, p.code as program_code
from subject_offerings o
join subjects s   on s.id = o.subject_id
join sections sec on sec.id = o.section_id
join batches b    on b.id = sec.batch_id
join programs p   on p.id = b.program_id;
```

Every scoping filter in the app resolves through this view. Program admins filter on
`program_id`, teachers on `teacher_id`, students through `enrollments`.

---

## Part 5 — Backend architecture

### 5.1 Layout

```
backend/
  app/
    main.py                  # ASGI assembly ONLY: middleware + routers. ~60 lines.
    config.py                # pydantic-settings. Typed. Fails fast on bad env.
    lifespan.py              # db check, storage check, no scheduler loop
    core/
      db.py                  # ONE async engine, ONE session dependency
      security.py            # argon2 hashing, JWT encode/decode
      principal.py           # Principal + build_principal()
      policy.py              # permission matrix + require(permission)
      scoping.py             # scope_to_programs(), scope_to_offerings()
      errors.py              # AppError -> RFC 9457 problem+json
      pagination.py          # cursor pagination helper
      audit.py               # record() called from services
      storage.py             # PrivateObjectStorage (local | s3)
    domain/
      identity/              # users, auth, sessions, profiles, admin scopes
      academics/             # programs, sessions, batches, sections, subjects,
                             # offerings, enrollments, rollover
      assignments/           # assignment, rubric, attachments, state machine
      submissions/           # submission, versions, repository sync
      grading/               # grades, criterion scores, publishing, gradebook
      integrity/             # similarity detection and review
      aiservices/            # gateway, providers, prompts, runs, proposals
      collaboration/         # announcements, threads, notifications
      reporting/             # analytics and exports
    workers/
      runner.py              # single job runner process
      handlers/              # one module per job kind
    migrations/
  tests/
    unit/  integration/  e2e/
```

Every `domain/<name>/` has the same five files:

| File | Rule |
|---|---|
| `router.py` | Thin. Validates, calls one service function, returns a schema. Max ~200 lines. |
| `schemas.py` | Pydantic request/response models. No ORM types leak out. |
| `service.py` | Business rules and transactions. Takes a `Principal`. Raises `AppError`. |
| `repository.py` | SQLAlchemy queries only. No HTTP, no business rules. |
| `models.py` | ORM tables for this context. |

Dependency direction is one-way: `router → service → repository → models`. A router never
imports another domain's repository. Cross-context work goes service → service, or via a
job.

### 5.2 One database session

```python
# core/db.py
engine = create_async_engine(settings.database_url, pool_size=10, max_overflow=10,
                             pool_pre_ping=True)
SessionFactory = async_sessionmaker(engine, expire_on_commit=False)

async def db_session() -> AsyncIterator[AsyncSession]:
    async with SessionFactory() as session:
        async with session.begin():          # one transaction per request
            yield session
```

The sync engine, `SessionLocal`, and every manual `try/finally: db.close()` are deleted.
One transaction per request means a failed request rolls back completely — today a route
that commits halfway and then raises leaves partial data.

Alembic keeps a small sync engine of its own. That is the only exception.

### 5.3 Authorization in one place

```python
# core/policy.py
PERMISSIONS: dict[Permission, frozenset[Role]] = {...}

def require(permission: Permission):
    async def dep(principal: Principal = Depends(build_principal)) -> Principal:
        if principal.role not in PERMISSIONS[permission]:
            raise Forbidden(permission)
        return principal
    return dep
```

Scope is applied at query time, so a scoped admin literally cannot see out-of-scope rows,
even if a route forgets a check:

```python
# core/scoping.py
def scope_to_programs(stmt, principal, program_column):
    if principal.role is Role.SUPER_ADMIN:
        return stmt
    if principal.role is Role.PROGRAM_ADMIN:
        return stmt.where(program_column.in_(principal.program_ids))
    raise Forbidden("program scope")
```

A route then reads:

```python
@router.get("/batches", response_model=Page[BatchOut])
async def list_batches(
    query: BatchQuery = Depends(),
    principal: Principal = Depends(require(Permission.BATCH_READ)),
    db: AsyncSession = Depends(db_session),
):
    return await academics.list_batches(db, principal, query)
```

That is the whole endpoint. Compare with today's 120-line `get_batches`.

### 5.4 Errors

One exception hierarchy, one handler, RFC 9457 `application/problem+json`:

```json
{
  "type": "https://campusgrade/errors/offering-not-owned",
  "title": "You do not teach this class",
  "status": 403,
  "code": "OFFERING_NOT_OWNED",
  "request_id": "b1f0…",
  "errors": []
}
```

The frontend maps `code` to a message. Today error shape is invented per route and the
frontend flattens `detail` by hand in `api.ts`.

### 5.5 Assignment state machine

Explicit, in one module, instead of scattered timestamp checks:

```
draft ──publish──▶ scheduled ──opens_at──▶ open ──due_at──▶ closed
                                                              │
                                              teacher starts  ▼
                                                         evaluating
                                                              │
                                                  publish results
                                                              ▼
                                                          published ──▶ archived
```

Rules:

- Submissions accepted only in `open` (or `closed` if late policy allows).
- Grades editable only in `closed` / `evaluating`.
- Rubric is frozen once the first grade exists (today this is caught late, by comparing
  a `rubric_digest` at import time).
- Every transition writes `assignment_state_events`.

### 5.6 Jobs

One runner process, one `jobs` table, `SELECT … FOR UPDATE SKIP LOCKED`:

```python
async def claim(db, kinds, worker_id, limit):
    return await db.execute(
        select(Job).where(Job.state == "ready", Job.run_after <= now())
                   .order_by(Job.run_after).limit(limit)
                   .with_for_update(skip_locked=True))
```

Job kinds: `repo.sync`, `repo.analyze`, `similarity.scan`, `ai.grade_batch`,
`results.publish`, `session.rollover_notice`, `sessions.purge`, `notification.digest`.

This removes the in-process scheduler, so the API becomes stateless and can scale to N
replicas. Redis/RQ is dropped — Postgres is already there and is enough at this scale
(one department, a few thousand users). One less service to run and monitor.

### 5.7 GitHub integration

Moved behind a port so a second provider is possible later:

```python
class RepositoryProvider(Protocol):
    async def head(self, owner, name, branch) -> CommitRef: ...
    async def archive(self, owner, name, ref) -> bytes: ...
```

Rules: never clone into the API process, always fetch a tarball in a worker, size caps
enforced before extraction (zip-bomb defence), secret redaction on ingest (already exists
— keep it), archives written to private object storage, never served directly.

---

## Part 6 — External AI architecture

The whole point: **the app never runs a model. It calls someone else's.**

### 6.1 One gateway

```
domain/aiservices/
  gateway.py        # the only module that talks to a provider
  providers/
    base.py         # Protocol: complete_json(request) -> AiResponse
    azure_openai.py
    openai.py
    anthropic.py
    manual.py       # export/import transport, for when API access is blocked
  prompts/          # versioned templates, one file each
    grade_batch.v3.md
    draft_assignment.v2.md
    draft_rubric.v1.md
  pseudonymiser.py
  validators.py     # schema + business validation of AI output
  runs.py           # ai_runs ledger
  proposals.py      # ai_grade_proposals lifecycle
```

Rules:

- No other module imports a provider. Ever. (Today `assignment_routes.py` imports three
  private functions from `ai/assignment_ai.py`.)
- Provider is chosen by config, per purpose:
  `AI_PROVIDER_GRADING=azure_openai`, `AI_PROVIDER_DRAFTING=anthropic`.
- Every prompt is a versioned file. The version goes into `ai_runs.prompt_hash`, so a
  disputed grade months later can be reproduced.
- API keys only ever exist server-side, read once in `config.py`.

### 6.2 Pseudonymisation — new, and important

Today the grading prompt sends the student's real name and roll number to the provider.
It does not need to.

```python
# before sending
alias_map = {student_id: f"S{index:03d}" for index, student_id in enumerate(batch)}
# prompt contains only S001, S002 …
# after receiving
resolve(response, alias_map)
```

`alias_map` never leaves the server. This means:

- no student PII leaves the university's boundary
- the provider cannot bias on names
- a leaked prompt log is not a data breach

### 6.3 Untrusted content handling

Student repositories are attacker-controlled. Current defence is one line of prompt text.
Strengthen it:

1. Repository content is wrapped in explicit fenced blocks with a random per-run
   delimiter, so content cannot close the block and start giving instructions.
2. A pre-send scan strips common injection phrases from repo content and records what was
   stripped in `ai_runs`.
3. The system prompt states that fenced content is data, never instructions.
4. **Output validation is the real defence**: the response must match a strict JSON
   schema, every criterion id must exist, every mark must be within `0..max_marks`, the
   total must equal the sum. Anything else is rejected. This already exists in
   `_validate_external_result` — keep it, move it into `validators.py`, and cover it with
   tests.

### 6.4 Two transports, one pipeline

```
                       ┌── transport: api ────────────► provider HTTP call
build request ─► ledger┤
                       └── transport: manual_export ──► teacher copies prompt out,
                                                        pastes JSON back
                                                          │
                                       ◄──────────────────┘
validate ─► proposals ─► teacher reviews ─► accepted ─► grades
```

The manual copy-paste flow that exists today is kept, but as a **transport option** on
the same pipeline — not a separate code path. Same prompt builder, same validator, same
proposal table, same ledger. This matters because it is the fallback when the university
network blocks the provider.

### 6.5 Cost and rate control

`ai_budgets` caps runs and spend per program, per teacher, per day. The gateway checks
the budget before calling, records actual cost after. Super admin sees spend by program.

Without this, one teacher hitting "evaluate all" on 300 submissions can spend a month's
budget in ten minutes.

### 6.6 The human rule

> No AI output ever becomes a grade without a person clicking accept.

Enforced in code: `ai_grade_proposals` has no path to `grades` except
`grading.accept_proposal(principal, proposal_id, edits)`, which requires
`Permission.ASSIGNMENT_GRADE` and writes an audit event. Every published grade that came
from AI carries `source = 'ai_assisted'` and a `run_id`, so a student can be told exactly
how their mark was produced.

### 6.7 Where AI is used

| Feature | Purpose | Who triggers |
|---|---|---|
| Draft an assignment brief from a document or topic | `draft_assignment` | Teacher |
| Generate a rubric from the brief | `draft_rubric` | Teacher |
| Propose marks + per-criterion notes for a batch | `grade_proposal` | Teacher |
| Rewrite feedback to be clearer for a student | `feedback_polish` | Teacher |
| Summarise a class's common gaps | `class_insights` | Teacher / Program admin |

Students never trigger an AI call. That removes a whole class of abuse and cost risk.

---

## Part 7 — Frontend architecture

### 7.1 Session moves to cookies

This is the unlock for everything else.

| | Today | Target |
|---|---|---|
| Access token | `localStorage` | httpOnly, secure, `SameSite=Lax` cookie, 15 min |
| Refresh token | httpOnly cookie ✅ | unchanged, 14 days, rotating |
| CSRF | none | double-submit token on mutating requests |
| Role gate | client component | `middleware.ts`, server-side |
| Data fetch | client only | server component for first paint, client for interaction |

`AuthGate` is deleted. `middleware.ts` reads the session cookie, verifies the JWT
signature at the edge, and redirects before a single byte of a protected page is sent.

### 7.2 Layout

```
frontend/src/
  app/
    (public)/login/page.tsx
    (app)/
      layout.tsx                # server component: session + nav
      dashboard/page.tsx
      assignments/…
      grading/…
      admin/…                   # program_admin + super_admin
      platform/…                # super_admin only
  features/
    assignments/
      api.ts        # typed calls, generated types
      queries.ts    # TanStack Query hooks + query keys
      components/
      schema.ts     # zod, mirrors backend validation
    grading/  integrity/  academics/  people/  ai/  auth/
  components/ui/                # design system primitives only
  lib/
    http.ts  format.ts  permissions.ts
  server/
    session.ts  fetcher.ts      # server-side data access
  types/api.d.ts                # GENERATED — npm run gen:types, checked in CI
middleware.ts
```

Rule: **a page file is at most 150 lines.** It composes feature components. The current
1,315-line `admin/students/page.tsx` becomes a page plus ~8 components in
`features/people/`.

### 7.3 Data layer

- One typed HTTP client generated from `/openapi.json`. `npm run gen:types` already
  exists — make it a CI gate so drift is impossible.
- TanStack Query for everything client-side. Query keys in one file per feature.
- Server components fetch first-paint data directly with the session cookie forwarded.
- Optimistic updates only where a rollback is safe (marking read, toggling a flag), never
  for grades.

### 7.4 Permissions in the UI

`lib/permissions.ts` mirrors the backend matrix and drives which nav items and buttons
render. It is **convenience, not security** — the server is always the authority. This is
stated in a comment so nobody trusts it.

### 7.5 Navigation by role

| | Super Admin | Program Admin | Teacher | Student |
|---|---|---|---|---|
| Overview | platform-wide | own programs | own classes | own work |
| Programs / Sessions / Rollover | ✅ | read only | — | — |
| Batches / Sections / Subjects | ✅ | own programs | — | — |
| Offerings (teacher allocation) | ✅ | own programs | read own | — |
| People | ✅ | own programs | — | — |
| Assignments | read all | read own programs | full on own | own |
| Grading | — | read | ✅ | — |
| Integrity | review all | read | review own | — |
| AI usage & spend | ✅ | own programs | own runs | — |
| Audit log | ✅ | own programs | — | — |
| Settings | ✅ | — | — | — |

### 7.6 Non-negotiables

- Accessibility: keyboard reachable, visible focus, labelled inputs, AA contrast.
- Every list: empty state, loading skeleton, error state with retry.
- Every destructive action: typed confirmation.
- Dates: always show the user's timezone, never a naive string.
- No layout that breaks below 1280px height (the login panel bug that started this).

---

## Part 8 — Non-functional requirements

| Area | Target |
|---|---|
| API p95 latency | < 300 ms for reads, < 800 ms for writes |
| Repository analysis | < 60 s per submission, in a worker |
| AI grade batch | ≤ 10 students per call, retried, resumable |
| Availability | single region, 99.5%, planned maintenance windows |
| Scale | 1 department, ~5k students, ~200 teachers, ~50k submissions/year |
| Backups | nightly full + WAL, restore tested each term |
| Secrets | env only, never in the repo, rotated per term |
| Passwords | bcrypt today (fine) → argon2id. **The real gap is the initial password**: `_generate_teacher_password` returns `firstname@last2digits` of the phone, and the student one uses the roll number. Both are guessable by any classmate. Use `_generate_temporary_password()` (already written, already strong) for every account. |
| Rate limits | login 10/min/IP, AI 20/hour/teacher, uploads 50/hour/user |
| Logs | JSON, with `request_id`, `user_id`, `program_id`. No PII in message bodies. |
| Retention | audit 7 years, AI payloads 2 years, repo archives 2 years, logs 90 days |

### Testing

| Layer | Tool | Gate |
|---|---|---|
| Backend unit | pytest | services and policy at 85% |
| Backend integration | pytest + testcontainers Postgres | every router, every role |
| **Authorization matrix** | pytest, generated from the matrix table | **every endpoint × every role** |
| AI validators | pytest with recorded fixtures | malformed, malicious, and out-of-range outputs |
| Frontend unit | vitest | lib + hooks |
| Frontend component | testing-library | forms and tables |
| E2E | Playwright | login, create assignment, submit, grade, publish — per role |
| Migration | alembic upgrade head + downgrade on a seeded DB | every PR |

The authorization matrix test is the most valuable one. It is generated from the same
table the code uses, so a new endpoint without a permission fails CI.

---

## Part 9 — Migration plan

Rebuilding from scratch is not proposed. Each phase ships on its own and leaves the app
working.

### Phase 0 — Foundations (1 week)

No behaviour change. Nothing user-visible.

- `config.py` with pydantic-settings; delete scattered `os.getenv` calls.
- `core/errors.py` + one exception handler.
- `core/db.py` async session; **delete the sync engine**, port routes mechanically.
- `Principal` + `policy.py` + `scoping.py`, wired but permissive at first.
- CI: pytest, ruff, mypy on `core/`, `npm run build`, `gen:types` drift check.

**Done when:** tests pass, one engine in the pool, CI is red on a bad PR.

### Phase 1 — Identity and roles (1.5 weeks)

- Migration: add `super_admin`, `program_admin` to the role enum; existing `admin` rows
  become `super_admin`.
- Create `user_profiles`, `student_profiles`, `teacher_profiles`, `admin_program_scopes`,
  `auth_sessions`; backfill from `users`; **keep old columns for one release**, then drop.
- Delete `models/auth_store.py`. Routes take `Principal`.
- Argon2id password hashing with a rehash-on-login path.
- Move access token to an httpOnly cookie; add CSRF.

**Done when:** the authorization matrix test passes for all four roles.

### Phase 2 — Academics (2 weeks)

- Rename `courses` → `programs` (Alembic `op.rename_table`, then update code).
- **Drop `departments`** and `institutions`; remove the boot-time seed hack.
- Create `subject_offerings`; backfill from `users.assignments` JSON +
  `teacher_session_allocations`; reconcile conflicts in a one-off script with a report.
- Drop `users.assignments`, `users.course`, `users.batch`, `users.department`,
  `users.year`, `users.semester`; `student_terms` becomes the only source.
- Split `admin_routes.py` into `domain/academics/`; **delete the shim package**
  `routes_fastapi/admin/`.

**Riskiest phase.** The JSON→table backfill needs a dry-run report reviewed by a human
before it is applied.

**Done when:** `admin_routes.py` no longer exists and no free-text academic column
remains.

### Phase 3 — Assignments, submissions, grading (2 weeks)

- Split `assignment_routes.py` into three domains.
- Point assignments at `offering_id`; backfill from the target triple.
- `assignment_state_events` replaces the 11 lock/publish columns.
- `repository_links` / `repository_snapshots` split out of `submissions`.
- `grade_criterion_scores` replaces the `rubric_scores` JSON.

**Done when:** no file in `domain/` is over 400 lines.

### Phase 4 — AI gateway (1.5 weeks)

- Build `aiservices/` with the provider port and the Azure adapter first.
- Move prompts to versioned files.
- Add `ai_runs`, `ai_grade_proposals`, `ai_budgets`.
- Add pseudonymisation — **stop sending student names**.
- Fold the manual export/import flow in as `transport = manual_export`.
- Delete `ai/assignment_ai.py` and every cross-module private import.

**Done when:** grep for a provider name outside `aiservices/` returns nothing.

### Phase 5 — Jobs and integrity (1 week)

- `jobs` table + one runner; delete the lifespan scheduler, `BackgroundTasks` fallbacks,
  Redis and RQ.
- `similarity_pairs` with the ordered-pair constraint; `similarity_reviews` split out.
- API becomes stateless — run 2 replicas to prove it.

### Phase 6 — Frontend (2.5 weeks)

- `middleware.ts` role gating; delete `AuthGate`.
- Move `DashboardLayout` chrome into the route-group layout so it mounts once. This
  alone removes 21 duplicate mounts and 2 redundant fetches per navigation.
- Feature folders; break up the four files over 800 lines.
- Generated types everywhere; remove `any` from `lib/api.ts`.
- Server components for first paint on dashboard, assignment list, gradebook.
- Playwright E2E per role.

### Phase 7 — Hardening (1 week)

- Load test at 2× expected peak.
- Backup restore drill.
- Security review: authz matrix, upload limits, prompt injection, secret scanning.
- Runbook: deploy, rollback, restore, rotate keys, on-call.

**Total: ~12 weeks of focused work.** Phases 0–2 are the ones that pay for themselves;
after those the codebase stops fighting back.

---

## Part 10 — Decisions worth arguing about

Recorded so they can be revisited on purpose, not by accident.

| # | Decision | Why | Cost |
|---|---|---|---|
| 1 | Drop the `departments` table | The app is SOET-only. A table with one row is a lie that every query pays for. | If a second school is ever added, this is a migration, not a code change. |
| 2 | Postgres `jobs` instead of Redis + RQ | One service instead of two at this scale. Transactional enqueue is free. | Not suitable past ~50 jobs/sec. Far beyond this app. |
| 3 | Async SQLAlchemy only | Two engines against one DB is waste and confusion. | A one-time mechanical port of every route. |
| 4 | httpOnly cookies over `localStorage` | Enables middleware, server components, and XSS-resistant tokens. | CSRF tokens must be added. |
| 5 | Pseudonymise before every AI call | Student PII should not leave the university boundary. | Small mapping step; slightly harder debugging. |
| 6 | Admins cannot grade | Keeps accountability clean, avoids "who changed this mark". | Admins must ask a teacher, or be given a teacher account. |
| 7 | `subject_offerings` as the centre | Collapses a JSON blob, a mirror table and three target columns into one row. | The riskiest backfill in the plan. |
| 8 | Keep the manual AI copy-paste path | It works when the network blocks the provider. Real constraint at universities. | Two transports to test. |
| 9 | Per-criterion scores as rows, not JSON | Makes rubric analytics a query instead of app-side parsing. | More rows; nothing else. |
| 10 | UUIDv7 ids | Time-ordered, so index locality is good and ids are not guessable. | Needs a small helper until Postgres ships `uuidv7()`. |

---

## Appendix A — What gets deleted

| Thing | Why |
|---|---|
| `models/auth_store.py` | Dict-based identity with a Mongo-era `_id`. |
| `routes_fastapi/admin/` (shim files) | Fake modularity over a god file. |
| `routes_fastapi/admin_routes.py` | 2,606 lines; split into `domain/academics/` + `domain/identity/`. |
| `ai/assignment_ai.py` | Replaced by `aiservices/`. |
| Sync engine + `SessionLocal` | One DB layer. |
| `departments`, `institutions` tables | Single department, single institution. |
| `users.assignments/achievements/github_repositories` | Relational data in JSON. |
| `users.course/batch/department/year/semester` | Free-text duplicates of foreign keys. |
| `teacher_session_allocations` | Replaced by `subject_offerings`. |
| Lifespan scheduler loop | Blocks horizontal scaling. |
| Redis + RQ + `assignment_worker.py` | Replaced by the `jobs` table. |
| `AuthGate.tsx` | Replaced by `middleware.ts`. |
| `frontend/src/layouts/DashboardLayout.tsx` as a per-page import | Its content moves **into** `app/(app)/layout.tsx` so chrome mounts once, not 21 times. |

> Note: `CLAUDE.md` says `backend/alembic/` is a "stale leftover". It does not exist —
> only `backend/migrations/` is present. Fix that line when this plan lands.

## Appendix B — What gets added

| Thing | Value |
|---|---|
| `super_admin` + `program_admin` with real scopes | The stakeholder model the app actually needs. |
| `subject_offerings` | One row answers who teaches what, to whom, when. |
| Authorization matrix + generated tests | A new endpoint cannot ship without a permission. |
| `ai_runs` ledger | Every AI call is reproducible and auditable. Needed for grade disputes. |
| Pseudonymisation | No student PII leaves the university. |
| `ai_budgets` | One teacher cannot burn the term's AI budget in ten minutes. |
| `jobs` outbox | No lost work; API becomes stateless. |
| `assignment_state_events` | Full history instead of 11 timestamp columns. |
| `grade_criterion_scores` | Rubric analytics as a query. |
| Generated OpenAPI types in CI | Frontend and backend cannot drift. |
| Playwright E2E per role | The four stakeholder journeys are protected. |

---

## Appendix C — Environment

```bash
# core
APP_ENV=production
SECRET_KEY=                       # >=32 chars, unique
DATABASE_URL=postgresql+asyncpg://…
ALLOWED_ORIGINS=https://campusgrade.krmangalam.edu.in
COOKIE_SECURE=true
COOKIE_DOMAIN=.krmangalam.edu.in

# storage
PRIVATE_STORAGE_BACKEND=s3        # local | s3
S3_BUCKET=  S3_REGION=  S3_ACCESS_KEY_ID=  S3_SECRET_ACCESS_KEY=

# external AI — no keys ever reach the browser
AI_PROVIDER_GRADING=azure_openai
AI_PROVIDER_DRAFTING=azure_openai
AZURE_OPENAI_ENDPOINT=  AZURE_OPENAI_API_KEY=
AZURE_OPENAI_DEPLOYMENT=  AZURE_OPENAI_API_VERSION=2024-10-21
AI_MAX_RUNS_PER_TEACHER_PER_DAY=40
AI_MAX_COST_MICROS_PER_PROGRAM_PER_MONTH=

# github
GITHUB_TOKEN=                     # read-only, for public repo fetch rate limits
GITHUB_MAX_ARCHIVE_BYTES=52428800

# jobs
JOB_WORKER_CONCURRENCY=4
```

`config.py` validates all of these at import. The app refuses to start on a bad value —
which is already the good behaviour of today's `_secret()` check, applied everywhere.
