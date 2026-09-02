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

test("a deadline can live in Calendar, be completed, and stay out of Learning", async ({ page }) => {
  const futureDeadline = new Date();
  futureDeadline.setDate(futureDeadline.getDate() + 30);
  const expectedDeadline = [
    futureDeadline.getFullYear(),
    String(futureDeadline.getMonth() + 1).padStart(2, "0"),
    String(futureDeadline.getDate()).padStart(2, "0"),
  ].join("-");
  const deadlinePrompt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(futureDeadline);

  await openPreviewApp(page);
  await openAdd(page, `My lab report is due ${deadlinePrompt}`);

  await expect(page.getByLabel("Title")).toHaveValue("Lab Report");
  await expect(page.getByLabel("Due date, if there is one")).toHaveValue(expectedDeadline);
  await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  await page.getByRole("button", { name: /Track the deadline/ }).click();

  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.getByRole("tab", { name: "List", exact: true }).click();
  await page.locator(".calendar-stub-list button").filter({ hasText: "Lab Report" }).click();
  await expect(page.locator(".calendar-block-detail")).toContainText("Lab Report");
  await page.getByRole("button", { name: "Mark complete", exact: true }).click();
  await expect(page.locator(".calendar-outcome-row.complete")).toContainText("Lab Report");
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await expect(page.getByText("Lab Report", { exact: true })).toHaveCount(0);
});

test("an overdue standalone deadline remains reachable and actionable", async ({ page }) => {
  await openPreviewApp(page);
  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as Record<string, unknown>;
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() - 2);
    dueAt.setHours(12, 0, 0, 0);
    snapshot.deadlineMilestones = [{
      id: "overdue-standalone-deadline",
      title: "Missed lab deadline",
      description: "Decide what to do with this overdue work.",
      dueAt: dueAt.toISOString(),
      status: "open",
      linkedLearningItemId: null,
      createdAt: new Date(dueAt.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
    }];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });

  await page.reload();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.locator(".calendar-issue").filter({ hasText: "Missed lab deadline" }))
    .toContainText("has no preparation plan");
  await page.getByRole("tab", { name: "List", exact: true }).click();
  await page.locator(".calendar-stub-list button").filter({ hasText: "Missed lab deadline" }).click();
  await expect(page.locator(".calendar-block-detail")).toContainText("Missed lab deadline");
  await page.getByRole("button", { name: "Mark complete", exact: true }).click();
  await expect(page.locator(".calendar-outcome-row.complete")).toContainText("Missed lab deadline");
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
  const diagnosticRequestCount = observeDiagnosticRequests(page);
  await openPreviewApp(page);
  await openAdd(page, "I have a 1,500-word history essay due in 14 days and I have not started yet");
  await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  await page.getByRole("button", { name: /Create a plan/ }).click();

  await expect(page.getByRole("heading", { name: "When would you prefer to work on this?" })).toBeVisible();
  await expect(page.locator(".plan-header")).toContainText("Step 3 of 4");
  await page.getByRole("button", { name: "Review plan inputs" }).click();
  await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
  await expect(page.locator(".plan-header")).toContainText("Step 4 of 4");
  expect(diagnosticRequestCount()).toBe(0);
  await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await expect(page.getByText(/STARTING-POINT CHECK/)).toHaveCount(0);
  await expect(page.locator(".confirmation-list")).toContainText("Starting point");
  await expect(page.locator(".confirmation-list")).toContainText("Work mode");
  await expect(page.getByText("YOVA-guided plan using your trusted artifact sources")).toBeVisible();
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByText("Plan ready")).toBeVisible();
  await expect(page.locator(".generated-roadmap")).toContainText("DRAFT AND REFINE");
  await expect(page.locator(".generated-roadmap")).not.toContainText(/(?:PRACTICE|TEACHING) FIRST/);
  await expect(page.locator(".generated-roadmap")).toContainText(/Shape the draft|Draft with support|Revise and strengthen/);
  await expect(page.locator(".plan-alignment-facts")).toContainText("Draft the work, match it to the requirements, and revise it");
  await expect(page.getByRole("button", { name: "Change starting level" })).toHaveCount(0);
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  await expect(page.getByText("1,500-word History Essay", { exact: true }).first()).toBeVisible();
  const topicTitles = page.locator(".knowledge-topic-heading strong");
  await expect(topicTitles.first()).toContainText(/1,500-word history essay/i);
  expect((await topicTitles.allTextContents()).join(" ")).not.toMatch(/in (?:14 days|two weeks)|not started/i);
  const sessionTitles = page.locator(".plan-timeline .timeline-row strong");
  await expect(sessionTitles.first()).toContainText(/history essay/i);
  expect((await sessionTitles.allTextContents()).join(" ")).not.toMatch(/in (?:14 days|two weeks)|not started/i);
});

test("speech and presentation plans bypass placement and use artifact-aware modes", async ({ browser }) => {
  const scenarios = [
    {
      goal: "My persuasive speech about renewable energy is due in 14 days and I have not started it yet",
      modeLabel: "REHEARSE AND REFINE",
      startingApproach: "Build the speech, rehearse it, and refine the delivery",
      phaseLabel: /Shape the speech|Build the speech|Rehearse and refine/,
    },
    {
      goal: "I need to build a biology presentation with slides and speaker notes due in 14 days and I have not started yet",
      modeLabel: "BUILD AND REHEARSE",
      startingApproach: "Build the presentation, rehearse it, and refine the delivery",
      phaseLabel: /Shape the presentation|Build the presentation|Rehearse and refine/,
    },
  ] as const;

  for (const scenario of scenarios) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const diagnosticRequestCount = observeDiagnosticRequests(page);

    await openPreviewApp(page);
    await openAdd(page, scenario.goal);
    await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
    await page.getByRole("button", { name: /Create a plan/ }).click();

    await expect(page.getByRole("heading", { name: "When would you prefer to work on this?" })).toBeVisible();
    await page.getByRole("button", { name: "Review plan inputs" }).click();
    await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
    expect(diagnosticRequestCount()).toBe(0);
    await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
    await expect(page.locator(".confirmation-list")).toContainText("Work mode");

    await page.getByRole("button", { name: "Generate my plan" }).click();
    await expect(page.getByText("Plan ready")).toBeVisible();
    await expect(page.locator(".generated-roadmap")).toContainText(scenario.modeLabel);
    await expect(page.locator(".generated-roadmap")).not.toContainText(/(?:PRACTICE|TEACHING) FIRST/);
    await expect(page.locator(".generated-roadmap")).toContainText(scenario.phaseLabel);
    await expect(page.locator(".plan-alignment-facts")).toContainText(scenario.startingApproach);
    await expect(page.getByRole("button", { name: "Change starting level" })).toHaveCount(0);

    await context.close();
  }
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
  await expect(page.getByLabel("Title")).toHaveValue("Understand the Product Rule");
  await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  await expect(page.getByText("20 minutes requested")).toBeVisible();
  await page.getByRole("button", { name: /Create one session/ }).click();
  await expect(page.getByText(/Understand the Product Rule/).first()).toBeVisible();
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
  await expect(page.locator(".learning-page").getByText("Understand the Product Rule", { exact: true })).toHaveCount(0);
});

test("one account never sees another account's deadline", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  await openPreviewApp(firstPage);
  await openAdd(firstPage, "I have a private World War I test in two weeks");
  await firstPage.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  await firstPage.getByRole("button", { name: /Track the deadline/ }).click();
  await firstPage.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(firstPage.getByText("Private World War I Test", { exact: true }).first()).toBeVisible();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await openPreviewApp(secondPage);
  await secondPage.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(secondPage.getByText("Private World War I Test", { exact: true })).toHaveCount(0);

  await firstContext.close();
  await secondContext.close();
});

async function openAdd(page: Page, description: string) {
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.locator(".calendar-page-header").getByRole("button", { name: "Add to YOVA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What do you need to learn, prepare for, or complete?" })).toBeVisible();
  await page.getByPlaceholder(/I have a World War I test/).fill(description);
  await page.getByRole("button", { name: /Organize this/ }).click();
  await expect(page.getByRole("heading", { name: "Here is what YOVA understood." })).toBeVisible();
}

function observeDiagnosticRequests(page: Page) {
  let requestCount = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/plans/generate" && url.searchParams.get("mode") === "diagnostic") {
      requestCount += 1;
    }
  });
  return () => requestCount;
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

  await page.getByRole("button", { name: "Open YOVA" }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
}
