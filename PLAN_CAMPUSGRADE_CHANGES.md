# CampusGrade change plan

This is an implementation plan for six product changes on top of the current CampusGrade codebase (FastAPI + PostgreSQL backend, Next.js frontend). It is a plan only — nothing in this document has been implemented yet. Each section lists the goal, the concrete backend/frontend changes, migrations needed, and open questions or risks to resolve before coding starts.

Suggested build order (least risky/blocking first): **1 → 4 → 5 → 6 → 3 → 2**. Rename is independent and safe to do first. Department removal (4) should land before the card-UI rework (6) touches the same Program/Subject pages, so the new UI isn't built around a field that's about to disappear. The academic-session switcher (2) is the largest, most structurally new piece and is best done last, once the academic-structure pages have settled.

---

## 1. Rename "CampusGrade" → "CampusGrade"

A plain rename touches both cosmetic strings and a few things wired into runtime behavior. Splitting them matters.

**Safe, cosmetic find-and-replace** (no behavior change, low risk):

- Backend: `app.py` (`APP_NAME`, two log/error strings, FastAPI `title=`), `bootstrap_admin.py` (default admin display name and its log/print strings), `services/github_repository_service.py` (User-Agent string sent to GitHub), `services/assignment_external_evaluation.py` (AI prompt copy), logger names (`logging.getLogger("CampusGrade.X")` across half a dozen files — purely internal, cosmetic).
- Frontend: `app/layout.tsx` (title/description/OG metadata), `layouts/DashboardLayout.tsx` (sidebar header text, breadcrumb root label), `lib/navigation.ts` (fallback page label), `app/login/page.tsx` (hero heading, "CampusGrade at KRMU", footer tagline), `components/BulkExternalEvaluationDialog.tsx` (data-handling warning copy), `app/(dashboard)/assignments/[id]/review/page.tsx` (three user-facing strings).
- Docs/config: `README.md`, `CLAUDE.md`, `MIGRATION_PLAN.md`, `.env.example` (both root and backend), `alembic.ini` sample URL — update prose references for consistency.

**Needs a decision, not just find-and-replace:**

- `backend/routes_fastapi/institution_routes.py` — the literal string `"CampusGrade"` is the *default* institution name returned when no `AppSetting` row overrides it. This is what actually renders as the org name in parts of the UI. Update the default, and if an `AppSetting` already has "CampusGrade" saved in a real deployment, that stored value also needs updating via the admin settings UI or a data migration — a source-code rename alone won't fix an already-configured install.
- The refresh-token cookie is literally named `canvasgrade_refresh` (`auth_routes.py`, `user_routes.py`). Renaming it is a functional change: every logged-in user gets signed out the moment this ships, because the old cookie name stops being read. That's an acceptable one-time cost for a planned rename, but call it out at deploy time rather than let it surprise anyone.

**Leave untouched:**

- Alembic migration revision IDs (`canvasgrade_001` … `canvasgrade_015`) — these are internal migration-chain identifiers, not user-facing, and renaming them risks breaking the migration history. Don't touch.
- The actual Postgres database/role name (`canvasgrade_db`, `canvasgrade` user) — renaming a live database is an infra operation with its own risk; only update the `.env.example` *sample* value, not force a real rename.
- `requirements.txt` pip-compile `# via canvasgrade` annotation comments — auto-generated, will resolve themselves next `uv sync`/compile.

---

## 2. Department removal (SOET-only)

Department is more deeply wired in than it looks: `SqlCourse.department_id` is a **NOT NULL** foreign key today, and `SqlSubject`'s uniqueness constraints are keyed off `department_id`. Fully deleting the concept from the schema means relaxing that NOT NULL constraint, reworking two unique constraints, and migrating existing data — real schema risk for a school that only has one department anyway.

**Recommended approach: keep the column, remove the choice.** Seed a single `Department` row ("School of Engineering and Technology" / SOET), silently default every Program to it server-side, and remove every place a user is asked to *select* a department. This satisfies "remove all selected references where need to select department" without a risky migration, and leaves a clean path to fully drop the column later if ever needed.

**Backend:**

- Data step: consolidate any existing department rows into one SOET row; backfill all `courses.department_id` to point to it.
- `schemas/academic.py`: make `CourseCreate.department_id` optional; default to the SOET department's id inside the route handler rather than requiring it from the client.
- `routes_fastapi/admin_routes.py`, `add_student` handler (~line 619): remove the "Program is not linked to a valid department" 409 check — once every course always resolves to SOET, this becomes dead code, but the removal should be deliberate, not just left as unreachable.
- `routes_fastapi/admin/departments.py`: keep the CRUD endpoints (useful for the seed step and any future re-expansion) but nothing in the UI should call them anymore.

**Frontend:**

- Remove `admin/departments/page.tsx` from the sidebar (`lib/navigation.ts`) — page itself can stay in the codebase, unrouted, or be deleted; deleting is cleaner if there's no plan to ever reintroduce multi-department support.
- `admin/programs/page.tsx`: remove the required Department `<select>` from the add/edit form, remove the Department column from the (soon-to-be-card, see §6) list, remove the Department filter dropdown from the toolbar.
- `admin/subjects/page.tsx`: same three removals (required field, column, filter).
- `admin/students/page.tsx`: remove the read-only auto-filled Department field from add/edit forms and the Department filter dropdown from the list toolbar.
- `admin/teachers/page.tsx`: same pattern as students (confirm exact usage while implementing — research flagged this page follows the same family of patterns but wasn't read line-by-line).
- Profile / admin user-detail pages: department currently displays as read-only info; low-priority cleanup, can leave (it'll just always show "SOET") or remove for tidiness.

**Open question to settle before coding:** do you want the Departments CRUD page fully deleted, or just unlinked from navigation (so it still exists at `/admin/departments` for anyone with the direct URL, in case SOET ever needs a second department down the line)?

---

## 3. Add "semester" to the Add Student form

No semester concept exists anywhere today — not as a field, not as a structural entity. The question is whether semester should be a simple attribute (like the existing `year` field on `SqlUser`) or a full structural entity with its own table, the way Section is.

**Recommended approach: simple attribute, not a new entity.** Section exists as its own table because many students, subjects, and teacher allocations are scoped *to* a section — it's a real organizing unit. Semester, as described ("select semester of currently studying"), is just a student's current standing — closer to the existing `year` integer field than to Batch/Section. Modeling it as a full cascading entity (its own table, its own CRUD page, wired into every cascade) would be significant extra work for something that's fundamentally "which number is this student on right now."

**Backend:**

- Migration: add a nullable `semester` integer column to `users` (mirrors how `year` already exists on `SqlUser`).
- `schemas/user.py`: add `semester: int | None` to `StudentCreate`/`StudentUpdate`.
- `admin_routes.py` (or `admin/users.py`) student create/update handlers: accept and persist `semester`; include it in list/detail response serialization.
- Validation: bound `semester` between 1 and `2 × course.duration_years` (a program with a 4-year duration has up to 8 semesters) — validate against the selected program's `duration_years` rather than a hardcoded max.

**Frontend:**

- `admin/students/page.tsx`, Tab 2 "Academic" section: add a Semester `<select>` next to Batch/Section, populated as `1..(2 × selectedCourse.duration_years)` once a Program is chosen (mirrors how Batch options already depend on the selected Program).
- Add `semester` to the `AddStudentForm`/`EditStudentForm` TypeScript interfaces, to `getAddStudentFieldErrors`/edit-form validation, and to the submit payload in `handleAddSubmit`/`handleEditSubmit`.
- Decide whether semester is required or optional — recommend optional at first (a transfer/gap-year student might not cleanly map to a semester number), with required-ness revisited once real data shows how consistently it's needed.

---

## 4. Sidebar: add Profile/Settings buttons, reorder

Today Profile and Settings are reachable only through the small avatar popover at the bottom of the sidebar — they have no dedicated nav entry. `lib/navigation.ts` defines `roleNavigation` per role; `layouts/DashboardLayout.tsx` renders it plus the separate avatar popover (with Profile, Settings, and Sign out links).

**Plan:**

- Add a new "Account" section to `roleNavigation` (same for admin/teacher/student) containing Profile (`/profile`) and Settings (`/settings`), rendered through the same generic section renderer already used for the other sections — no new rendering logic needed, just new data.
- Trim the avatar popover down to Sign out only, so Profile/Settings aren't duplicated in two places in the UI. (If you'd rather keep both for redundancy, that's a one-line difference — flag it if you want that instead.)
- Reordering, once Department is removed (§2) and Account is added (§4):
  - **Admin**: Assignments (Home, All Assignments) → Academic Structure (Programs, Batches, Sections, Subjects) → People (Students, Teachers) → Administration (Audit log) → Account (Profile, Settings).
  - **Teacher**: Assignments (Home, Create assignment, Analytics, Discussions, History) → Account (Profile, Settings).
  - **Student**: Assignments (Home, Subjects, My teachers, Discussions) → Account (Profile, Settings).

This keeps the existing top-to-bottom logic (primary workflow first, structural/admin config in the middle, account controls last) rather than introducing a new ordering scheme.

---

## 5. Programs/Batches/Sections: card-based layout with counts

Today these are plain HTML tables. Programs and Batches already return `total_students` from the backend (`get_courses`/`get_batches` in `admin_routes.py` precompute per-record student counts); Sections do too. Subjects returns none of these counts today. None of the four pages currently return teacher counts or subject counts.

**Backend work needed before the UI can show the new numbers:**

- `get_courses` (Programs): add `total_subjects` and `total_teachers` per program alongside the existing `total_students`.
- `get_batches`: add `total_sections` (and optionally `total_subjects` via the parent program) alongside `total_students`.
- `get_sections`: `total_students` already exists; a teacher count is possible but there's no subject count at the section level, since subjects attach to Program/Batch, not Section — worth confirming this is intentional before promising a "subjects" stat card on Section cards.
- `get_subjects`: currently returns none of these — would need `total_teachers` (students enrolled via `student_subject_enrollments`, teachers via the allocation scan below) and `total_students` (`SqlStudentSubjectEnrollment` count) added.
- **Open question, needs a look before implementation**: teacher-to-subject/section assignment is stored as a JSON list (`SqlUser.assignments`) on each teacher row — there's no join table. Computing "how many teachers teach this program/batch/section/subject" means scanning every teacher's JSON allocations and matching `program_id`/`batch_id`/`section_id`/subject name (the pattern already used in `/me/teaching-scope`), not a simple SQL join or count. That's workable at the scale of one school, but it's a different (slower, more code) query shape than the existing `total_students` counts, and worth confirming is acceptable before committing to it.

**Frontend work:**

- Replace the `<table>` layout on all four pages (Programs, Batches, Sections, Subjects) with a card grid: one outer card per record (Program/Batch/Section/Subject), each containing a small header (name, code, key attributes) and a row of inner stat-cards (Students, Teachers, Subjects/Sections as applicable) plus the existing edit/delete actions.
- This is a new reusable pattern, not a copy-paste per page — worth building one shared component (e.g. an `EntityCard` + `StatChip` pair) that all four pages consume with different stat configurations, rather than four independent card implementations.
- The existing 3-stat summary strip above each table (e.g. "Total Programs / Departments Covered / Codes Assigned" on the Programs page) will need its stats revisited too, since "Departments Covered" goes away with §2.

---

## 6. Admin home "Program Progress": drop the dropdown, always show all programs

Today `AdminMonitoring` (inside `components/assignments/AssignmentDashboardView.tsx`) renders a Program `<select>` (defaulting to "all") next to a bar chart of Assignments/Submissions/Missed, fed by `getAdminAssignmentDashboard(...)`. The backend endpoint (`/assignments/admin-tools/dashboard`) already returns a full per-program breakdown regardless of any filter — `program_id` is only an optional query param, so the data needed to show every program at once is already there.

**Plan:**

- Remove the `programId` state and the `<select>` control entirely.
- Always render the bar chart across the full `programs` array returned by the dashboard endpoint (assignments assigned / submissions / missed per program, same three-bar shape that already exists) — no backend change needed here, since the API already returns this without requiring a filter.
- One thing to confirm while implementing: check exactly how the chart currently behaves when `programId === "all"` — if "all" today already means "show every program," this change may be closer to just deleting the select and its handler than to changing the chart logic; if "all" currently means something else (e.g. an aggregated single bar), the chart's data-shaping code will need a small adjustment to always use the per-program array instead.

---

## 7. Academic session switcher (2025-2026 Even / Odd, top-right dropdown)

This is the largest and newest piece — there is no session/term/academic-year model in the schema today. The only related thing that exists is a plain `academic_year_start`/`academic_year_end` date pair inside the admin dashboard's reporting settings, which is just a default date-range window for reports, not a real structural concept.

Two ways to build this, genuinely different in scope — worth deciding which one you want before any code is written:

**Option A — display/reporting scope only (lighter).** Add an `AcademicSession` table (`id, label` e.g. "2025-2026", `term` e.g. "Odd"/"Even", `start_date`, `end_date`, `is_current`). Add a top-right dropdown (next to the account avatar in `DashboardLayout.tsx`'s topbar) that lets a user switch which session they're "viewing." The selected session is stored client-side (URL param or local state) and passed as a filter to whichever admin dashboards/reports make sense to scope by date range — essentially replacing the existing ad hoc `academic_year_start/end` settings with a proper, switchable list of named sessions. Assignments, students, and enrollments themselves are **not** tagged with a session — this only changes what date range reports are computed over.

**Option B — full structural scoping (heavier).** Every assignment (and possibly every enrollment) gets tagged with the session it belongs to. The dropdown becomes a real global filter: switching sessions changes which assignments/submissions/rosters are visible throughout the app, not just report date ranges. This requires: a migration adding `session_id` to `SqlAssignment` (and deciding whether `SqlStudentSubjectEnrollment` needs one too, since a student's subject enrollment can span sessions), backfilling all existing assignments into a default "current" session, and auditing every list/query in `assignment_routes.py` that currently has no session concept to add a session filter. This is a multi-week piece of work by itself, comparable in size to the earlier Vite→Next.js migration, and touches almost every list endpoint in the app.

**Recommendation:** start with Option A. It delivers exactly what was asked ("give switch option") with a fraction of the risk, and the `AcademicSession` table it introduces is forward-compatible — Option B can be layered on top later by adding a `session_id` foreign key wherever needed, without redoing the dropdown or the session model itself.

**Backend (Option A):**

- New model `SqlAcademicSession`: `id`, `label` (e.g. "2025-2026"), `term` (enum: "odd"/"even"), `start_date`, `end_date`, `is_current` (boolean, one row true at a time).
- CRUD router under `/admin/academic-sessions` (mirrors the existing Department/Course CRUD pattern) so an admin can create "2025-2026 (Odd)" and "2025-2026 (Even)" and mark one current.
- `GET /assignments/admin-tools/dashboard` (and any other report endpoint that currently reads `academic_year_start/end` from settings) gains an optional `session_id` param; when provided, use that session's `start_date`/`end_date` instead of the settings default.

**Frontend (Option A):**

- New dropdown in `DashboardLayout.tsx`'s topbar (near the avatar/notification icons), listing sessions from a new `GET /admin/academic-sessions` call, defaulting to whichever is `is_current`.
- Selected session id flows into the admin dashboard's existing `getAdminAssignmentDashboard(...)` call as a query param, alongside (or replacing) the existing `{from, to}` params.
- A small admin settings page (or a tab on an existing settings page) to create/edit sessions and flip which one is current.

**Open question to settle before coding:** should the session switcher be admin-only, or should teachers/students also see and use it (e.g. to view historical rosters)? That changes whether the dropdown belongs in the shared topbar for all roles or only in the admin-scoped part of the layout.

---

## Summary of net-new backend work across all six items

- One new table: `academic_sessions` (§7).
- One new column: `users.semester` (§3).
- One department consolidation + a handful of now-optional/defaulted fields, no schema deletion (§2).
- Three endpoints (`get_courses`, `get_batches`, `get_subjects`) gain new aggregate-count fields; one endpoint (`get_sections`) reuses an existing pattern (§6).
- No changes needed to `assignment_routes.py`'s dashboard endpoint for §3 (it already returns per-program data) — only the frontend's use of it changes.
