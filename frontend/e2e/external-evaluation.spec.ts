import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Sprint 5 demo script, end to end: the teacher prepares a batch, the prompt contains only
// pseudonyms, one wrong mark gives a clear error, the fixed JSON is reviewed as a diff and saved.
// Needs the fixtures from backend/seed_e2e.py (E2E_SEEDED=1).
const seeded = process.env.E2E_SEEDED === "1";
const teacherEmail = process.env.E2E_TEACHER_EMAIL ?? "e2e-teacher@campusgrade.dev";
const realIdentifiers = ["Asha Verma", "Rohan Mehta", "E2E-001", "E2E-002", "asha-v-e2e", "rohan-m-e2e", "e2e-student1", "e2e-student2"];

const signIn = async (page: Page, email: string) => {
  await page.goto("/login");
  await page.getByLabel(/university email/i).fill(email);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/assignments|\/dashboard/);
};

const noSeriousViolations = async (page: Page, selector: string, label: string) => {
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 2000))]));
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking.map((violation) => ({ id: violation.id, help: violation.help, targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")) })), `${label} has serious accessibility violations`).toEqual([]);
};

test("teacher evaluates a batch with pseudonymized prompts", async ({ page, context }) => {
  test.skip(!seeded, "E2E_SEEDED not set — see backend/seed_e2e.py");
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, teacherEmail);

  await page.goto("/assignments");
  const card = page.locator("article, li, div").filter({ hasText: "E2E ready to evaluate" }).filter({ has: page.getByRole("button", { name: /review submissions/i }) }).last();
  await card.getByRole("button", { name: /review submissions/i }).click();
  await page.getByRole("button", { name: /external ai evaluator/i }).click();
  const dialog = page.getByRole("dialog", { name: /external ai batch evaluation/i });
  await expect(dialog).toBeVisible();

  // Step 1: prepare and copy the prompt.
  await dialog.getByRole("button", { name: /prepare batches/i }).click();
  const copyButton = dialog.getByRole("button", { name: "Copy prompt", exact: true });
  const alreadyDone = page.getByText(/no analyzed, unpublished submissions/i);
  await expect(copyButton.or(alreadyDone).first()).toBeVisible();
  // Saving evaluations is permanent for the fixture: a second run on the same database has nothing left to prepare.
  test.skip(await alreadyDone.isVisible(), "Fixture students were already evaluated by an earlier run; recreate the stack or reseed");
  await expect(copyButton).toBeVisible();
  await noSeriousViolations(page, '[role="dialog"]', "stepper step 1");
  await dialog.getByRole("button", { name: "Copy prompt", exact: true }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  for (const secret of realIdentifiers) expect(prompt.toLowerCase(), `${secret} must not be in the prompt`).not.toContain(secret.toLowerCase());
  const pseudonyms = [...new Set(prompt.match(/Student: (Student-\d+)/g)?.map((line) => line.slice(9)))];
  expect(pseudonyms).toHaveLength(2);

  // Build the AI's answer from the prompt, with one mark above the criterion maximum.
  const assignmentId = prompt.match(/ID: ([0-9a-f-]{36})/)![1];
  const batchRef = prompt.match(/Batch ID \(copy exactly into JSON\): (\w+)/)![1];
  const rubric = JSON.parse(prompt.match(/Rubric: (\[.*\])/)![1]) as Array<{ criterion_id: string; max_marks: number }>;
  const answer = (firstMark: number) =>
    JSON.stringify({
      schema_version: 1,
      assignment_id: assignmentId,
      batch_id: batchRef,
      batch_number: 1,
      students: pseudonyms.map((pseudonym, index) => {
        const marks = rubric.map((criterion, position) => (index === 0 && position === 0 ? firstMark : Math.min(criterion.max_marks, 3)));
        return {
          student_id: pseudonym,
          duplicate_review: { status: "none", matched_students: [], recommend_zero: false, explanation: "" },
          rubric_scores: rubric.map((criterion, position) => ({
            criterion_id: criterion.criterion_id,
            awarded: marks[position],
            max_marks: criterion.max_marks,
            what_was_done_well: "The repository runs and prints the expected output.",
            what_is_missing: "Edge cases are not covered by the code.",
          })),
          total_awarded: marks.reduce((sum, value) => sum + value, 0),
          confidence: 0.8,
          requires_teacher_review: [],
        };
      }),
    });

  // Step 2: a wrong mark is reported clearly, field by field.
  await dialog.getByRole("button", { name: /i have the ai response/i }).click();
  await dialog.getByLabel(/json response for batch 1/i).fill(answer(99));
  await dialog.getByRole("button", { name: /validate batch/i }).click();
  const problems = dialog.getByRole("alert").filter({ hasText: /problem/i });
  await expect(problems).toContainText(/between 0 and/i);
  await expect(problems).toContainText(/Correctness/);
  await noSeriousViolations(page, '[role="dialog"]', "stepper step 2 with errors");

  // The fixed JSON validates and moves to the review step with a diff table.
  await dialog.getByLabel(/json response for batch 1/i).fill(answer(5));
  await dialog.getByRole("button", { name: /validate batch/i }).click();
  await expect(dialog.getByRole("heading", { name: /review the changes/i })).toBeVisible();
  await expect(dialog.getByRole("table").first()).toContainText("Correctness");
  await expect(dialog.getByText("Asha Verma").first()).toBeVisible(); // real names are restored locally
  await noSeriousViolations(page, '[role="dialog"]', "stepper review step");

  // Step 4: save as private drafts.
  await dialog.getByRole("button", { name: /continue to save/i }).click();
  await dialog.getByRole("button", { name: /^save 2 evaluations/i }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
});
