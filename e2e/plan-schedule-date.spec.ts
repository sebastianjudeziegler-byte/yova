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

test.use({ timezoneId: "Europe/London" });

test("a natural deadline and an edited date survive every schedule control", async ({ page }) => {
  await openPreviewApp(page);

  const inferred = futureDate(40);
  const manual = futureDate(47);
  const writtenDeadline = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "Europe/London",
  }).format(inferred.date);

  await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  await page.getByPlaceholder(/I have a biology test/).fill(
    `Prepare for a chemistry quiz on chemical equilibrium on ${writtenDeadline}`,
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  const targetDate = page.getByRole("textbox", { name: "Target date" });
  await expect(targetDate).toHaveValue(inferred.input);
  await expect(page.locator(".schedule-deadline strong")).not.toHaveText("No fixed deadline");

  // Do not treat the date input's DOM value as proof. The summary is rendered
  // from React state, so this assertion verifies that a real input event reached
  // the application before any rhythm change causes another render.
  await targetDate.fill(manual.input);
  await expect(page.locator(".schedule-deadline strong")).not.toHaveText("No fixed deadline");
  await expect(page.locator(".schedule-deadline strong")).toContainText(manual.monthShort);

  await page.getByRole("button", { name: "Every day", exact: true }).click();
  await page.getByRole("button", { name: "Morning", exact: true }).click();
  await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  await expect(targetDate).toHaveValue(manual.input);
  await expect(page.getByText("7 study windows available")).toBeVisible();
  await expect(page.locator(".schedule-preview-windows")).toContainText("Morning");
  await expect(page.locator(".schedule-preview-windows")).toContainText("45 min");

  await page.getByRole("button", { name: /Custom Choose each day/ }).click();
  const customTargetDate = page.getByRole("textbox", { name: "Custom target date" });
  await expect(customTargetDate).toHaveValue(manual.input);
  await page.getByLabel(/Monday time window/).selectOption("Evening");
  await page.getByRole("button", { name: /Remove Monday|Add Monday/ }).click();
  await expect(customTargetDate).toHaveValue(manual.input);

  await page.getByRole("button", { name: "Quick choices", exact: true }).click();
  await expect(targetDate).toHaveValue(manual.input);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(targetDate).toHaveValue(manual.input);
});

test("a historical topic date cannot override the learner's real deadline", async ({ page }) => {
  await openPreviewApp(page);

  const expected = futureDate(14);
  await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  await page.getByPlaceholder(/I have a biology test/).fill(
    "Write a paper about September 11, 2001 due in two weeks",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Target date" })).toHaveValue(expected.input);
});

function futureDate(days: number) {
  const now = new Date();
  const local = new Date(now.getTime());
  local.setDate(local.getDate() + days);
  local.setHours(12, 0, 0, 0);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return {
    date: local,
    input: `${year}-${month}-${day}`,
    monthShort: new Intl.DateTimeFormat("en-US", { month: "short" }).format(local),
  };
}

async function openPreviewApp(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill(`schedule-${crypto.randomUUID()}@example.com`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();

  for (const [index, answer] of onboardingAnswers.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", { name: index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue" }).click();
  }

  await page.getByRole("button", { name: "Open YOVA" }).click();
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Learner\./ })).toBeVisible();
}
