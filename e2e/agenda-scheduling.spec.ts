import { expect, test, type Page } from "@playwright/test";

const onboardingAnswers = [
  "Show a short recommendation and alternatives",
  "I delay a little, then get going",
  "20 to 30 minutes",
  "A concrete example before the rule",
  "Recalling it without notes, then checking",
  "I recognize it but cannot recall it",
  "Give me a small hint",
  "Show one step at a time",
  "Clear checkpoints inside the block",
  "No extra support right now",
  "Afternoon",
] as const;

test("Calendar refuses unchanged and past custom session times", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-02T10:00:00.000Z"));
  await createPreviewAccount(page);
  await completeOnboarding(page);
  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as { plans: unknown[]; updatedAt?: string };
    const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    snapshot.plans.push({
      id: "71000000-0000-4000-8000-000000000001",
      learningItemId: "71000000-0000-4000-8000-000000000002",
      title: "Transactional agenda fixture",
      topic: "Ordered study sessions",
      kind: "topic",
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
      creationIntent: "plan",
      sessionArchitectureVersion: "streamed_teaching_v1",
      rationale: "Keep the learner's agenda ordered and inside the deadline.",
      createdAt: new Date().toISOString(),
      materials: [],
      sessions: [{
        id: "71000000-0000-4000-8000-000000000003",
        sequence: 1,
        title: "Move this bounded session",
        objective: "Verify that a custom schedule change is intentional and future-facing.",
        method: "Retrieval practice",
        methodReason: "An explicit future time keeps the plan actionable.",
        scheduledFor,
        estimatedMinutes: 25,
        amountLabel: "One focused target + evidence check · about 25 min",
        learningMode: "study",
        topicIds: ["71000000-0000-4000-8000-000000000004"],
        contentTargets: ["Intentional session scheduling"],
        completionEvidence: ["Explain why the selected time keeps the plan actionable"],
        status: "ready",
      }],
    });
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });

  await page.reload();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.getByRole("button", { name: /^Move this bounded session, / }).click();
  const detail = page.locator(".calendar-block-detail").filter({ hasText: "Move this bounded session" });
  await detail.getByRole("button", { name: "Move", exact: true }).click();

  const panel = detail.locator(".calendar-move-panel");
  const customTime = panel.getByLabel("New time");
  const save = panel.getByRole("button", { name: "Save new time" });
  await save.click();
  await expect(page.locator(".calendar-action-error")).toContainText("Choose a different date or time before saving.");

  const pastInput = localDateTimeInput(new Date(Date.now() - 24 * 60 * 60 * 1_000));
  await customTime.fill(pastInput);
  await save.click();
  await expect(page.locator(".calendar-action-error")).toContainText("Choose a future date and time.");

  const futureInput = localDateTimeInput(new Date(Date.now() + 48 * 60 * 60 * 1_000));
  await customTime.fill(futureInput);
  await save.click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".calendar-action-error")).toHaveCount(0);
});

async function createPreviewAccount(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill(`agenda-${crypto.randomUUID()}@example.com`);
  await page.getByRole("button", { name: "Continue" }).click();
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

function localDateTimeInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
