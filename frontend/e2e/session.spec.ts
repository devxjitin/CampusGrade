import { expect, test } from "@playwright/test";

// Regression for the "logged out after 15 minutes idle" bug: the access cookie
// lives 15 minutes, the refresh cookie several days. When only the access
// cookie is gone, a full page navigation must silently restore the session
// instead of bouncing to /login.

test("an expired access cookie is refreshed instead of logging the user out", async ({ page, context }) => {
  const email = process.env.E2E_SUPER_ADMIN_EMAIL;
  test.skip(!email, "E2E_SUPER_ADMIN_EMAIL not set — see e2e/README.md");

  await page.goto("/login");
  await page.getByLabel(/university email/i).fill(email!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/assignments/);

  const before = await context.cookies();
  expect(before.some((cookie) => cookie.name === "campusgrade_access")).toBe(true);
  expect(before.some((cookie) => cookie.name === "campusgrade_refresh")).toBe(true);

  // What the browser does after 15 idle minutes: drops the expired access cookie.
  await context.clearCookies({ name: "campusgrade_access" });

  // A full navigation goes through the proxy, which must route via /session/refresh.
  await page.goto("/assignments");
  await expect(page).toHaveURL(/\/assignments/);
  await expect(page).not.toHaveURL(/\/login/);

  const after = await context.cookies();
  expect(after.some((cookie) => cookie.name === "campusgrade_access")).toBe(true);
});

test("a refresh cookie that is no longer valid ends at the login page", async ({ page, context, baseURL }) => {
  await context.addCookies([
    { name: "campusgrade_refresh", value: "not-a-real-token", url: baseURL ?? "http://localhost:3000" },
  ]);
  await page.goto("/assignments");
  await expect(page).toHaveURL(/\/login/);
});
