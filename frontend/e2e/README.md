# E2E smoke tests

One test per role: log in, land on the dashboard, see the nav items that
role should see. This is the safety net for Sprint 5 (four roles go live)
and Sprint 6 (cookie auth + middleware) — both sprints must keep these
green.

## Running locally

1. Start Postgres and the backend (`cd backend && python app.py`).
2. Seed four fixture accounts — one per role. Until Sprint 4/5 land, `admin`
   use the live `super_admin` and `program_admin` roles.
3. Start the frontend (`npm run dev`).
4. `npm run e2e`

## Fixture accounts

Set these via env vars so credentials are never hardcoded in the repo:

```
E2E_SUPER_ADMIN_EMAIL / E2E_SUPER_ADMIN_PASSWORD
E2E_PROGRAM_ADMIN_EMAIL / E2E_PROGRAM_ADMIN_PASSWORD
E2E_TEACHER_EMAIL / E2E_TEACHER_PASSWORD
E2E_STUDENT_EMAIL / E2E_STUDENT_PASSWORD
```

## CI

Not wired into `.github/workflows/ci.yml` yet — that requires a seeded
staging database reachable from the CI runner, which is a Sprint 19
(hardening) task. Run these locally before merging any Sprint 5/6/7 PR.
