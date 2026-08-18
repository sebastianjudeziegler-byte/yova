import { expect, test, type Page } from "@playwright/test";

const onboardingAnswers = [
  "I struggle to start",
  "Give me clear structure with flexibility",
  "20 to 30 minutes",
  "A concrete example first",
  "Sometimes",
  "I intend to begin but often delay",
  "Afternoon",
  "A combination",
  "No extra support right now",
  "Nothing else for now",
] as const;

test("personalization questions create visible, reversible workspace changes", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How YOVA is adapting to you" })).toBeVisible();
  await expect(page.getByText(/Starting Friction: Higher starting friction/i)).toBeVisible();
  await expect(page.getByText("You told YOVA", { exact: true }).first()).toBeVisible();

  await page.getByText("Your study tendencies", { exact: true }).click();
  await page.getByRole("button", { name: "Answer one question" }).click();
  await expect(page.getByRole("radiogroup", { name: "Answers for question 1" })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Answers for question 1" }).getByRole("radio").last().click();
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByRole("radiogroup", { name: "Answers for question 2" }).getByRole("radio").last().click();
  await page.getByRole("button", { name: "Done for now" }).click();
  await expect(page.getByText("2 of 12 optional questions answered", { exact: true })).toBeVisible();

  await page.getByText("Study workspace", { exact: true }).click();
  const sessionPath = page.getByRole("group", { name: "Session path" });
  await sessionPath.getByRole("button", { name: "One step" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/workspace-one-step/);

  await page.reload();
  await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How YOVA is adapting to you" })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveClass(/workspace-one-step/);

  await page.getByText("Study workspace", { exact: true }).click();
  await page.getByRole("group", { name: "Session path" }).getByRole("button", { name: "Let YOVA decide" }).click();
  await expect(page.locator(".app-shell")).not.toHaveClass(/workspace-one-step/);

  await seedComparablePlan(page);
  await page.reload();
  await page.getByRole("button", { name: "You", exact: true }).click();
  await page.getByText("Personalization controls", { exact: true }).click();
  await page.getByRole("switch", { name: /Suggest personal tests: off/ }).click();
  await page.getByRole("button", { name: "Start personal test" }).click();
  await expect(page.getByText("YOVA is testing", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "one_step or full_path" })).toBeVisible();
  // The test variant is reserved for the matching guided session. It must not
  // leak onto the You screen or unrelated work.
  await expect(page.locator(".app-shell")).not.toHaveClass(/workspace-one-step/);

  const viewport = page.viewportSize();
  if (viewport && viewport.width <= 500) {
    const overflow = await page.locator(".page").evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  }
});

async function createPreviewAccount(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill("personalization@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Make YOVA fit how you actually study." })).toBeVisible();
}

async function seedComparablePlan(page: Page) {
  await page.evaluate(() => {
    const key = "yova.preview.v1";
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error("Preview snapshot was not created.");
    const snapshot = JSON.parse(raw) as { plans: unknown[] };
    snapshot.plans = [{
      id: "11111111-1111-4111-8111-111111111111",
      learningItemId: "22222222-2222-4222-8222-222222222222",
      title: "Cell division",
      topic: "Cell division",
      kind: "topic",
      deadline: null,
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "learn",
      sessionArchitectureVersion: "streamed_teaching_v1",
      rationale: "Build an accurate model, then check it independently.",
      createdAt: "2026-08-14T18:00:00.000Z",
      sessions: [{
        id: "33333333-3333-4333-8333-333333333333",
        sequence: 1,
        title: "Build a model of cell division",
        objective: "Explain the purpose and sequence of mitosis before applying it.",
        method: "Self-explanation",
        methodReason: "An explanation makes the learner connect each stage to its purpose.",
        scheduledFor: "2026-08-14T20:00:00.000Z",
        estimatedMinutes: 25,
        amountLabel: "25 minutes",
        learningMode: "learn",
        contentTargets: ["Purpose and sequence of mitosis"],
        completionEvidence: ["Explain the sequence without the lesson visible"],
        status: "ready",
      }],
    }];
    window.localStorage.setItem(key, JSON.stringify(snapshot));
  });
}

async function completeOnboarding(page: Page) {
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();
  for (const [index, answer] of onboardingAnswers.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", {
      name: index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue",
    }).click();
  }
  await page.getByRole("button", { name: "Open YOVA" }).click();
}
