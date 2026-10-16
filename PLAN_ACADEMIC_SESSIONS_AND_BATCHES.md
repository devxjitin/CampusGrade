# Plan: academic sessions, batches, years and semesters

This is a plan only. Nothing here is built yet.

It answers three questions:

1. When an academic session changes, what exactly should change in the app?
2. Every year a new batch starts and new students join. How does the app handle that on its own?
3. What happens when the semester rolls over, or the year rolls over?

---

## Part 0 — What the app does today

Facts from the current code, so the plan starts from truth and not guesses.

**Academic sessions** (`academic_sessions` table, added in migration 017)

- Columns: `id`, `label` (like `2025-2026`), `term` (`odd` / `even`), `start_date`, `end_date`, `is_current`.
- The admin picks one in the topbar. The choice is saved in the browser's `localStorage` (`campusgrade_academic_session_id`) — it is **not** saved on the server and **not** tied to the user account.
- The chosen id is sent as `session_id` to two endpoints only: `GET /assignments/admin-tools/dashboard` and `GET /assignments/admin`.
- On the backend the id is turned into a start/end date pair, and that pair filters assignments by `due_at`. That is all it does.
- Nothing in the database is tagged with a session. Assignments, enrollments and students have no session column.

**Batches**

- `batches` = `course_id` + `start_year` + `end_year`, unique together. Optional `name`.
- A student points at `course_id`, `batch_id`, `section_id` directly on the `users` row.
- Sections belong to a batch.

**Year and semester**

- `users.year` and `users.semester` are plain integer columns that somebody types in by hand.
- Nothing updates them. If a student moves from semester 3 to semester 4, an admin has to edit that student.

**Subjects and enrollment**

- `subjects` has `course_id`, `batch_id`, `year`, `credits`, `enrollment_type` (compulsory / elective).
- `student_subject_enrollments` is just `student_id` + `subject_id`, unique per pair. No session, no semester. So a student can only ever be enrolled in a subject once, forever.

**Assignments**

- Target `target_course_id` / `target_batch_id` / `target_section_id` plus `subject_id`, and have `opens_at` / `due_at`.
- Who can see an assignment is worked out live in `_eligible_students()` by matching the student's current course/batch/section.
- When evaluation locks, the student list is frozen into `assignment_evaluation_participants`. That part is already good and should not change.

**Teacher allocations**

- Stored as JSON on `users.assignments`: a list of `{program_id, batch_id, section_id, subject_ids}`. Not a real table, and not session aware.

### The three problems this creates

1. **A session switch changes almost nothing.** It only moves a date filter on two admin screens. Everything else (students, subjects, teachers, enrollments) ignores it.
2. **Year and semester are typed by hand.** Twice a year someone must edit every student. That will not happen, so the data will drift and become wrong.
3. **History gets overwritten.** Because year/semester live on the student row, editing a student to semester 4 destroys the fact that they were in semester 3 last term. Old reports silently become wrong.

---

## Part 1 — The idea that fixes all three

Right now three different things are mixed together. Separating them is the whole plan.

| Thing | What it means | Does it change over time? |
|---|---|---|
| **Batch (cohort)** | The group of students who joined together. "B.Tech CSE 2025–2029". | **Never.** A student stays in their batch until they leave or graduate. |
| **Session (term)** | The window the institution is teaching right now. Odd = Jul–Dec, Even = Jan–Jun. | Rolls forward twice a year. |
| **Year / semester** | Where a student is in their course. | **Derived** from batch + session. Not typed by hand. |

So the answer to "what if semester or year changes" is: **nothing needs to be edited.** Year and semester are calculated. Change the current session and every student's year and semester moves by itself.

### The formula

For a session labelled `YYYY-(YYYY+1)` with a term:

```
session_start_year = int(label.split("-")[0])          # 2026-2027 -> 2026
years_elapsed      = session_start_year - batch.start_year
study_year         = years_elapsed + 1
semester           = (2 * study_year) - 1   if term == "odd"
                     (2 * study_year)       if term == "even"
graduated          = study_year > course.duration_years
```

Worked examples for batch 2025–2029, 4-year course:

| Session | study_year | semester |
|---|---|---|
| 2025-2026 Odd | 1 | 1 |
| 2025-2026 Even | 1 | 2 |
| 2026-2027 Odd | 2 | 3 |
| 2026-2027 Even | 2 | 4 |
| 2028-2029 Even | 4 | 8 |
| 2029-2030 Odd | 5 | graduated |

This one formula covers both "semester changed" (Odd → Even, same year, semester +1) and "year changed" (Even → Odd, year +1, semester +1). **They are the same operation, just a different flavour.** That keeps the code small.

### Storing the result instead of recomputing forever

Deriving on the fly is correct but it cannot hold irregular students (backlog, repeat, lateral entry, on leave), and it cannot preserve history if a batch is ever corrected.

So: derive it once per session, then **write it down** in a new table.

**New table: `student_session_records`**

| Column | Notes |
|---|---|
| `id` | uuid |
| `student_id` | FK users |
| `session_id` | FK academic_sessions |
| `batch_id` | FK batches — snapshot, in case the student is moved later |
| `section_id` | FK sections, nullable |
| `study_year` | int, derived but overridable |
| `semester` | int, derived but overridable |
| `status` | `active` / `repeating` / `on_leave` / `dropped` / `graduated` |
| `is_override` | bool — true if an admin edited it by hand, so rollover never stomps it |
| `rollover_run_id` | nullable FK — which rollover created this row, so it can be undone |

Unique on `(student_id, session_id)`.

This is the key table. It means "what semester was this student in during 2026-2027 Odd" is a permanent fact, not a mutable field. Old reports stay correct forever.

`users.year` and `users.semester` stay in place but stop being the source of truth. They become a cached copy of the **current** session's record, so existing screens and API responses keep working without a rewrite. A small helper keeps them in sync.

---

## Part 2 — What changes when the session changes

There are **two different session changes** and mixing them up is what makes the current feature feel broken.

### A. Viewing session — a read-only lens (admin only)

The topbar dropdown. It answers "show me the app as it looked during this term." It **never writes anything**.

Rename the control to **"Viewing: 2026-2027 (Odd)"** so it is obvious it is a lens, not a switch.

What each admin screen should do when the viewing session changes:

| Screen | Behaviour with a viewing session selected |
|---|---|
| Home / overview dashboard | Program + teacher progress, pending evaluations, overdue counts — all limited to assignments in that session. **(partly done today)** |
| Recent assignments list on home | Same limit. **(done today)** |
| Assignments list (`/assignments/admin/all`) | Only assignments belonging to that session. Manual date filters override the session. |
| Students | Show each student's year, semester, section and status **as of that session**, read from `student_session_records`. Students who had not joined yet, or had already graduated, are hidden by default with a "show all" toggle. |
| Programs / Batches / Sections cards | Student counts come from `student_session_records` for that session, not from the live `users` table. So a 2019 batch card shows 0 active students in 2026, which is correct. |
| Subjects | Show subjects active in that session's semesters, with the enrolled-student count for that session. |
| Teachers | Show allocations that were in force during that session. |
| Analytics / audit log | Limited to the session's date range. |
| Everything else (settings, profile) | Not affected. |

Rules:

- Only admins get the dropdown. Teachers and students **always** see the current session — no lens, no confusion.
- If no session is picked, default to the one flagged `is_current`.
- If a past session is being viewed, show a clear banner: *"Viewing 2025-2026 (Odd) — a past session. Data is read-only."* and disable create/edit buttons. This stops an admin creating a new assignment while accidentally looking at last year.

### B. Current session — the real switch

This is `is_current` on `academic_sessions`. It changes what the **whole system** thinks "now" means:

- which semester each student is in,
- which subjects are running,
- what teachers can create assignments against,
- what students see on their dashboard.

This must never be a dropdown click. It is a deliberate admin action called **"Roll over to next session"**, described in Part 4.

---

## Part 3 — Batch lifecycle: the annual intake problem

The question: every year a new batch forms and new students arrive. How is that handled automatically?

### Batch auto-creation

A batch is fully described by `course_id` + `start_year` + `end_year`, and `end_year = start_year + course.duration_years`. So it can be created without anyone thinking about it.

**Rule: when the app rolls into an Odd session of year Y, create a batch `(course, Y, Y + duration_years)` for every active course, plus one default section "A".**

- Runs only on Odd rollovers. Even rollovers are mid-year and add no intake.
- Idempotent — if the batch already exists (unique constraint on `course_id`+`start_year`+`end_year`), skip it.
- Add `batches.auto_created` (bool) and `batches.status` (`upcoming` / `active` / `completed`) so the UI can label them.

Add these columns to `batches`:

| Column | Purpose |
|---|---|
| `status` | `upcoming` / `active` / `completed`, computed from years and current session |
| `auto_created` | true if the rollover made it, so admins know what to expect |
| `intake_open` | bool — can new students still be admitted into this batch |

### Admitting new students

Today the add-student form asks for course, batch and section. That means an admin has to remember which batch is the new one.

Change it to: **admin picks course + admission year (defaulted to the current session's year).** The app resolves the batch itself, creating it if missing. Batch becomes a field the admin can see and override, not one they must work out.

On save the app also:

- creates the `student_session_record` for the current session with the derived year/semester,
- auto-enrols them in every compulsory subject for that course + year + semester,
- assigns them a section (least-full section by default, admin can change).

Bulk import (CSV) uses the same path, so one code path covers both.

### Graduation

When a rollover moves a batch past `course.duration_years`:

- every `active` student in it gets a final `student_session_record` with `status = graduated`,
- the batch `status` becomes `completed` and `intake_open` becomes false,
- students are removed from live rosters, dashboards and "eligible for assignment" queries,
- their account, submissions and grades are **kept** — history must survive,
- their login is either deactivated or downgraded to read-only alumni access. **Recommendation: keep the login active but read-only** so they can still see their results.

Add a "Graduated" filter on the students page instead of deleting anything, ever.

### Sections

Sections belong to a batch, not to a session, so they carry over on their own. On rollover, each student's section is copied into their new `student_session_record`. If an admin reshuffles sections for the new term, they edit the records for that session and older sessions are untouched.

---

## Part 4 — The rollover engine (the automatic part)

One mechanism handles both semester change and year change.

### Step 1: Preview (dry run)

An admin opens **Administration → Session rollover** and sees a preview before anything happens:

```
Rolling over: 2026-2027 (Odd)  ->  2026-2027 (Even)

  Students to promote            412   (semester 3 -> 4, etc.)
  Students graduating              0
  New batches to create            0   (Even rollover: no new intake)
  New sections to create           0
  Subject enrolments to create   1,236
  Teacher allocations to carry     37

  Warnings
    18 assignments in 2026-2027 (Odd) still have ungraded submissions
     3 students have no batch set and will be skipped
     1 student is flagged 'repeating' and keeps semester 3
```

Nothing is written. The admin can fix the warnings and re-run the preview.

### Step 2: Execute

One database transaction, so it either fully works or fully rolls back:

1. Create the target session row if it does not exist (label + term computed from the outgoing one).
2. Create a `rollover_runs` row to stamp everything created by this run.
3. If Odd: create the new batches and their default sections.
4. For every student with `status = active` in the outgoing session, create a `student_session_record` for the new session with derived `study_year` / `semester`, carrying over batch and section.
   - Skip students whose outgoing record has `is_override = true` and status `repeating` / `on_leave` — apply their explicit rule instead.
   - Students whose new `study_year` exceeds `course.duration_years` get `status = graduated` instead of being promoted.
5. Auto-enrol each promoted student in the compulsory subjects for their new course + year + semester (rows in `student_subject_enrollments`, now stamped with `session_id`).
6. Copy teacher allocations forward into the new session.
7. Flip `is_current` to the new session, clear it on the old one.
8. Sync the cached `users.year` / `users.semester`.
9. Write an audit-log entry with the full counts.

### Step 3: Undo

Because every created row carries `rollover_run_id`, an undo is possible: delete only the rows that run created and flip `is_current` back.

Allow undo only while **no new assignment or submission exists in the new session**. Past that point, undo is refused with a clear message — the safe answer is to fix forward, not unwind real work.

### Step 4: Scheduling — how automatic is "automatic"?

`app.py` already runs an in-process background loop (it auto-publishes results and purges sessions). Hook into it.

On the target session's `start_date` the loop runs the rollover in **prepare mode**: it computes the preview, saves it, and raises a banner + notification for admins — *"2026-2027 (Even) starts today. Review and confirm the rollover."*

It does **not** flip the institution into a new term by itself. That is deliberate. A silent rollover that gets the semester wrong for 400 students, with assignments live, is a much worse failure than a one-click confirmation. If full automation is wanted later, add a per-institution setting `auto_confirm_rollover` that defaults to off.

### What happens to work in flight

- Assignments keep the `session_id` they were created in. They do not move.
- Ungraded submissions from the outgoing session stay gradeable. Teachers get a "Previous session" view so they can finish.
- Grades and submissions are never touched by a rollover.
- Deadlines are not shifted.

---

## Part 5 — Session tagging (what the database needs)

For any of the above to be queryable, records need to know which session they belong to.

| Table | Change |
|---|---|
| `assignments` | add `session_id` FK, nullable, indexed. Set on create from the current session. Backfill old rows by matching `due_at` (fall back to `created_at`) against session date ranges. |
| `student_subject_enrollments` | add `session_id` FK. **Drop** the `(student_id, subject_id)` unique constraint and replace it with `(student_id, subject_id, session_id)` — a student can legitimately take a subject again after failing it. |
| `batches` | add `status`, `auto_created`, `intake_open`. |
| `academic_sessions` | add `status` (`upcoming` / `active` / `closed`), and a check that ranges do not overlap. |
| new `student_session_records` | as described in Part 1. |
| new `rollover_runs` | `id`, `from_session_id`, `to_session_id`, `executed_by`, `executed_at`, `counts` (JSON), `undone_at`. |
| new `teacher_session_allocations` | optional, Phase 6 — move teacher allocations out of the `users.assignments` JSON blob into a real session-aware table. |

---

## Part 6 — Build order

Each phase is shippable on its own and leaves the app working.

### Phase 1 — Foundations, no visible change

- Migration 018: `student_session_records`, `rollover_runs`, new `batches` and `academic_sessions` columns.
- `services/academic_calendar.py`: the derivation helpers — `derive_study_year_semester(batch, session)`, `resolve_current_session(db)`, `get_student_session_record(db, student, session)`.
- Backfill: create `student_session_records` for every existing student against the current session, using their existing `users.year` / `users.semester` where present, derived values otherwise.
- Tests for the formula, including lateral entry and graduation edges.

**Files:** `backend/models/sql_models.py`, `backend/migrations/versions/20260726_18_*.py`, new `backend/services/academic_calendar.py`, `backend/tests/test_academic_calendar.py`.

### Phase 2 — Tag the data

- Migration 019: `session_id` on `assignments` and `student_subject_enrollments`; swap the enrollment unique constraint.
- Backfill assignments from `due_at` / `created_at`.
- Assignment create/update sets `session_id` from the current session.
- `session_id` filtering moves from "date range" to "real column" on `/assignments/admin` and `/assignments/admin-tools/dashboard` (keep the date fallback for rows that could not be backfilled).

**Files:** `backend/models/assignment.py`, `backend/routes_fastapi/assignment_routes.py`, migration 019.

### Phase 3 — The viewing lens

- Every admin list endpoint accepts `session_id`: students, batches, sections, subjects, teachers, analytics, audit log.
- Counts on the card grids read from `student_session_records`.
- Frontend: keep the localStorage + `campusgrade:academic-session-changed` event pattern already in place, but move it into a React context provider (`AcademicSessionProvider`) so every page reads it the same way instead of each component wiring its own listener.
- Relabel the dropdown to "Viewing: …". Add the read-only banner for past sessions.

**Files:** `backend/routes_fastapi/admin/*.py`, `frontend/src/lib/academicSession.ts`, new `frontend/src/context/AcademicSessionContext.tsx`, `frontend/src/layouts/DashboardLayout.tsx`, all admin pages under `frontend/src/app/(dashboard)/admin/`.

### Phase 4 — Rollover engine

- `services/session_rollover.py`: `preview(db, from_session, to_session)` and `execute(db, ..., dry_run=False)`, plus `undo(db, run_id)`.
- Endpoints: `POST /admin/session-rollover/preview`, `POST /admin/session-rollover/execute`, `POST /admin/session-rollover/{run_id}/undo`, `GET /admin/session-rollover/history`.
- Frontend page `/admin/session-rollover` with the preview table, warnings, a typed confirmation, and history.

**Files:** new `backend/services/session_rollover.py`, new `backend/routes_fastapi/admin/session_rollover.py`, new frontend page.

### Phase 5 — Intake and graduation

- Auto batch creation on Odd rollovers.
- Add-student form: course + admission year, batch auto-resolved.
- Auto-enrolment into compulsory subjects on admission.
- Graduated status, alumni read-only access, "Graduated" filter on the students page.

### Phase 6 — Teacher allocations

- Move `users.assignments` JSON into `teacher_session_allocations`.
- Carry allocations forward on rollover.
- Keep reading the JSON as a fallback for one release, then drop it.

### Phase 7 — Scheduling and notifications

- Background loop raises the rollover-due banner on `start_date`.
- Optional `auto_confirm_rollover` setting, default off.
- Admin notification when a session is about to end with ungraded work outstanding.

### Phase 8 — Verification

- Backend tests: derivation formula, rollover preview/execute/undo, session filtering on every admin endpoint, graduation edges.
- A seeded end-to-end scenario: create a batch → admit students → roll Odd→Even→Odd → check semesters, enrolments and graduation.
- Frontend: `tsc --noEmit`, `next build`, `eslint`.

---

## Part 7 — Irregular students

The formula alone cannot handle these. `student_session_records` with `is_override` can.

| Case | How it works |
|---|---|
| **Lateral entry** (joins directly in year 2) | Admit against the batch that graduates when they will. Their first `student_session_record` is created with an explicit `study_year` / `semester` and `is_override = true`. Rollover then promotes them normally from there. |
| **Backlog / repeating a semester** | Admin sets the outgoing record's `status = repeating`. Rollover copies the same `study_year` / `semester` forward instead of promoting. |
| **On leave / gap** | `status = on_leave`. Rollover creates the next record with the same year/semester and keeps them off active rosters until an admin sets them back to `active`. |
| **Dropped out** | `status = dropped`. No further records are created. All history stays. |
| **Transferred between sections** | Edit the current session's record only. Past sessions keep the old section, which is what history should show. |
| **Transferred between programs** | New record with the new batch/course, `is_override = true`. Old records keep the old program. |

---

## Part 8 — Risks and things to watch

- **Backfilling assignment sessions is lossy.** Assignments with a null `due_at` fall back to `created_at`; a few may land in the wrong session. Ship a small admin screen to reassign them rather than trying to be clever in SQL.
- **Overlapping sessions break the derivation.** Add a validation on create/update that date ranges do not overlap, and that Odd/Even alternate cleanly.
- **`users.semester` already exists** (migration 016) and is edited by hand today. After Phase 1 it becomes a cached copy. Anything that writes it directly must be found and redirected, or the cache and the records will disagree. Grep for `semester` before Phase 1 lands.
- **Dates vs datetimes.** Session boundaries are `date`, `due_at` is `datetime`. Compare with an inclusive end-of-day, which `_parse_dashboard_date(..., end=True)` already does — reuse it rather than writing new comparisons.
- **Row growth.** `student_session_records` grows as students × sessions. At 5,000 students and 2 sessions a year that is 10,000 rows a year. Trivial for Postgres. Index `(session_id, student_id)` and `(student_id, session_id)`.
- **The undo window is a trap if it is too generous.** Refuse undo as soon as any assignment or submission exists in the new session, and say so plainly in the UI.
- **Do not let a rollover run twice.** Add a unique constraint on `(from_session_id, to_session_id)` in `rollover_runs` where `undone_at is null`.
- **Migration 15 uses `datetime.UTC`**, which needs Python 3.11+. The dev environment here resolved to 3.10. Confirm the deployment Python version before adding migrations that follow the same style.

---

## Part 9 — Decisions needed before coding

These change the design, so they are worth settling first.

| # | Question | Recommendation |
|---|---|---|
| 1 | Should the viewing session be per-browser (localStorage, as now) or saved per admin account? | Keep localStorage. Simpler, and a viewing lens is a personal preference, not shared state. |
| 2 | Should rollover be fully automatic on the session start date? | No — prepare automatically, confirm manually. Add an opt-in setting later. |
| 3 | Do graduated students keep their login? | Yes, read-only. They should be able to see their own results. |
| 4 | Are elective subjects auto-enrolled on rollover? | No. Only compulsory ones. Electives need a student or admin choice. |
| 5 | Should teachers get a session dropdown too? | Not in this plan. Give them a simple "Previous session" view for finishing grading instead. |
| 6 | Odd = Jul–Dec and Even = Jan–Jun — is that right for KRMU? | Confirm before Phase 1. The whole derivation formula depends on it. |
| 7 | Can a session ever be deleted? | No. Close it instead (`status = closed`). Deleting a session would orphan every record tagged with it. |

---

## Summary in one paragraph

Stop storing year and semester on the student. Store them per session in `student_session_records`, derived from `batch.start_year` + the session. Tag assignments and enrolments with `session_id`. Then the admin topbar dropdown becomes a real read-only lens over the whole app, and "the semester changed" and "the year changed" become the same one-click rollover, which promotes every student, creates the new batch and its sections on Odd terms, auto-enrols compulsory subjects, graduates the outgoing batch, and can be undone if it was run by mistake. New intake stops being something an admin has to remember and becomes something the app proposes on the right date.
