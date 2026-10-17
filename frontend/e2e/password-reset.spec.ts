import { expect, test } from "@playwright/test";

// Sprint 4 (S4-09): forgot password -> read the email through Mailpit's API -> reset -> sign in,
// and a session opened before the reset is rejected. Needs the Mailpit overlay (compose.ci.yaml
// or compose.dev.yaml) and a dedicated account so the other specs' logins are not disturbed.
const email = process.env.E2E_RESET_EMAIL;
const password = process.env.E2E_RESET_PASSWORD;
const mailpit = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
const newPassword = "Reset-E2e-9!x";

// The password changes during the test, so a retry could never log in with the original one.
test.describe.configure({ retries: 0 });

test("forgot password sends an email, the link resets the password and signs out other sessions", async ({ page, playwright, baseURL }) => {
  test.skip(!email || !password, "E2E_RESET_EMAIL/E2E_RESET_PASSWORD not set");

  // A session that exists before the reset (the API is reachable at /api on the web origin).
  const oldSession = await playwright.request.newContext({ baseURL: baseURL!, ignoreHTTPSErrors: true });
  const login = await oldSession.post("/api/login", { data: { email, password } });
  expect(login.ok()).toBeTruthy();
  expect((await oldSession.get("/api/auth/me")).ok()).toBeTruthy();

  await page.goto("/login");
  await page.getByRole("link", { name: /forgot password/i }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await page.getByLabel(/university email/i).fill(email!);
  await page.getByRole("button", { name: /send reset link/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();

  // The worker sends the mail asynchronously.
  const mail = mailpit.replace(/\/$/, "");
  let link = "";
  await expect
    .poll(
      async () => {
        const search = await (await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
        const id = search.messages?.[0]?.ID;
        if (!id) return "";
        const message = await (await fetch(`${mail}/api/v1/message/${id}`)).json();
        link = (message.Text as string).match(/https?:\/\/\S+\/reset-password\?token=\S+/)?.[0] ?? "";
        return link;
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .not.toBe("");

  const token = new URL(link).searchParams.get("token")!;
  await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
  await page.getByLabel(/^new password/i).fill(newPassword);
  await page.getByLabel(/confirm new password/i).fill(newPassword);
  await page.getByRole("button", { name: /update password/i }).click();
  await expect(page.getByText(/password updated/i).first()).toBeVisible();

  // The session from before the reset is rejected, and the link cannot be used twice.
  expect((await oldSession.get("/api/auth/me")).status()).toBe(401);
  await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
  await page.getByLabel(/^new password/i).fill(newPassword);
  await page.getByLabel(/confirm new password/i).fill(newPassword);
  await page.getByRole("button", { name: /update password/i }).click();
  await expect(page.getByRole("alert")).toContainText(/invalid or has expired/i);

  // The new password signs in.
  await page.goto("/login");
  await page.getByLabel(/university email/i).fill(email!);
  await page.getByPlaceholder("Enter your password").fill(newPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/assignments|\/dashboard/);
  await oldSession.dispose();
});
