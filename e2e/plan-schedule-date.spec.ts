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

const TEST_TIME_ZONE = "Europe/London";

test.use({ timezoneId: TEST_TIME_ZONE });

test("a natural deadline and an edited date survive every schedule control", async ({ page }) => {
  await openPreviewApp(page);

  const inferred = futureDate(40);
  const manual = futureDate(47);
  const writtenDeadline = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: TEST_TIME_ZONE,
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

test("an overfull plan returns to its schedule and recovers without a client crash", async ({ page }) => {
  const pageErrors: string[] = [];
  let planAttempts = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/plans/generate**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("mode") === "diagnostic") {
      await route.continue();
      return;
    }
    planAttempts += 1;
    if (planAttempts === 1) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          code: "schedule_capacity",
          error: "The plan does not fit before the deadline.",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary planning service failure." }),
    });
  });
  await openPreviewApp(page);

  await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  await page.getByPlaceholder(/I have a biology test/).fill(
    "I have a biology test tomorrow on cellular respiration.",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "1–2 days", exact: true }).click();
  await page.getByRole("button", { name: "15 minutes", exact: true }).click();

  await finishPlanSetup(page);
  await page.getByRole("button", { name: "Generate my plan" }).click();

  const capacityGuidance = page.getByRole("alert").filter({
    hasText: "This plan needs more room before your target date.",
  });
  await expect(capacityGuidance).toContainText("Add another study day");
  await expect(capacityGuidance).toContainText("choose longer sessions");
  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();

  // The second attempt exercises the deterministic browser fallback. It must
  // produce the same expected recovery instead of throwing outside the API
  // error handler and stranding the loading screen.
  await finishPlanSetup(page);
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(capacityGuidance).toBeVisible();
  expect(pageErrors).toEqual([]);

  const feasible = futureDate(14);
  await page.getByRole("textbox", { name: "Target date" }).fill(feasible.input);
  await page.getByRole("button", { name: "Every day", exact: true }).click();
  await page.getByRole("button", { name: "60 minutes", exact: true }).click();
  await finishPlanSetup(page);
  await page.getByRole("button", { name: "Generate my plan" }).click();

  await expect(page.getByText("Plan ready")).toBeVisible();
  expect(planAttempts).toBe(3);
  expect(pageErrors).toEqual([]);
});

function futureDate(days: number) {
  const now = new Date();
  const currentCalendarParts = new Intl.DateTimeFormat("en-US", {
    timeZone: TEST_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(
    currentCalendarParts.find((candidate) => candidate.type === type)?.value,
  );
  const local = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + days, 12));
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return {
    date: local,
    input: `${year}-${month}-${day}`,
    monthShort: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(local),
  };
}

async function finishPlanSetup(page: Page) {
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
}
