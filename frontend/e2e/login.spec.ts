import { expect, test } from "@playwright/test";

// Sprint 0 smoke suite. See e2e/README.md for how to seed accounts.
// Kept intentionally shallow — this proves login + role-appropriate nav
// renders, not full feature coverage. Deeper per-feature E2E is added
// alongside the sprint that builds the feature (grading in Sprint 13,
// AI proposals in Sprint 16, etc).

const roles = [
  { role: "super_admin", emailEnv: "E2E_SUPER_ADMIN_EMAIL", passwordEnv: "E2E_SUPER_ADMIN_PASSWORD", expectNav: "Programs" },
  { role: "program_admin", emailEnv: "E2E_PROGRAM_ADMIN_EMAIL", passwordEnv: "E2E_PROGRAM_ADMIN_PASSWORD", expectNav: "Batches" },
  { role: "teacher", emailEnv: "E2E_TEACHER_EMAIL", passwordEnv: "E2E_TEACHER_PASSWORD", expectNav: "Assignments" },
  { role: "student", emailEnv: "E2E_STUDENT_EMAIL", passwordEnv: "E2E_STUDENT_PASSWORD", expectNav: "Assignments" },
] as const;

for (const { role, emailEnv, passwordEnv, expectNav } of roles) {
  test(`${role} can log in and see their dashboard`, async ({ page }) => {
    const email = process.env[emailEnv];
    const password = process.env[passwordEnv];
    test.skip(!email || !password, `${emailEnv}/${passwordEnv} not set — see e2e/README.md`);

    await page.goto("/login");
    await page.getByLabel(/university email/i).fill(email!);
    await page.getByPlaceholder("Enter your password").fill(password!);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/assignments/);
    await expect(page.getByRole("link", { name: new RegExp(expectNav, "i") })).toBeVisible();
  });
}

test("an unauthenticated visitor is redirected away from a protected page", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("a student is redirected before an admin page renders", async ({ page }) => {
  const email = process.env.E2E_STUDENT_EMAIL;
  const password = process.env.E2E_STUDENT_PASSWORD;
  test.skip(!email || !password, "Student E2E credentials are not set");

  await page.goto("/login");
  await page.getByLabel(/university email/i).fill(email!);
  await page.getByPlaceholder("Enter your password").fill(password!);
  await page.getByRole("button", { name: /sign in/i }).click();
  const response = await page.goto("/admin/students");
  const redirectRequest = response?.request().redirectedFrom();
  expect((await redirectRequest?.response())?.status()).toBe(307);
  await expect(page).toHaveURL(/\/assignments\?access=denied/);
  await expect(page.getByRole("heading", { name: /^students$/i })).toHaveCount(0);
});

test("the persistent admin shell keeps notification polling mounted once", async ({ page }, testInfo) => {
  const email = process.env.E2E_SUPER_ADMIN_EMAIL;
  const password = process.env.E2E_SUPER_ADMIN_PASSWORD;
  test.skip(!email || !password, "E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD not set — see e2e/README.md");

  let notificationRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/notifications")) notificationRequests += 1;
  });

  await page.goto("/login");
  await page.getByLabel(/university email/i).fill(email!);
  await page.getByPlaceholder("Enter your password").fill(password!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/assignments/);
  await expect.poll(() => notificationRequests).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  const requestsAfterShellMount = notificationRequests;

  const firstContentfulPaint = await page.evaluate(() =>
    performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
  );
  console.info(`Dashboard first contentful paint: ${firstContentfulPaint ?? "unavailable"} ms`);
  await testInfo.attach("dashboard-performance.json", {
    body: JSON.stringify({ firstContentfulPaintMs: firstContentfulPaint }),
    contentType: "application/json",
  });

  await page.getByRole("link", { name: "Programs", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/programs/);
  await page.getByRole("link", { name: "Batches", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/batches/);
  expect(notificationRequests).toBe(requestsAfterShellMount);
});
