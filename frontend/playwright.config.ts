import { defineConfig, devices } from "@playwright/test";

// Sprint 0 (IMPLEMENTATION_PLAN.md): one smoke E2E per role. Requires the
// backend and frontend dev servers running against a seeded database — see
// e2e/README.md for how to seed the four fixture accounts these tests log
// in as. Not run by CI yet (no seeded staging DB is wired into the backend
// job); run locally with `npm run e2e` once the app is up.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
