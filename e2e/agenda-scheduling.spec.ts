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

test("Agenda refuses unchanged and past custom session times", async ({ page }) => {
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
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.locator(".agenda-week-selector button").nth(1).click();
  const session = page.locator(".agenda-period article").filter({ hasText: "Move this bounded session" });
  await session.getByRole("button", { name: "Move", exact: true }).click();

  const panel = page.locator(".agenda-move-panel").filter({ hasText: "Move this bounded session" });
  const customTime = panel.getByLabel("Custom date and time");
  const save = panel.getByRole("button", { name: "Save new time" });
  await expect(panel.getByText("Choose a different date or time before saving.")).toBeVisible();
  await expect(save).toBeDisabled();

  const pastInput = localDateTimeInput(new Date(Date.now() - 24 * 60 * 60 * 1_000));
  await customTime.fill(pastInput);
  await expect(panel.getByText("Choose a future date and time.")).toBeVisible();
  await expect(save).toBeDisabled();

  const futureInput = localDateTimeInput(new Date(Date.now() + 48 * 60 * 60 * 1_000));
  await customTime.fill(futureInput);
  await expect(panel.getByText("Choose a future date and time.")).toHaveCount(0);
  await expect(save).toBeEnabled();
  await save.click();
  await expect(panel).toHaveCount(0);
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
