import { expect, test, type Page, type Response } from "@playwright/test";
import { PLAN_FIXED_NOW } from "./helpers/frozen-clock";
import {
  buildPlanFromSchedule,
  chooseGeneratedPlanSource,
  expandGroupedPlanTopics,
  openPlanSetupPreview,
} from "./helpers/plan-setup";
import type { LearningPlan } from "../src/lib/domain";

test.use({ timezoneId: "Europe/London", video: "on" });

// These journeys use development-preview mapping, generation, receipt checking
// and activation. They verify intake/state behavior, not live AI content quality.
test("a deadline can live in Calendar, be completed, and stay out of Learning", async ({ page }) => {
  await openPreviewHome(page);
  await addCalendarDeadline(page, "Lab Report", dateIn(30));
  const saved = await storedCalendarEvents(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ title: "Lab Report", eventType: "deadline", deadlineOnly: true, done: false });
  expect(saved[0]!.dueAt.slice(0, 10)).toBe(dateIn(30));

  await page.reload();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await inspectOutcomeInWeek(page, "Lab Report", "next", 6);
  const detail = page.locator(".calendar-block-detail");
  await expect(detail).toContainText("Lab Report");
  await detail.getByRole("button", { name: "Mark done", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Mark open", exact: true })).toBeVisible();
  await expect.poll(async () => (await storedCalendarEvents(page))[0]?.done).toBe(true);
  await detail.getByRole("button", { name: "Close calendar detail" }).click();
  await page.getByLabel("Deadline status").selectOption("complete");
  await expect(page.locator(".calendar-outcome-row.complete")).toContainText("Lab Report");
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await expect(page.getByText("Lab Report", { exact: true })).toHaveCount(0);
});

test("a saved overdue standalone milestone remains reachable and actionable", async ({ page }) => {
  await openPreviewHome(page);
  // Existing saved milestones remain supported after new entries move to the
  // Calendar quick-add flow; this fixture specifically protects that migration.
  await page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")!);
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() - 2);
    dueAt.setHours(12, 0, 0, 0);
    snapshot.deadlineMilestones = [{
      id: "overdue-standalone-deadline", title: "Missed lab deadline",
      description: "Decide what to do with this overdue work.", dueAt: dueAt.toISOString(),
      status: "open", linkedLearningItemId: null,
      createdAt: new Date(dueAt.getTime() - 86_400_000).toISOString(),
    }];
    snapshot.updatedAt = new Date().toISOString();
    localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
  await page.reload();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.locator(".calendar-issue").filter({ hasText: "Missed lab deadline" }))
    .toContainText("has no preparation plan");
  await inspectOutcomeInWeek(page, "Missed lab deadline", "previous", 2);
  await page.getByRole("button", { name: "Mark complete", exact: true }).click();
  await expect(page.locator(".calendar-block-detail")).toContainText("Complete");
  await page.getByRole("button", { name: "Close calendar detail" }).click();
  await page.getByLabel("Deadline status").selectOption("complete");
  await expect(page.locator(".calendar-outcome-row.complete")).toContainText("Missed lab deadline");
});

test("an outside assignment opens one outside-YOVA session", async ({ page }) => {
  await openPreviewHome(page);
  await openStudyNow(page, "I need to complete 20 calculus problems from my textbook by Thursday");
  await page.getByRole("radio", { name: "Outside YOVA", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Outside YOVA", exact: true }))
    .toHaveAttribute("aria-checked", "true");
  const plan = await activateStudyNow(page);
  expect(plan.creationIntent).toBe("study_now");
  expect(plan.studyMode).toBe("outside");
  expect(plan.sessions).toHaveLength(1);
  await expect(page.getByTestId("pre-session-card")).toBeVisible();
});

test("a multi-session assignment skips placement and retains its outside source through activation", async ({ page }) => {
  const diagnosticRequestCount = observeDiagnosticRequests(page);
  const goal = "I have a 1,500-word history essay due in 14 days and I have not started yet";
  await openPlanSetupPreview(page);
  await page.getByLabel("Learning goal or deadline").fill(goal);
  await page.getByRole("button", { name: "An assignment", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What YOVA understood" })).toBeVisible();
  await page.getByRole("button", { name: "Skip corrections", exact: true }).click();
  await expect(page.getByRole("heading", { name: "When would you prefer to work on this?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Build my plan", exact: true })).toBeVisible();
  const plan = await generatedPlan(await buildPlanFromSchedule(page));
  expect(diagnosticRequestCount()).toBe(0);
  expect(plan.studyMode).toBe("outside");
  expect(plan.deadline!.slice(0, 10)).toBe(dateIn(14));
  expect(plan.sessions.length).toBeGreaterThan(1);
  expect(plan.sessions.every(session => session.studyRoute?.target.taskFamily === "writing_argumentation")).toBe(true);
  expect(plan.planModel?.learningGoal).toBe(goal);
  await expectGroupedPlanMatches(page, plan);
  const titles = [...plan.knowledgeMap!.topics.map(topic => topic.title), ...plan.sessions.map(session => session.title)].join(" ");
  expect(titles).toMatch(/history essay/i);
  expect(titles).not.toMatch(/in (?:14 days|two weeks)|not started/i);
  await activateGroupedPlan(page, plan);
});

for (const scenario of [
  { name: "speech", goal: "My persuasive speech about renewable energy is due in 14 days and I have not started it yet", subject: /speech|renewable energy/i },
  { name: "presentation", goal: "I need to build a biology presentation with slides and speaker notes due in 14 days and I have not started yet", subject: /presentation|biology/i },
]) {
  test(`${scenario.name} plans bypass placement and route to artifact work`, async ({ page }) => {
    const diagnosticRequestCount = observeDiagnosticRequests(page);
    await openPlanSetupPreview(page);
    await page.getByLabel("Learning goal or deadline").fill(scenario.goal);
    await page.getByRole("button", { name: "An assignment", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await chooseGeneratedPlanSource(page);
    await expect(page.getByRole("heading", { name: "When would you prefer to work on this?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Build my plan", exact: true })).toBeVisible();
    const plan = await generatedPlan(await buildPlanFromSchedule(page));
    expect(diagnosticRequestCount()).toBe(0);
    expect(plan.studyMode).toBe("inside");
    expect(plan.sessions.length).toBeGreaterThan(1);
    expect(plan.sessions.every(session => session.studyRoute?.target.taskFamily === "writing_argumentation")).toBe(true);
    expect(plan.sessions.map(session => session.title).join(" ")).toMatch(scenario.subject);
    expect(plan.planModel?.learningGoal).toBe(scenario.goal);
    await expectGroupedPlanMatches(page, plan);
  });
}

test("general learning stays deadline-free until the user changes the goal", async ({ page }) => {
  await openPlanSetupPreview(page);
  await page.getByLabel("Learning goal or deadline").fill("I want to learn personal finance from the beginning");
  await expect(page.getByRole("button", { name: "A test", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await chooseGeneratedPlanSource(page);
  await expect(page.getByText("No fixed deadline", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Build my plan", exact: true })).toBeVisible();

  // Returning through understanding/source must invalidate the accepted map
  // when a changed goal introduces an explicit date.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const goal = `Learn household budgeting and compound interest for my personal goal on ${dateIn(21)}.`;
  await page.getByLabel("Learning goal or deadline").fill(goal);
  await page.getByRole("button", { name: "My own goal", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await chooseGeneratedPlanSource(page);
  const plan = await generatedPlan(await buildPlanFromSchedule(page));
  expect(plan.deadline!.slice(0, 10)).toBe(dateIn(21));
  expect(plan.planModel?.learningGoal).toBe(goal);
  await expectGroupedPlanMatches(page, plan);
  await activateGroupedPlan(page, plan);
});

test("a direct 20-minute product-rule request produces one bounded session", async ({ page }) => {
  await openPreviewHome(page);
  await openStudyNow(page, "Help me understand the product rule and practice using it in 20 minutes.");
  await expect(page.getByRole("radio", { name: "Inside YOVA", exact: true })).toHaveAttribute("aria-checked", "true");
  const plan = await activateStudyNow(page);
  expect(plan.creationIntent).toBe("study_now");
  expect(plan.studyMode).toBe("inside");
  expect(plan.sessions).toHaveLength(1);
  expect(plan.sessions[0]!.title).toMatch(/product rule/i);
  expect(plan.sessions[0]!.workload?.version).toBe("topic_workload_v1");
  expect(plan.sessions[0]!.estimatedMinutes).toBeLessThanOrEqual(20);
  expect(plan.sessions[0]!.workload!.ceilingMinutes).toBeLessThanOrEqual(20);
  expect(plan.sessions[0]!.workload!.topicSubtopics.length).toBeLessThanOrEqual(4);
  await expect(page.getByTestId("pre-session-card")).toBeVisible();
});

test("an unfinished one-off session stays out of ongoing Learning goals", async ({ page }) => {
  await openPreviewHome(page);
  await openStudyNow(page, "Help me understand the product rule and practice using it.");
  const plan = await activateStudyNow(page);
  await page.getByTestId("pre-session-card").getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await expect(page.getByRole("button", { name: /Active 0/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Recent 1/ })).toBeVisible();
  await expect(page.locator(".learning-page").getByText(plan.title, { exact: true })).toHaveCount(0);
});

test("a preview browser context does not inherit another context's deadline", async ({ browser }) => {
  // Separate local-storage contexts exercise preview isolation only; server
  // account ownership is covered by the authenticated repository/API tests.
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  try {
    const firstPage = await firstContext.newPage();
    await openPreviewHome(firstPage);
    await addCalendarDeadline(firstPage, "Private World War I Test", dateIn(14));
    expect((await storedCalendarEvents(firstPage)).map(event => event.title)).toEqual(["Private World War I Test"]);
    const secondPage = await secondContext.newPage();
    await openPreviewHome(secondPage);
    await secondPage.getByRole("button", { name: "Calendar", exact: true }).click();
    await expect(secondPage.getByText("Private World War I Test", { exact: true })).toHaveCount(0);
    expect(await storedCalendarEvents(secondPage)).toEqual([]);
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

async function openPreviewHome(page: Page) {
  await openPlanSetupPreview(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
}

async function openStudyNow(page: Page, goal: string) {
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByLabel("Study Now topic or result").fill(goal);
}

async function activateStudyNow(page: Page): Promise<LearningPlan> {
  const activated = page.waitForResponse(response => new URL(response.url()).pathname === "/api/plans/activate");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const response = await activated;
  expect(response.ok()).toBe(true);
  return (await response.json()).plan;
}

async function generatedPlan(response: Response): Promise<LearningPlan> {
  expect(response.ok()).toBe(true);
  return (await response.json()).plan;
}

async function expectGroupedPlanMatches(page: Page, plan: LearningPlan) {
  const grouped = page.getByRole("region", { name: "Plan grouped by topic" });
  await expect(grouped.getByRole("heading", { name: plan.title, exact: true })).toBeVisible();
  await expandGroupedPlanTopics(page);
  await expect(grouped.locator("[data-block-id]")).toHaveCount(plan.sessions.length);
  for (const session of plan.sessions) await expect(grouped.locator(`[data-block-id="${session.id}"]`)).toContainText(session.title);
}

async function activateGroupedPlan(page: Page, draft: LearningPlan) {
  const activated = page.waitForResponse(response => new URL(response.url()).pathname === "/api/plans/activate");
  await page.getByRole("button", { name: "Use this plan", exact: true }).click();
  expect((await activated).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Start next block", exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("yova.preview.v1")!).plans.at(-1)) as LearningPlan;
  expect(saved.deadline).toBe(draft.deadline);
  expect(saved.studyMode).toBe(draft.studyMode);
  expect(saved.planModel?.learningGoal).toBe(draft.planModel?.learningGoal);
  expect(saved.sessions.map(session => session.title)).toEqual(draft.sessions.map(session => session.title));
}

async function addCalendarDeadline(page: Page, title: string, date: string) {
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const quickAdd = page.getByLabel("Quick add a calendar item");
  await quickAdd.fill(`${title} due ${date}`);
  await quickAdd.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "Confirm quick add" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByLabel("Title", { exact: true }).fill(title);
  await expect(confirmation.getByLabel("Type", { exact: true })).toHaveValue(/^(deadline|exam)$/);
  await expect(confirmation.getByLabel("Calendar time", { exact: true })).toHaveValue("");
  await expect(confirmation.getByLabel("Due time", { exact: true })).toHaveValue(new RegExp(`^${date}T`));
  await confirmation.getByRole("button", { name: "Save to calendar", exact: true }).click();
  await expect(page.locator(".calendar-block-detail").getByRole("heading", { name: title, exact: true })).toBeVisible();
}

async function storedCalendarEvents(page: Page) {
  return page.evaluate(() => {
    const envelope = JSON.parse(localStorage.getItem("yova.calendar.prototype.v1") ?? '{"accounts":{}}') as {
      accounts: Record<string, { manualEvents: Array<{ title: string; eventType: string; deadlineOnly: boolean; done: boolean; dueAt: string }> }>;
    };
    return Object.values(envelope.accounts).flatMap(account => account.manualEvents);
  });
}

function observeDiagnosticRequests(page: Page) {
  let requestCount = 0;
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/plans/generate" && url.searchParams.get("mode") === "diagnostic") requestCount += 1;
  });
  return () => requestCount;
}

function dateIn(days: number) {
  return new Date(PLAN_FIXED_NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

async function inspectOutcomeInWeek(page: Page, title: string, direction: "next" | "previous", maxPeriods: number) {
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator(".calendar-week")).toBeVisible();
  const dueChip = page.locator(".calendar-due-chip").filter({ hasText: title });
  const range = page.locator("#calendar-board-title");
  const navigation = page.getByRole("button", { name: direction === "next" ? "Next calendar period" : "Previous calendar period" });
  for (let period = 0; period <= maxPeriods; period += 1) {
    if (await dueChip.count()) { await dueChip.click(); return; }
    const previousRange = await range.innerText();
    await navigation.click();
    await expect.poll(() => range.innerText()).not.toBe(previousRange);
  }
  throw new Error(`Could not find ${title} within ${maxPeriods} calendar periods.`);
}
