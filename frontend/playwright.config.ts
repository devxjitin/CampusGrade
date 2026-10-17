import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a real stack: either `docker compose` in dev
// mode (E2E_BASE_URL=http://localhost:3000) or the production stack that CI
// starts (E2E_BASE_URL=https://campusgrade.localhost, Caddy's local CA, hence
// ignoreHTTPSErrors). See e2e/README.md for seeding the fixture accounts.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
