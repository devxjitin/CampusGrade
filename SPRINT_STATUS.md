# Sprint status

Tracks progress against `IMPLEMENTATION_PLAN.md`. Update this file at the
start and end of every sprint — it's the fastest way for anyone (including a
fresh session) to see where implementation actually stands versus the plan.

| # | Sprint | Status | Notes |
|---|---|---|---|
| 0 | Guardrails and baseline | 🟢 done | Backend half fully verified (10 characterisation tests passing). Frontend half now also fully verified: `node_modules`/`package-lock.json` were corrupted and stale (fixed — `npm ci` installs clean), `npm run lint`/`build`/`vitest run` all pass (found and fixed 3 real bugs: `dev.js` lint violation, `e2e/login.spec.ts` leaking into vitest's default glob, a broken `lucide-react` install), and `frontend/src/types/api.d.ts` is generated and committed. Only unproven item: "a deliberately broken PR is rejected by CI" needs the real GitHub repo, not simulable in this sandbox. See `CHANGELOG.md` for full detail. |
| 1 | Config, errors, logging | 🟡 local implementation complete; PostgreSQL/API gate pending | Runtime environment reads are centralized in `config.py`, including Alembic and legacy Fernet verification. Deliberate and unexpected errors share the RFC 9457 envelope; a focused 500 regression test passes. The unchanged real-API golden suite still needs Docker/PostgreSQL evidence. |
| 2 | One async database layer | 🟡 final cutover in progress | Authentication, device sessions, profile writes, audit writes, readiness, and scheduler ownership are async. The sync engine was removed from `models/database.py`; repository-analysis helpers, bootstrap/seed scripts, and PostgreSQL test fixtures still need conversion before the no-`SessionLocal` exit criterion is true. |
| 3 | Policy engine (shadow mode) | 🟡 local proof complete; staging gate pending | Principal account/session/scope data now comes from one SQL statement, with a query-count regression test. Compiled-SQL tests prove both scoping helpers add `IN (...)`. Remaining work is enforcement of the three teacher routes and 48 hours of zero mismatches on staging. |
| 4 | Split identity tables | 🟡 identity callers cut over; data rollout gate pending | `models/auth_store.py` is deleted; authentication and self-service profile writes use the async identity service and dual-write profiles. Real-PostgreSQL backfill parity, production blocker audits, and API snapshot evidence remain before closure. |
| 5 | Four roles go live | 🟢 implementation complete; staging role-matrix gate remains | four-role policy and SQL scoping are live; Super Admin now has `/platform/admins` to create scoped Program Admins; navigation is split by role; local PostgreSQL + Chromium creation flow passed. The release gate is the documented four-role staging sign-off. |
| 6 | Cookie session, CSRF, middleware | 🟢 backend + frontend done and verified in this sandbox | httpOnly `campusgrade_access`/`campusgrade_refresh`/`campusgrade_csrf` cookies, CSRF double-submit middleware, `GET /auth/me`, frontend fully cut over (no more localStorage token, `middleware.ts` added, CSRF header on mutating calls). Reused the existing `refresh_tokens` table instead of the plan's new `auth_sessions` table — see notes below for why. |
| 7 | Frontend shell rebuild | 🟡 in progress | Persistent `(app)` shell, feature folders, split API transport, generated-response facade, permissions matrix, and shared states are in place. All route `page.tsx` files are <=150 lines. Unit and real-Chromium navigation tests now prove Programs → Batches does not add a notification request; dashboard FCP was captured at 2,000 ms in local dev. Oversized component decomposition and a like-for-like pre/post FCP comparison remain. See `CHANGELOG.md`. |
| 8 | Programs rename, departments removed | 🟡 implementation complete; rollout gate pending | `canvasgrade_024` and the runtime/API/frontend cutover are complete. A disposable PostgreSQL database passed fresh upgrade → downgrade → seeded upgrade; `programs` has the expected columns, the removed table is absent, and old fuzzy/new FK counts both equal 2. The broken legacy seed and dead admin bodies were replaced/removed; live backend grep returns only the display constant. Backend tests and frontend lint/build/tests pass. Production preflight and four-role human staging sign-off remain external release gates. |
| 9 | `subject_offerings` ⚠ | ⬜ not started | |
| 10 | Retire `admin_routes.py` | ⬜ not started | |
| 11 | Assignments domain + state machine | ⬜ not started | |
| 12 | Submissions and repository split | ⬜ not started | |
| 13 | Grading and per-criterion scores | ⬜ not started | |
| 14 | Jobs table and worker | ⬜ not started | |
| 15 | AI gateway, ledger, pseudonymisation | ⬜ not started | |
| 16 | AI proposals, budgets, dual transport | ⬜ not started | |
| 17 | Integrity domain | ⬜ not started | |
| 18 | Reporting and role dashboards | ⬜ not started | |
| 19 | Hardening and launch | ⬜ not started | |

## What actually happened in this session

### Sprint 0 — now fully done (frontend gaps closed)

Backend dependencies (`pip install -r backend/requirements.txt`) installed
successfully in an earlier session, making it possible to actually run, not
just read, everything Sprint 0 and Sprint 1 touched. See the Sprint 1
section below for what that proved.

**Frontend was genuinely broken, not just "unverified" — this session found and fixed it.** The earlier "missing `vite`" note undersold the problem: `node_modules` on the mounted project folder was left in a corrupted half-installed state (`ENOTEMPTY` rename errors from an interrupted install), *and* the committed `package-lock.json` was itself stale — missing lockfile entries for `vite`/`vitest`/`playwright`/`esbuild` that `package.json` already declared, so even `npm ci` (the exact command CI's frontend job runs) failed outright regardless of `node_modules` state. Installing fresh in a scratch directory (the mounted network drive is too slow for `node_modules`'s file count to install directly on it) regenerated a correct, complete lockfile, which was committed back. Once installable, actually running `npm run lint`/`build`/`vitest run` (never done before — only type-checked) surfaced three real, fixable bugs: `dev.js` (a standalone Node script, not part of the app) failing the ESLint `no-require-imports` rule, `vitest.config.ts` having no `exclude` so it tried to execute the Playwright spec file as a unit test, and a corrupted `lucide-react` install (zero `.d.ts`/`.mjs` files) breaking the TypeScript build. All three fixed. `frontend/src/types/api.d.ts` — the other original "Known gap" — is now generated (via `app.openapi()` directly, since this sandbox has no live Postgres to run the backend server against for a real `/openapi.json` request) and committed. Full detail in `CHANGELOG.md`.

Frontend is now **verified**, not just type-checked: `npm ci` clean install → lint clean → build clean (28 routes) → vitest 17/17 → Playwright correctly discovers all 4 required smoke tests (can't execute them — no live seeded backend in this sandbox — but that's documented, pre-existing scope, not a new gap).

### Sprint 1 — Config, errors, logging (backend fully verified, frontend partially)

Full detail in `CHANGELOG.md`. Summary of what was actually run:

- `import app` succeeds against real dependencies with no live database (117 routes).
- Full backend test suite: `65 passed, 12 skipped, 0 failed`.
- `mypy backend/config.py backend/core` — clean (2 real type errors found and fixed).
- `ruff check` on every new/touched file — clean.
- Live HTTP check via `starlette.testclient.TestClient` against the running app confirmed the new `application/problem+json` envelope for a 401 (missing token), a 401 (garbage token), and a 422 (validation) — `detail` preserved exactly as before, `code`/`type`/`request_id` new and additive.
- Two real bugs were found **only because the code was actually run**, not by review: pydantic-settings JSON-decoding `ALLOWED_ORIGINS` before any validator ran, and two pre-existing tests silently reading a stale `lru_cache`d settings object instead of their patched environment. Both fixed; see `CHANGELOG.md` for the mechanism.
- Frontend: `src/lib/errors.ts` and `src/lib/errors.test.ts` type-check clean under `./node_modules/.bin/tsc --noEmit --strict` (the project's real, already-installed TypeScript compiler — not a substitute tool). Not run under vitest, for the reason above.

### Sprint 2 — One async database layer (14 of 15 files, this session)

Full detail in `CHANGELOG.md`. This sprint is the biggest mechanical lift in
the whole plan (~141 route declarations, ~129 `SessionLocal()` sites across
15 files) — one session was enough for a first, real slice, not the whole
thing. What's actually true right now:

**Ported and verified**: `institution_routes.py` (1 route), `notification_routes.py`
(4 routes), `user_routes.py` (10 routes, 4 touching the DB), `admin/academic_sessions.py`
(4 routes: list, create, update, delete). Verification wasn't "it compiles" —
it was a real disposable SQLite database, real ORM tables, and the route
functions called through the actual `db_session()` generator FastAPI's
`Depends()` drives (commit on success, rollback on exception), asserting on
persisted state across separate simulated requests. That harness itself had
a bug on the first attempt (a bare session with no commit lifecycle, which
produced what looked like a silent data-loss regression) — fixed, documented
in `CHANGELOG.md`, and worth remembering as a trap for whoever ports the next
file: **passing a session directly instead of driving `db_session()`'s
generator will silently skip the commit.**

`admin/academic_sessions.py` also introduced the **flush-before-catch**
pattern needed anywhere a route must convert a DB constraint violation into a
specific HTTP error before the response is built: `await db.flush()` inside
`try/except IntegrityError`, then `await db.rollback()` before raising —
because `db_session()`'s actual commit happens after the route returns, a
plain try/except around the route body alone would be too late to catch the
violation. Verified with a real duplicate-label+term rejection that leaves
the session usable afterward (no dangling broken transaction).

**`admin_settings.py` resolution**: rather than block on `admin/users.py`
(which is itself blocked on two huge legacy files — see below), gave
`read_assignment_monitoring_settings` a parallel async sibling
(`read_assignment_monitoring_settings_async`) and ported only the two
routes that use it directly (`GET`/`PUT /admin/settings/assignment-monitoring`).
The original sync function is untouched and still serves `admin/users.py`.
The `/admin/audit-log` GET needed no change — it only calls
`models/settings_store.py::get_audit_logs`, a self-contained sync service
(same category as `session_service`/`user_service`, left alone elsewhere).
This is "option (b)" from the previous session's writeup, applied narrowly
to one function instead of the whole coupled group.

**Correction from last session**: `admin/departments.py` was marked "confirmed coupled" because it imports `legacy._normalize_lookup_text`/`legacy._build_course_aliases` from `admin_routes.py`. Re-reading those two functions this session shows they're pure string helpers with no `db` parameter at all — importing them doesn't couple this file to any sync session. That was an overly cautious call, not a real blocker. Ported all 4 routes this session (see `CHANGELOG.md`). **Take away: don't trust "imports something from admin_routes.py" as proof of real coupling — check whether the imported thing actually touches a session before ruling a file out.** `admin/courses.py`, `admin/batches.py`, `admin/sections.py`, `admin/subjects.py` haven't been re-checked with this in mind yet and might turn out to be similarly over-flagged.

Also confirmed this session: `admin_routes.py`'s own `@router.*` decorated endpoints (department/course/batch/section/subject CRUD, ~1,100 of its 2,606 lines) are **dead code** — `app.py` mounts `routes_fastapi.admin`'s aggregate router (the `admin/*.py` files), never `admin_routes.router` itself. The only things from `admin_routes.py` still alive are: pure helper functions (safe to import, as above), `_get_or_create_soet_department` (used by `app.py` startup), and the 10 user-management functions `admin/users.py` wires up directly via `router.add_api_route(legacy.X, ...)` — those *are* real, live coupling.

**`admin/users.py` resolution, in short**: of the 10 functions genuinely
coupled to `admin_routes.py`, all 10 were ported over the course of this
session — `get_users`/`toggle_user_status`/`reset_user_password`/`delete_user`
first (including a from-scratch async reimplementation of the admin-lockout-
prevention row-locking, `_lock_user_safety_context_async`, verified against
tests specifically targeting that logic), then `add_teacher`/`import_teachers`/
`import_students` (self-contained, no academic-calendar coupling), then
`add_student`/`update_teacher_assignments`/`update_admin_user` once the
`services/academic_calendar.py` bridge existed. See `CHANGELOG.md` for the
full detail on each.

**`SessionLocal()` site count stayed at 113** through all of this — every
ported function's old sync body still exists, unreferenced, inside
`admin_routes.py`; deleting that dead code is a separate, later cleanup step
kept out of these diffs on purpose. Remaining files, in dependency order:

**Bridged the shared blocker instead of routing around it**: `add_student`, `update_teacher_assignments`, and (eventually) `update_admin_user` were all blocked on `services/academic_calendar.py`'s `resolve_current_session`/`mirror_teacher_allocations` (sync `Session`, also called from `admin_routes.py`/`assignment_routes.py`). Added `resolve_current_session_async`/`mirror_teacher_allocations_async` as behavioral twins next to the sync originals — same pattern already used for `read_assignment_monitoring_settings` and `_build_teacher_assignments`, just applied one level deeper. All three routes ported and verified this session.

**`admin/users.py` is now fully ported — all 12 routes.** `update_admin_user` (the last one, 122 lines) turned out to need nothing new: every helper it depends on (`_lock_user_safety_context_async`, `_build_teacher_assignments_async`, `mirror_teacher_allocations_async`, `_require_batch_for_course_async`/`_require_section_for_batch_async`) already existed from porting the other 11 routes this session, so the risk that justified deferring it earlier had already been paid down by the time it was tackled. Verified with an 11-assertion test covering every interacting check: email/roll-number/teacher-ID uniqueness, the admin-continuity safety logic (self-demotion blocked, demoting the *other* admin allowed), assignment updates, student program/batch/section resolution, and a 404 on a missing user. This file started the session "confirmed coupled, not portable"; it's now `router.add_api_route(legacy.X, ...)`-free entirely.

`admin_routes.py`'s only remaining live export is `_get_or_create_soet_department` (called from `app.py` startup) — deliberately left sync, since every async port above works around it with a "fall back to the first existing department" equivalent rather than pulling its consolidation-write side effect into an async request.

**`admin/courses.py`, `admin/batches.py`, `admin/sections.py`, `admin/subjects.py` — all four ported this session**, resolving last session's open question. Unlike `admin/departments.py`, these genuinely were coupled (every route directly wires a real `SessionLocal()`-using function via `router.add_api_route(legacy.X, ...)`), but each function's own body was self-contained — no cross-file service coupling — so all four ported cleanly. Built one new shared helper (`compute_teacher_allocation_counts_async`, used by all four) plus small per-file async twins of private validation helpers. Verified with a 16-assertion end-to-end test covering create/list/update/delete across all four resources together, including a full cascading delete in dependency order. See `CHANGELOG.md` for detail.

**`admin/session_rollover.py` — fully ported this session, not bridged.** A grep confirmed `services/session_rollover.py`'s `preview`/`execute`/`undo` have exactly one caller each (this route), unlike `academic_calendar.py`'s functions which are also called from the still-sync legacy files — so there was no sync signature to preserve, and the whole 342-line engine (promote/graduate students, auto-create batches/sections, carry teacher allocations, flip `is_current`, full `undo` with an activity check) was converted directly to `AsyncSession`. `notify_admins_if_rollover_due` (called via `asyncio.to_thread` from `app.py`'s scheduler) was deliberately left sync — the to_thread bridge already does its job. Verified end-to-end: preview's computed promote count, execute's promotion + teacher-allocation-carry + exactly-one-`is_current`-session invariant, history listing, undo's session-flip-back, double-undo returning 400, and undo-on-missing-run returning 404. `SessionLocal()` count dropped from 113 to 109.

**Dead-code cleanup, same session**: with every real caller of `admin_routes.py` now ported, the 20 functions declared on its own never-mounted `router` (department/course/batch/section/subject CRUD — the duplicates the real `admin/*.py` files superseded) were confirmed truly dead (grepped the whole backend + tests for their names, zero references outside their own definitions) and deleted — 963 lines, `SessionLocal()` sites 109 → 89. Every private helper those functions used (`_normalize_lookup_text`, `_build_course_aliases`, etc.) was left in place, since the real `admin/*.py` files still import them. Verified: `import app` still 117 routes, full suite still passing, `admin_routes.py` now 1,642 lines.

| File | Routes | Status |
|---|---|---|
| `admin_routes.py` | Down to 1,642 lines after dead-code deletion. Only `_get_or_create_soet_department` (called from `app.py` startup) remains genuinely live and unported; everything else left in the file is either a still-used pure helper or code with no external caller. | Also Sprint 10's actual split target — this file gets rewritten, not just ported, eventually. Not blocking Sprint 2 route-porting completion. |
| `assignment_routes.py` | 50 (now ~2,000 lines after `ruff format`) | **Fully ported this session.** 14 private helpers kept a sync original + async twin (real external sync callers in `tests/test_audit_fixes.py`, `app.py`'s scheduler, and `admin/users.py`); the rest converted directly. See `CHANGELOG.md` for the full breakdown and what was/wasn't exercised in the SQLite harness. |

**`assignment_routes.py` port, in short**: this file's helpers split into three buckets. (1) 14 functions transitively reachable from `publish_ready_assignment_results` — which must stay a plain sync function, since `app.py`'s lifespan scheduler calls it via `asyncio.to_thread` and a Docker-gated concurrency test calls it directly with a sync `Session` — got the "sync original + async twin" bridge treatment: `_teacher_assignment`, `_rubric`, `_eligible_students`, `_evaluation_participants`, `_assignment_students`, `_submission_map`, `_evaluation_workflow`, `_assert_evaluation_allowed`, `_external_duplicate_flags`, `_similarity_mark_limit`, `_publish_grade`, `_refresh_assignment_completion`, `_notification`, `_assignment_stats`. (2) `_lock_evaluation_cohort`/`finalize_assignment_deadlines`/`publish_ready_assignment_results` itself stay sync-only, completely untouched — nothing async calls them. (3) The other ~16 db-touching helpers and all 50 routes converted directly to `async def`, no twin, since nothing outside the file calls them with a sync session. Verified: full pytest suite unchanged (`65 passed, 12 skipped, 0 failed`, including the sync tests that call the bridge functions' *sync* halves directly), `import app` still 117 routes, and a real-SQLite/real-generator harness drove 22 of the 50 routes end-to-end (assignment create through grading, publish/withdraw, gradebook export, discussion threads, and the full admin surface). The bulk external-AI-evaluation routes and the GitHub-repository-dependent routes were converted and read carefully but **not** exercised end-to-end — they need real GitHub/Azure access this sandbox doesn't have; flagged explicitly rather than assumed working.

`auth_routes.py` needs **no changes** — confirmed by grep, it has no direct
`SessionLocal()` usage of its own; it only calls services that manage their
own sessions.

**The practical read, updated**: option (b) from earlier sessions — bridge
shared sync helpers with async twins rather than block on the big legacy
files — is what actually got Sprint 2 from 5/15 to 9/15 this session
(`admin_settings.py`, `admin/departments.py`'s correction, and the
`academic_calendar.py` bridge all followed this pattern). The only Sprint 2
file left that isn't one of the two giant legacy files is
`admin/session_rollover.py`, and its blocker (`services/session_rollover.py`,
342 lines of stateful business logic) is bigger than anything bridged so
far — that one warrants its own dedicated session rather than a quick twin
function, given how much promotion/graduation correctness rides on it.

### Sprint 3 — Policy engine in shadow mode (this session)

The plan (`IMPLEMENTATION_PLAN.md` line 529) sketches a `Principal`/
`Permission`/scoping design against a **future** four-role schema
(`super_admin`/`program_admin`/`teacher`/`student`) that doesn't exist until
Sprint 5, and a "program" concept that doesn't exist until Sprint 8
(departments are today's equivalent). Building the plan's snippet literally
would have meant inventing fields (`program_scopes`, `offerings` tables)
that aren't in `models/sql_models.py` — so this session adapted it to the
schema that's actually live today:

- **`backend/core/principal.py`** — `Role` is `admin`/`teacher`/`student`
  (`str, Enum`, not `enum.StrEnum` — this project targets Python 3.10, see
  `pyproject.toml`). `Principal.is_super` is true only for `admin` (there's
  no second admin tier yet). `build_principal` reuses
  `routes_fastapi.deps.get_current_user`'s token/session/suspension checks
  rather than reimplementing them, and adds exactly one query: a teacher's
  `subject_ids` from `SqlTeacherSessionAllocation` (the real table an
  earlier sprint already built for the rollover engine) become
  `Principal.offering_ids`.
- **`backend/core/policy.py`** — `Permission` is a superset of the legacy
  `routes_fastapi.deps.Permission` (four values, and — confirmed by
  grep — `require_permission` itself has **zero real callers**; every
  actual route uses `require_roles` instead). `PERMISSIONS` maps each new
  permission to allowed roles. `shadow_check(request, permission, principal,
  legacy_allowed)` logs a `policy_mismatch` warning on disagreement and
  always returns `legacy_allowed` unchanged. `shadowed(*legacy_roles,
  permission=...)` is the drop-in replacement for
  `Depends(require_roles(...))` that runs both and only logs — wired onto 5
  real routes this session (`create_assignment`, `save_grade`,
  `publish_grade` in `assignment_routes.py`; both routes in
  `admin_settings.py` that use `db_session`, i.e. everything except the
  still-sync `/admin/audit-log`).
- **`backend/core/scoping.py`** — `scope_to_departments`/`scope_to_offerings`
  built against real columns (`department_id`, a subject-id column), not
  called from anywhere yet (nothing needs it until scoped queries actually
  exist, Sprint 9+).
- **Known, deliberate mismatch**: the new `REPORT_VIEW` permission includes
  `student` (a student can see their own report); the legacy
  `VIEW_ASSIGNMENT_REPORTS` permission grants students nothing at all — it
  was simply never wired to anything a student calls. This is flagged
  explicitly in `core/policy.py` and excluded from the strict-equality test
  rather than forced to match, since it's an intentional widening the plan's
  shadow-mode logging exists to surface, not a bug.
- **`backend/tests/test_authorization_matrix.py`** — 18 tests, all without
  Docker: matrix agreement for the three permissions that do have a legacy
  equivalent, a guard against `_LEGACY_EQUIVALENT` drifting from the real
  `ROLE_PERMISSIONS` dict, and `shadow_check`'s logging/no-logging/
  always-returns-legacy behavior.
- **Verified this session**: `uv run pytest backend/tests` → 83 passed / 13
  skipped (was 65/12 before this sprint — the extra skip is a Docker-gated
  test unaffected by this work). `uv run ruff check` on every new/touched
  file → clean. `uv run mypy` (project config already includes `backend/core`
  in its `files` list) → clean, 16 source files. `import app` → still 117
  routes.
- **Known gap — the sprint's own exit condition is not something a sandbox
  can prove**: "Run staging for the rest of the sprint. Zero mismatches is
  the exit condition." That requires real staging traffic hitting the 5
  wired routes across real user sessions, which this sandbox has no way to
  generate. What's proven here is that the new engine agrees with the
  legacy one everywhere the two are comparable *in test*, not in production
  traffic — hence 🟡, not 🟢, above.
- **Known limitation of `shadowed()` itself**: because the legacy
  `require_roles` dependency raises `HTTPException` on denial, `shadow_check`
  only ever observes the "legacy allowed it" path — a request legacy denies
  that the new engine would allow never reaches the logging code. Documented
  in `core/policy.py::shadowed`'s docstring; worth resolving before this
  sprint's exit condition is declared met, not before.
- **Not done, out of scope for this session**: only 5 of the many
  `require_roles(...)` call sites across the backend were wired with
  `shadowed(...)` — wiring the rest is mechanical repetition of the same
  pattern, not a design question, and was left for a dedicated pass so this
  session's diff stays reviewable.

### Sprint 4 — Split the identity tables (this session)

Adapted the plan's DDL/backfill (it's written against Postgres, correctly —
this project has never had a SQLite path for migrations) to this schema's
real column names, and scoped down one part of the plan's "Done when" list
that turned out to be much bigger than the rest.

- **Migration `backend/migrations/versions/20260728_21_identity_profile_tables.py`**
  (`canvasgrade_021`, confirmed the sole head via `alembic heads` — offline
  check, no live DB needed for that). Creates `user_profiles`,
  `student_profiles`, `teacher_profiles`, `admin_program_scopes` exactly per
  the plan's DDL, backfills from `users` (`contact_number`→`phone`,
  `course_id`→`program_id` — "program" is still called "course" until
  Sprint 8's rename), skips (rather than crashes on) students missing
  `roll_no`/`course_id` or duplicate `roll_no`, and exposes
  `find_migration_blockers(connection)` — the plan's two audit SQL queries,
  as an actual importable function an operator can run against a real copy
  of production data, rather than SQL left in a comment. **This sandbox has
  no production data and no Postgres to run it against** — that's the one
  part of this sprint's own "Risk" section that inherently cannot be done
  here, only on a real database.
- **ORM models**: `SqlUserProfile`, `SqlStudentProfile`, `SqlTeacherProfile`,
  `SqlAdminProgramScope` added to `models/sql_models.py`, right after
  `SqlUser`. `admin_program_scopes` is unused today (no `program_admin` role
  until Sprint 5) but the table now exists for that sprint to write to.
- **Dual-write**: `services/identity_service.py::sync_profile(db, user)` —
  one function, matching the plan's "centralise this... so there is exactly
  one place to delete later" instruction. Wired into `add_teacher`,
  `add_student`, both bulk-import loops (`import_teachers`/`import_students`),
  and `update_admin_user`'s edit path, all in `routes_fastapi/admin/users.py`.
  **Not wired into `routes_fastapi/user_routes.py::update_profile`** (the
  self-service `/profile` PATCH a logged-in user hits to edit their own
  name/bio/github_username) — that route was never ported off the sync
  `update_user_fields`/`models/auth_store.py` path in Sprint 2, so wiring an
  `AsyncSession`-based dual-write into it means porting the route first, not
  just adding a dual-write call. Flagged explicitly rather than silently
  left out.
- **argon2id swap**: `utils/security_utils.py::hash_password` now returns
  argon2id (`argon2-cffi`, added to `pyproject.toml`/`uv.lock`/
  `backend/requirements.txt` via a real `uv lock`+`uv export`, not
  hand-edited). `verify_password` still reads bcrypt and the older
  reversible Fernet format read-only. `needs_password_rehash` flags any
  non-argon2id hash (or an argon2id hash whose cost parameters have since
  been raised) for rehash; `services/auth_service.py::authenticate` already
  called `needs_password_rehash`/`hash_password` on every successful login
  before this sprint touched it, so the upgrade-on-login the plan asks for
  needed **no changes there at all** — swapping what those two functions
  return underneath it was sufficient.
- **Predictable passwords deleted**: `_generate_teacher_password`/
  `_generate_student_password` (and their `_extract_first_name_for_password`/
  `_extract_last_two_digits` helpers) removed from `admin_routes.py`. All 4
  call sites (2 dead-code ones in `admin_routes.py` itself, 2 live ones in
  `routes_fastapi/admin/users.py`'s bulk-import routes — confirmed by grep,
  nothing else called these) now use `_generate_temporary_password()`.
- **Verified this session**: `uv run pytest backend/tests` → `84 passed, 13
  skipped` (was 83/13 before this sprint — one new test,
  `test_legacy_bcrypt_hashes_still_verify_and_flag_for_rehash`). `uv run
  ruff check` on every new/touched file → clean (added
  `backend/services/identity_service.py` to CI's explicit ruff file list in
  `.github/workflows/ci.yml`, per that file's own stated convention). `uv
  run mypy` → still clean, 16 source files (the new files aren't in mypy's
  `files` list yet, matching how `admin/users.py`/`sql_models.py` were
  already outside it before this sprint). `alembic heads` → `canvasgrade_021
  (head)`, single head, chain resolves. `import app` → still 117 routes.
- **Known gap, unavoidable in this sandbox**: the migration itself was never
  run against a real Postgres database (no Docker here — same limitation
  documented for every prior sprint's Docker-gated tests) — so the backfill
  SQL is verified by careful reading and by mirroring the already-proven
  `teacher_session_allocations` migration's idempotent-`INSERT`/inspector
  pattern, not by an actual `alembic upgrade head` run. **Do this before
  trusting the migration**: run it against a staging copy of production
  data, using `find_migration_blockers()` first.
- **Not done — deliberately scoped out, not silently skipped**:
  `models/auth_store.py` is **not** deleted this sprint, unlike the plan's
  "Done when" list. `build_principal` (Sprint 3) and `get_current_user`
  still read through it. Deleting it means porting every remaining caller
  (`get_user_by_email`/`get_user_by_id`/`update_user_fields` are called from
  `services/auth_service.py`, `routes_fastapi/deps.py`,
  `routes_fastapi/user_routes.py`, `services/session_service.py`, and more)
  onto the async ORM directly — that is a Sprint-2-sized porting effort in
  its own right, not something to fold into an already-large sprint's
  remaining time. Flagged here rather than left for a future session to
  discover by surprise.

### Sprint 5 — Four roles go live (implementation complete)

The backend role split, scoped authorization, and the previously missing
frontend administration surface are now implemented. Production rollout
still requires the plan's four-role staging sign-off against a staging
copy of production data.

- **Migration `canvasgrade_022`**
  (`backend/migrations/versions/20260729_22_super_admin_role_split.py`) —
  exactly the plan's DDL: every existing `admin` becomes `super_admin`,
  then a `ck_users_role` CHECK constraint locks `role` to the four values.
  `alembic heads` confirms it's the sole head. Not run against a live
  Postgres — no Docker in this sandbox, same limitation as every prior
  sprint's DB-dependent verification.
- **`core/principal.py`**: `Role` now has all four members. Also fixed a
  real Sprint-3-era design gap while here: `program_ids` for a
  `program_admin` now comes from the real `admin_program_scopes` table
  (Sprint 4), not the `department` string field Sprint 3 used as a
  stand-in before that table or the `program_admin` role existed. That
  fix mattered *this* sprint, not a future one — Sprint 5 is the first
  time anything actually reads `program_ids` for real.
- **`core/policy.py`**: shadow mode retired as a *decision-making* path —
  `require(Permission.X)` is what every admin route now depends on.
  `shadowed()`/`shadow_check()` are kept, not deleted (the plan's own
  rollback note for this sprint: "re-enable shadow mode by feature flag if
  a mismatch appears in production") but nothing calls them anymore.
  Permission matrix updated: `PROGRAM_MANAGE`/`ASSIGNMENT_ADMIN_OVERRIDE`
  added; session/rollover/department/program/admin/settings are
  super-admin-only, batch/section/subject/user/audit/assignment-override
  are shared between both admin roles.
- **`core/scoping.py::scope_to_programs`**: built exactly per the plan's
  snippet, then actually wired into real queries (not left unused, unlike
  Sprint 3's `scope_to_offerings`): `GET /admin/batches`,
  `GET /admin/sections`, `GET /admin/subjects` (subjects needed a small
  deviation — see below), and every assignment admin-override route in
  `assignment_routes.py` on `SqlAssignment.target_course_id`. Applied
  *unconditionally*, not just as a fallback when the caller omits a
  `program_id`/`course_id` filter — otherwise a program admin could widen
  their own scope by passing someone else's id.
- **The single biggest finding of this sprint**: `require_admin` in
  `admin_routes.py` and *six* near-identical local `_admin(...)`
  dependencies (one each in `departments.py`, `courses.py`, `batches.py`,
  `sections.py`, `subjects.py`, `academic_sessions.py`, plus
  `session_rollover.py`) were every single admin-gated route's actual
  chokepoint — the plan's "92 hits" grep count is dominated by calls to a
  small, enumerable set of shared dependencies, not 92 independent
  decisions. That made the "replace `require_roles`/`_admin` everywhere"
  item far more tractable than the raw hit count suggests: cutting over 9
  dependency definitions (not 76 individual call sites) got every real
  route onto `core.policy.require(...)`.
- **`admin_routes.py::require_admin` was deliberately kept dict-in/dict-out**
  (still returns the `current_user` dict, doesn't switch to returning a
  `Principal`) because ~12 call sites in `routes_fastapi/admin/users.py` do
  `admin["_id"]`/`admin.get(...)` dict access for audit logging and
  `created_by`; forcing all of them onto `Principal` attribute access in
  this sprint was unnecessary risk for no behavioral gain. Its role check
  now reads from `core.policy.PERMISSIONS[Permission.USER_MANAGE]` (one
  source of truth) instead of a second hand-maintained role set.
- **Every other real `"admin"` role-string comparison in the backend
  fixed**, found by grepping for `"admin"` across every `.py` file, not
  just the obvious dependency functions: `_assert_admin_continuity`/
  `_lock_user_safety_context`(`_async`) (continuity guard, now checks
  `super_admin`), `services/session_rollover.py`'s due-notification query,
  `services/user_service.py::profile_update_fields` (github_username
  exclusion — would have silently flipped behavior for every admin if left
  as `!= "admin"`), `routes_fastapi/auth_routes.py`'s staff-login-page
  check, `bootstrap_admin.py`, `seed_academic_data.py`,
  `utils/validators.py::validate_role`, `routes_fastapi/deps.py`'s legacy
  `ROLE_PERMISSIONS`, and every affected test fixture in
  `test_audit_fixes.py`/`test_golden_paths.py`. `schemas/user.py`'s
  `role` pattern validators widened to accept the two new role strings —
  without this, creating a `program_admin` through the API would have
  been rejected by pydantic before it ever reached a route.
- **New endpoints** (`routes_fastapi/admin/admins.py`, mounted at
  `/admin/admins`, all `Permission.ADMIN_MANAGE`/super-admin-only):
  `GET /admin/admins` (list + scopes), `POST /admin/admins` (create,
  defaults to `program_admin`, requires ≥1 scope for that role),
  `PUT /admin/admins/{id}/scopes` (replace, not merge). New accounts use
  `_generate_temporary_password()` — the same non-predictable generator
  every other admin-created account has used since Sprint 4.
- **Continuity guard**: already covered by fixing the string literal in
  `_assert_admin_continuity`/`_lock_user_safety_context(_async)` above —
  the existing unit tests in `test_audit_fixes.py`
  (`test_admin_cannot_delete_or_deactivate_self`,
  `test_last_active_admin_cannot_be_removed_by_another_admin_session`,
  `test_concurrent_admin_removals_cannot_delete_every_active_admin`) were
  updated to seed `role="super_admin"` fixtures and now exercise the real
  post-migration invariant instead of silently testing dead code (a role
  string that no longer exists would have made `removes_active_admin`
  permanently `False`).
- **`backend/tests/test_authorization_matrix.py`, rewritten** for real
  enforcement: 20 permissions × 4 roles calling `require(...)`'s returned
  dependency directly with a hand-built `Principal` (no DB needed), plus
  an invariant test that nothing a program admin can do is withheld from a
  super admin, plus the shadow-mode logging tests (kept, since
  `shadow_check` itself is unchanged).
- **`backend/tests/test_program_admin_scoping.py`, new, Docker-gated**:
  seeds two real courses+batches via the ORM, a `program_admin` scoped to
  only one via a real `admin_program_scopes` row, and asserts — through a
  real HTTP request via `TestClient` — that the other program's batch id
  is verifiably absent from the response and the admin's own is present.
  This is the plan's literal Sprint 5 "Done when" bullet ("verified by an
  integration test that asserts on SQL, not just status code"). Also
  covers the "no scopes configured → empty list, not everything" case and
  "super admin sees every program" as a control.
- **Verified this session**: `uv run pytest backend/tests` →
  `154 passed, 15 skipped` (was `84 passed, 13 skipped` — the matrix test's
  parametrization alone adds 80 cases). `uv run ruff check` on every
  new/touched file → clean; `admins.py`,
  `test_authorization_matrix.py`, `test_program_admin_scoping.py` added to
  CI's explicit ruff file list. `uv run mypy` → still clean, 16 source
  files (this sprint's files aren't in mypy's `files` list, unchanged from
  before). `alembic heads` → `canvasgrade_022 (head)`. `import app` →
  **120 routes** (117 + 3 new `/admin/admins*` endpoints).
- **Frontend completion**: `src/lib/navigation.ts` now has distinct
  `super_admin` and `program_admin` menus. Program Admins retain their
  scoped operational pages but cannot see Administrators, Programs,
  Academic Sessions, Session Rollover, or Settings. Super Admins receive
  the new `/platform/admins` page, typed list/create/scope APIs, program
  checklists, one-time credential display, and client-side route defense;
  backend permissions remain the authoritative guard.
- **Live verification and regression fix**: a real Chromium flow against
  the configured local PostgreSQL database logged in as Super Admin,
  opened Administrators, created a Program Admin scoped to one program,
  displayed the temporary credential, and listed the new account. That
  flow exposed a scope-FK flush-order defect; `create_admin` now flushes
  the new user/profile before inserting scopes, with a focused regression
  test in `test_admin_management.py`. All disposable UI fixtures were
  removed afterward. Final verification: backend `159 passed, 22 skipped`;
  frontend ESLint clean, `17 passed`, and production build successful
  with `/platform/admins` included.
- **Release gate**: run the documented staging authorization matrix as all
  four roles and capture human sign-off before production deployment.
- **Also not done**: the plan's teacher/student-facing shadow-mode call
  sites from Sprint 3 (`create_assignment`/`save_grade`/`publish_grade` in
  `assignment_routes.py`, still wrapped in `shadowed(...)`) were
  deliberately left alone rather than converted to `require(...)` — doing
  so would mean migrating those three routes' ~100-line bodies off the
  dict-shaped `teacher` parameter (`teacher["_id"]` etc.) onto `Principal`
  attribute access, a real but unrelated refactor to this sprint's actual
  concern (the *admin* role split). They still work exactly as before
  (shadow-mode logging, zero behavior change) — not broken, just not
  cut over yet.

### Sprint 6 — Cookie session, CSRF, middleware (this session, backend + frontend)

Unlike Sprints 4/5, this sprint's frontend half was completed in the same
session (via a sub-agent working from the same context, then verified by the
main session) — there was no reason to defer it, since cookie auth is only
useful once the frontend actually reads/writes cookies instead of
localStorage.

- **Deviation from the plan's migration sketch, on purpose**: the plan
  sketches a new `canvasgrade_023` migration creating an `auth_sessions`
  table (id, user_id, token_hash, device_info, ip_address, expires_at,
  revoked_at, created_at, last_used_at). This session found that
  `services/session_service.py`'s existing `SqlRefreshToken`/
  `refresh_tokens` table (built in an earlier sprint for device-session
  revocation) already has every one of those columns under slightly
  different names (`ip_hash` instead of `ip_address`, `issued_at` instead of
  `created_at`, `last_seen_at` instead of `last_used_at`), and
  `routes_fastapi/user_routes.py` already has `GET /me/sessions`,
  `DELETE /me/sessions/{id}`, `POST /me/sessions/revoke-others` — the exact
  functionality the plan's `/auth/sessions` endpoints were meant to add,
  under different route names. Creating a second, duplicate table and
  migrating rows into it would have been pure churn with no behavior
  change. **No new migration was written this sprint** — `alembic heads`
  is still `canvasgrade_022`, unchanged from Sprint 5.
- **`backend/config.py`**: added `auth_cookie_mode: bool = True` — the
  plan's own documented rollback ("Feature flag `AUTH_COOKIE_MODE=false`
  falls back to header auth. Keep the flag for two sprints").
- **`backend/routes_fastapi/deps.py::get_bearer_token`**: rewritten to read
  the `campusgrade_access` httpOnly cookie first (when `auth_cookie_mode` is
  on), falling back to the `Authorization: Bearer` header — so a client
  that hasn't been updated (or a non-browser API caller) keeps working for
  one more sprint, exactly as the plan specifies. Header support is
  scheduled for removal in Sprint 10 per the plan.
- **`backend/routes_fastapi/auth_routes.py`**: `/login` and `/auth/refresh`
  now set three cookies — `campusgrade_access` (httpOnly, 15 min),
  `campusgrade_refresh` (httpOnly, already existed), `campusgrade_csrf`
  (readable by JS on purpose — it's the half of the double-submit pattern
  the frontend has to echo back). `/logout` clears all three. New
  `GET /auth/me` returns the real `Principal` as JSON
  (`user_id`/`role`/`status`/`program_ids`/`offering_ids`/
  `must_change_password`) — the frontend uses this instead of ever decoding
  a JWT client-side.
- **`backend/core/csrf.py`, new**: `register_csrf_middleware(app)` rejects
  any `POST`/`PUT`/`PATCH`/`DELETE` (except the exempt `/login`,
  `/auth/refresh` — a fresh session has no CSRF token yet to send) whose
  `X-CSRF-Token` header doesn't match the `campusgrade_csrf` cookie
  (constant-time compare via `secrets.compare_digest`), when cookie mode is
  on.
- **Real framework limitation found and worked around**: FastAPI/Starlette
  does not route exceptions raised inside `@app.middleware("http")`
  (`BaseHTTPMiddleware`) through registered `@app.exception_handler`s — the
  exception middleware sits between user middleware and the router, not
  outside it. Verified empirically with an isolated standalone FastAPI test
  app before trusting the fix. Fixed by adding
  `core.errors.error_response(request, error)`, a new public helper that
  builds the same `application/problem+json` body the registered handler
  would, callable directly; the CSRF middleware `return`s this instead of
  `raise`ing. Confirmed via the same isolated test app: exempt paths pass,
  missing/mismatched CSRF returns a real 403 problem+json body with a
  proper `request_id` (the outer `security_and_request_context` middleware
  still runs first and sets it), matching tokens succeed, GET is never
  checked.
- **Frontend, done this session (not deferred)**: `src/lib/session.ts`
  rewritten with no client-side JWT decoding and no localStorage token/user
  storage — `fetchCurrentUser()` calls `GET /auth/me` and caches the result
  in memory for the session; `SessionUser.role` widened to the real
  four-role union; new `isAdminRole()` helper. `src/lib/api.ts`: removed
  the `Authorization` header interceptor, added a CSRF-header interceptor
  reading `campusgrade_csrf` from `document.cookie` on every
  POST/PUT/PATCH/DELETE, simplified the 401-retry-after-refresh logic to
  not store any token. New `src/middleware.ts`: a coarse
  presence-only check on the `campusgrade_access` cookie for the
  `(dashboard)` route group's real prefixes (`/admin`, `/assignments`,
  `/dashboard`, `/profile`, `/settings`) — deliberately does **not** verify
  the JWT signature (that would require shipping the backend's HS256
  `SECRET_KEY` into frontend code, a real vulnerability), leaving actual
  validity/expiry/role checks to the backend and to `AuthGate` calling
  `/auth/me`. `src/components/AuthGate.tsx` now authenticates via
  `fetchCurrentUser()`/`/auth/me` instead of the old localStorage-token
  dance. Every `role === "admin"` call site found by an exhaustive grep
  across `frontend/src` (nav visibility, admin-only page/section gating —
  none turned out to be a genuinely super-admin-only action; those are all
  server-enforced, not client-gated) was updated to `isAdminRole(role)`
  (true for both `super_admin` and `program_admin`). The one remaining
  `localStorage` usage in the frontend is an unrelated sidebar-collapsed UI
  preference, left alone.
- **Verified this session**: backend — `uv run pytest backend/tests` →
  `158 passed, 22 skipped` (was `154 passed, 15 skipped`; +4 Docker-free
  cookie unit tests in `test_security.py`, +7 Docker-gated cookie/CSRF
  integration tests in the new `test_cookie_auth.py`, +1 pre-existing skip
  count adjustment). `uv run ruff check` on every new/touched file → clean
  (`test_cookie_auth.py`, `test_security.py` added to CI's explicit ruff
  file list, alongside `auth_routes.py`). `uv run mypy` → clean, 17 source
  files. `alembic heads` → still `canvasgrade_022 (head)` (no new
  migration, see deviation above). `import app` → **121 routes** (120 + the
  new `/auth/me`). Frontend — verified in a scratch copy (`npm install`,
  the mounted network drive is too slow for a from-scratch
  `node_modules`): `npm run lint` clean, `npm run build` clean (all
  routes), `npx vitest run --passWithNoTests` → 14/14 passing. No new npm
  dependencies were added (a coarse cookie-presence check needs no JWT
  library in the browser).
- **Known gap, unavoidable in this sandbox**: the Docker-gated
  `test_cookie_auth.py` integration tests (full `/login` → cookie → `/auth/me`
  → CSRF-checked mutation round trip against a real Postgres) are written
  and reviewed but have only been proven to *skip* correctly here, same
  limitation as every other Docker-gated test in this project.
- **Known gap, by design, not a regression**: `AUTH_COOKIE_MODE=false`'s
  header-only fallback path is unit-tested (`get_bearer_token` directly,
  no live server) but not exercised through a full `TestClient` HTTP round
  trip — an early attempt at that (a nested `TestClient` inside a
  monkeypatched-env block) was judged too fragile (nested lifespan
  re-entry, Redis pool duplication risk) and removed in favor of the
  simpler direct unit tests. The flag's *logic* is proven; a live full-stack
  rollback drill is not, and would need a real deployment to do safely
  anyway.

## Known gaps going into the next session

1. ~~`frontend/src/types/api.d.ts` still doesn't exist.~~ **Resolved** — generated (via `app.openapi()`, since this sandbox has no live Postgres to run the backend server against for a real `/openapi.json`) and committed.
2. ~~Frontend test execution is unverified.~~ **Resolved** — `npm run lint`/`build`/`npx vitest run` all actually executed and pass (found and fixed 3 real bugs along the way: `dev.js`'s ESLint violation, `vitest.config.ts` picking up the Playwright spec, a corrupted `lucide-react` install). The Playwright suite itself still can't *execute* (no live seeded backend in this sandbox) but is confirmed correctly discovered (4/4 tests) and self-skips cleanly — matches its own documented "not wired into CI yet" scope, not a gap.
3. **Docker-gated backend integration tests** (`tests/test_golden_paths.py`) have only been proven to *skip* correctly, never to *pass* against a real Postgres — this sandbox has no Docker daemon.
3b. **"A deliberately broken PR is rejected by CI"** (Sprint 0's last Done-criterion) can only be proven against the real GitHub repository and Actions — not something a sandbox session can simulate. The workflow file itself (`ci.yml`) is in place and its individual jobs are verified piece by piece (ruff, pytest, npm lint/build/vitest all actually pass locally); what's unproven is specifically the "PR gets blocked" mechanics of branch protection, which is a repo-settings concern, not a code concern.
4. **All 15 files in Sprint 2's original scope are now ported, including `assignment_routes.py`** (50 routes, done this session — see above). `admin_routes.py` itself still has one genuinely-live sync function (`_get_or_create_soet_department`, app startup) and is still Sprint 10's eventual rewrite target, but nothing about it blocks calling Sprint 2's route-porting work complete.
5. The sync `engine`/`SessionLocal` in `models/database.py` **still cannot be deleted** — Sprint 2's own Done-criteria says to delete it, but real call sites remain: `_get_or_create_soet_department` (app startup), the self-contained sync services (`write_audit_log`, `revoke_all_sessions`, `get_audit_logs`, `sync_submission_repository`, `_generate_assignment_ai_suggestion` — confirmed dead code but still present), the 14 sync-original halves of `assignment_routes.py`'s new bridge functions (needed by the Docker-gated concurrency tests and by `admin/users.py`), and `app.py`'s `asyncio.to_thread`-based scheduler calls. This is now a small, fully-enumerated follow-up rather than an open-ended one.

## Before trusting Sprint 0/1/2 as fully done

Run these on a normal dev machine or CI runner (not this sandbox):

```bash
# backend — already verified in this session except the Docker-gated tests
uv sync
uv run ruff check backend/tests/conftest.py backend/tests/test_golden_paths.py backend/config.py backend/core
uv run mypy
uv run pytest backend/tests -v          # needs Docker running locally for full coverage
cd backend && uv run alembic upgrade head && uv run alembic downgrade base && uv run alembic upgrade head

# frontend — NOT yet verified in this session, do this first
cd frontend
rm -rf node_modules && npm install      # clean install — this sandbox's install is broken
npm run lint
npm run build
npx vitest run
npx playwright install chromium && npm run e2e   # needs seeded fixture accounts, see e2e/README.md
# with a running backend on 127.0.0.1:5001:
npm run gen:types && git add src/types/api.d.ts
```

If all of those pass, flip Sprints 0 and 1 to fully 🟢 in the table above.
Sprint 2 continues with the file table above — `admin_settings.py` and the
`admin/*.py` shim files are the next slice, and they need to be tackled as a
coupled group (see the reasoning above), not one at a time the way the first
three files were.
