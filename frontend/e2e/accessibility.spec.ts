import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Sprint 5 (S5-09): axe checks on the core flows. Serious and critical violations fail the test;
// moderate/minor ones are reported in the log. Also checks that no page scrolls sideways at 360 px (S5-08).
const email = process.env.E2E_SUPER_ADMIN_EMAIL;
const password = process.env.E2E_SUPER_ADMIN_PASSWORD;

const publicPages = ["/login", "/forgot-password", "/reset-password?token=example"];
const signedInPages = ["/dashboard", "/assignments", "/settings", "/profile", "/platform/jobs", "/platform/exports", "/admin/academic-sessions", "/admin/audit-log"];

const scan = async (page: Page, path: string) => {
  await page.goto(path);
  await scanCurrent(page, path);
};

const scanCurrent = async (page: Page, path: string) => {
  await page.waitForLoadState("networkidle");
  // Fade-in animations make text look washed out for a moment; scan the settled page.
  await page.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  const minor = results.violations.filter((violation) => !blocking.includes(violation));
  if (minor.length) console.log(`axe (not blocking) ${path}: ${minor.map((violation) => `${violation.id}(${violation.nodes.length})`).join(", ")}`);
  expect(
    blocking.map((violation) => ({ id: violation.id, impact: violation.impact, help: violation.help, targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")) })),
    `${path} has serious accessibility violations`,
  ).toEqual([]);
};

const noSidewaysScroll = async (page: Page, path: string) => {
  await page.goto(path);
  await checkNoSidewaysScroll(page, path);
};

const checkNoSidewaysScroll = async (page: Page, path: string) => {
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${path} scrolls sideways by ${overflow}px at 360px wide`).toBeLessThanOrEqual(1);
};

test.describe("signed-out pages", () => {
  for (const path of publicPages) {
    test(`axe: ${path}`, async ({ page }) => {
      await scan(page, path);
    });
  }
  test.describe("at 360 px", () => {
    test.use({ viewport: { width: 360, height: 740 } });
    for (const path of publicPages) {
      test(`fits the screen: ${path}`, async ({ page }) => {
        await noSidewaysScroll(page, path);
      });
    }
  });
});

test.describe("signed-in pages", () => {
  // One login (the sign-in endpoint is rate limited), every page scanned, every violation reported.
  test("axe on every core page", async ({ browser, baseURL }) => {
    test.skip(!email || !password, "E2E_SUPER_ADMIN_EMAIL/PASSWORD not set");
    test.setTimeout(180_000);
    const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel(/university email/i).fill(email!);
    await page.getByPlaceholder("Enter your password").fill(password!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/assignments|\/dashboard/);
    for (const path of signedInPages) {
      try {
        await scan(page, path);
      } catch (error) {
        expect.soft(String((error as Error).message), `axe ${path}`).toBe("");
      }
    }
    await page.setViewportSize({ width: 360, height: 740 });
    for (const path of signedInPages) {
      try {
        await noSidewaysScroll(page, path);
      } catch (error) {
        expect.soft(String((error as Error).message), `360px ${path}`).toBe("");
      }
    }
    await context.close();
  });
});

// Student and teacher flows on the fixtures from backend/seed_e2e.py: list, open an assignment, the
// submit page (student) and the review page (teacher), at desktop width and at 360 px.
const seedPassword = process.env.E2E_SEED_PASSWORD;
const people = [
  { role: "student", email: process.env.E2E_STUDENT_EMAIL ?? "e2e-student1@campusgrade.dev", open: /open assignment/i },
  { role: "teacher", email: process.env.E2E_TEACHER_EMAIL ?? "e2e-teacher@campusgrade.dev", open: /review submissions/i },
];

for (const person of people) {
  test(`${person.role} flows: axe and 360 px`, async ({ browser, baseURL }) => {
    test.skip(!seedPassword, "E2E_SEED_PASSWORD not set — see backend/seed_e2e.py");
    test.setTimeout(180_000);
    const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel(/university email/i).fill(person.email);
    await page.getByPlaceholder("Enter your password").fill(seedPassword!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/assignments|\/dashboard/);
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: width === 360 ? 740 : 800 });
      const label = (path: string) => `${person.role} ${path} @${width}`;
      for (const path of ["/assignments", "/dashboard", "/settings"]) {
        await page.goto(path);
        try {
          await scanCurrent(page, label(path));
          if (width === 360) await checkNoSidewaysScroll(page, label(path));
        } catch (error) {
          expect.soft(String((error as Error).message), label(path)).toBe("");
        }
      }
      await page.goto("/assignments");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: person.open }).first().click();
      try {
        await scanCurrent(page, label("assignment detail"));
        if (width === 360) await checkNoSidewaysScroll(page, label("assignment detail"));
      } catch (error) {
        expect.soft(String((error as Error).message), label("assignment detail")).toBe("");
      }
    }
    await context.close();
  });
}
