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

test("the canonical profile is visible, correctable, persistent, and experiment-free", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How YOVA will work with you" })).toBeVisible();
  await expect(page.getByText("11/11 answered", { exact: true })).toBeVisible();
  await expect(page.getByText(/recommend one valid route/i)).toBeVisible();
  await expect(page.getByText(/experiment|personal test/i)).toHaveCount(0);

  await page.getByText("Review or change the 11 optional questions", { exact: true }).click();
  await expect(page.getByText("Answered by you", { exact: true }).first()).toBeVisible();
  const agency = page.getByLabel(
    "How should YOVA involve you when more than one study route would work?",
  );
  await agency.selectOption({ label: "Let me customize from valid options" });
  await expect(page.getByText(/let you customize from routes/i)).toBeVisible();
  await expect(page.getByText("Updated by you", { exact: true }).first()).toBeVisible();

  const workspace = page.getByLabel(
    "During a session, how should the work be organized on screen?",
  );
  await workspace.selectOption({ label: "Keep the full path visible" });
  await expect(page.locator(".app-shell")).not.toHaveClass(/workspace-one-step/);

  await page.reload();
  await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How YOVA will work with you" })).toBeVisible();
  await expect(page.getByText(/let you customize from routes/i)).toBeVisible();
  await expect(page.getByLabel(
    "During a session, how should the work be organized on screen?",
  )).toHaveValue("full_path");

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
