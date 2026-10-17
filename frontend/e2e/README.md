# E2E tests (Playwright)

Browser tests run against a real, seeded stack, never mocks.

## What is covered

- `login.spec.ts`: one test per role (log in, land on the dashboard, see the nav items that role should see), unauthenticated redirect, role-gated admin pages, persistent shell.
- `session.spec.ts`: the access cookie expires but the refresh cookie is valid, so the user stays signed in (regression for the "logged out after 15 minutes idle" bug).

- `password-reset.spec.ts`: forgot password, read the email through Mailpit's API (`E2E_MAILPIT_URL`, default `http://127.0.0.1:8025`), reset, old session rejected, link single-use, sign in with the new password. Uses its own account (`E2E_RESET_EMAIL` / `E2E_RESET_PASSWORD`) because it changes that account's password; CI creates it and adds Mailpit with `compose.ci.yaml`.

- `external-evaluation.spec.ts`: the Sprint 5 demo script. Prepare a batch, the prompt contains only `Student-NN` names, a wrong mark gives a per-field error, the fixed JSON is reviewed as a diff and saved. Needs the fixtures from `backend/seed_e2e.py` (`E2E_SEED_PASSWORD`). Saving is permanent for the fixture, so on a second run against the same database it skips itself.
- `accessibility.spec.ts`: axe (WCAG 2.1 A/AA) on the core pages and the student/teacher flows, failing on serious or critical violations, plus a check that nothing scrolls sideways at 360 px.

Tests skip themselves when their credentials are not set, so a partial setup still runs what it can.

## Running in CI

`.github/workflows/ci.yml` builds the production images, starts `compose.prod.yaml`, creates a Super Admin with `bootstrap_admin.py`, and runs this suite against `https://campusgrade.localhost`. Only the Super Admin account exists there, so the other role tests are skipped; seed more accounts in the CI job to run them.

## Running everything locally (no GitHub Actions)

`scripts	est-e2e-local.ps1` builds both images, starts a throwaway production-like stack in Docker Desktop (own volumes, Mailpit, test accounts with random passwords), runs every spec, tears it down and restarts your normal stack. See the script header.

## Running locally against a stack you already have

1. Start the stack: `docker compose -f compose.yaml -f compose.dev.yaml up --build` (app on `http://localhost:3000`) or the production stack with `scripts\deploy.ps1`.
2. Create an admin: `scripts\bootstrap-admin.ps1` (production stack), or `docker compose -f compose.yaml -f compose.dev.yaml run --rm -e BOOTSTRAP_ADMIN_EMAIL=... -e BOOTSTRAP_ADMIN_PASSWORD=... api python bootstrap_admin.py`.
3. From `frontend/`: install the browser once with `npx playwright install chromium`, then

```
E2E_BASE_URL=http://localhost:3000 \
E2E_SUPER_ADMIN_EMAIL=... E2E_SUPER_ADMIN_PASSWORD=... \
npm run e2e
```

For the HTTPS stack use `E2E_BASE_URL=https://campusgrade.localhost` (the config ignores Caddy's local certificate).

## Fixture accounts

Set these via env vars so credentials are never hardcoded in the repo:

```
E2E_SUPER_ADMIN_EMAIL / E2E_SUPER_ADMIN_PASSWORD
E2E_PROGRAM_ADMIN_EMAIL / E2E_PROGRAM_ADMIN_PASSWORD
E2E_TEACHER_EMAIL / E2E_TEACHER_PASSWORD
E2E_STUDENT_EMAIL / E2E_STUDENT_PASSWORD
```
