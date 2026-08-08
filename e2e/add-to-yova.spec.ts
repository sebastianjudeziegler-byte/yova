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
  "None",
  "Nothing else for now",
] as const;

test("a deadline can live in Agenda, be completed, and stay out of Learning", async ({ page }) => {
  await openPreviewApp(page);
  await openAdd(page, "My lab report is due August 19, 2026");

  await expect(page.getByLabel("Title")).toHaveValue("Lab Report");
  await expect(page.getByLabel("Due date, if there is one")).toHaveValue("2026-08-19");
  await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  await page.getByRole("button", { name: /Track the deadline/ }).click();

  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Learner\./ })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.getByRole("button", { name: "Open Lab Report deadline" }).click();
  await expect(page.getByText("Lab Report", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(page.locator(".agenda-milestones article.completed")).toContainText("Lab Report");
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await expect(page.getByText("Lab Report", { exact: true })).toHaveCount(0);
});

test("an outside assignment routes to one outside-YOVA session", async ({ page }) => {
  await openPreviewApp(page);
  await openAdd(page, "I need to complete 20 calculus problems from my textbook by Thursday");
  await expect(page.getByLabel("How far along are you?")).toBeVisible();
  await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  await page.getByRole("button", { name: /Create one session/ }).click();

  const outside = page.getByRole("button", { name: /Guide me outside YOVA/ });
  await expect(outside).toHaveClass(/selected/);
  await expect(page.getByRole("button", { name: /Build and start session/ })).toBeEnabled();
});

test("a multi-session assignment skips an irrelevant knowledge quiz", async ({ page }) => {
  await openPreviewApp(page);
  await openAdd(page, "I have a 1,500-word history essay due next Friday and I have not started yet");
  await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  await page.getByRole("button", { name: /Create a plan/ }).click();

  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
  await expect(page.getByText(/STARTING-POINT CHECK/)).toHaveCount(0);
  await expect(page.getByText("YOVA-guided plan using another trusted source")).toBeVisible();
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByText("Plan ready")).toBeVisible();
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  await expect(page.getByText("History Essay", { exact: true }).first()).toBeVisible();
});

test("general learning stays deadline-free until the user chooses otherwise", async ({ page }) => {
  await openPreviewApp(page);
  await openAdd(page, "I want to learn personal finance from the beginning");
  await expect(page.getByLabel("Due date, if there is one")).toHaveValue("");
  await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  await expect(page.getByRole("button", { name: /Track the deadline/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Create one session/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Create a plan/ })).toBeVisible();
});

test("a timed product-rule request becomes a specific one-off session", async ({ page }) => {
  await openPreviewApp(page);
  await openAdd(page, "I need to understand the product rule in 20 minutes");
  await expect(page.getByLabel("Title")).toHaveValue("Calculus: Product Rule");
  await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  await expect(page.getByText("20 minutes requested")).toBeVisible();
  await page.getByRole("button", { name: /Create one session/ }).click();
  await expect(page.getByText(/Calculus: Product Rule/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Create it for me/ })).toHaveClass(/selected/);
});

test("an unfinished one-off session stays out of ongoing Learning goals", async ({ page }) => {
  await openPreviewApp(page);
  await openAdd(page, "I need to understand the product rule in 20 minutes");
  await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  await page.getByRole("button", { name: /Create one session/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();

  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click({ force: true });
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Learning", exact: true }).click();

  await expect(page.getByRole("button", { name: /Active 0/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Recent 1/ })).toBeVisible();
  await expect(page.locator(".learning-page").getByText("Calculus: Product Rule", { exact: true })).toHaveCount(0);
});

test("one account never sees another account's deadline", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  await openPreviewApp(firstPage);
  await openAdd(firstPage, "I have a private World War I test in two weeks");
  await firstPage.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  await firstPage.getByRole("button", { name: /Track the deadline/ }).click();
  await firstPage.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(firstPage.getByText("World War I Test Prep", { exact: true })).toBeVisible();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await openPreviewApp(secondPage);
  await secondPage.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(secondPage.getByText("World War I Test Prep", { exact: true })).toHaveCount(0);

  await firstContext.close();
  await secondContext.close();
});

async function openAdd(page: Page, description: string) {
  await page.getByRole("button", { name: "Add something to YOVA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What do you need to learn, prepare for, or complete?" })).toBeVisible();
  await page.getByPlaceholder(/I have a World War I test/).fill(description);
  await page.getByRole("button", { name: /Organize this/ }).click();
  await expect(page.getByRole("heading", { name: "Here is what YOVA understood." })).toBeVisible();
}

async function openPreviewApp(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill(`add-${crypto.randomUUID()}@example.com`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();

  for (const [index, answer] of onboardingAnswers.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", { name: index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue" }).click();
  }

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue to private alpha" }).click();
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Learner\./ })).toBeVisible();
}
