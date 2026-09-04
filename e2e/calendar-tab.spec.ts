import { expect, test, type Page } from "@playwright/test";

const FIXED_NOW = new Date("2026-09-02T10:00:00.000Z");

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

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
});

test("Calendar exposes only the complete Week surface with bounded keyboard navigation", async ({ page }) => {
  await openPreviewCalendar(page);

  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Put something on your calendar" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);

  await expect(page.getByText("Week view", { exact: true })).toHaveAttribute("aria-current", "page");
  for (const unfinishedView of ["Day", "Month", "Semester", "List"]) {
    await expect(page.getByRole("tab", { name: unfinishedView, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("heading", { name: "Coming up" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Why this week looks like this" })).toBeVisible();
  await expect(page.getByText(/Your week is on track\.|Needs attention/).first()).toBeVisible();

  const quickAdd = page.getByLabel("Quick add a calendar item");
  await page.keyboard.press("Control+k");
  await expect(quickAdd).toBeFocused();

  const initialRange = await page.locator("#calendar-board-title").innerText();
  await quickAdd.fill("Review IR cases tomorrow for 45 minutes");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#calendar-board-title")).toHaveText(initialRange);

  await page.getByRole("button", { name: "Today", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#calendar-board-title")).not.toHaveText(initialRange);

  await page.setViewportSize({ width: 375, height: 844 });
  const containment = await page.locator(".calendar-workspace").evaluate((workspace) => {
    const rail = workspace.querySelector<HTMLElement>(".calendar-rail");
    const main = workspace.querySelector<HTMLElement>(".calendar-main");
    if (!rail || !main) return null;
    const railRect = rail.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    return {
      bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      railBeforeMain: railRect.top <= mainRect.top && railRect.bottom <= mainRect.top + 2,
      workspaceFits: workspace.scrollWidth <= workspace.clientWidth + 1,
    };
  });
  expect(containment).toEqual({ bodyFits: true, railBeforeMain: true, workspaceFits: true });
  await expect(page.locator(".calendar-week")).toHaveCSS("overflow-x", "auto");
});

test("quick add confirms its interpretation, persists by account, and can be undone", async ({ page }) => {
  await openPreviewCalendar(page);

  const quickAdd = page.getByLabel("Quick add a calendar item");
  await quickAdd.fill("stats pset due friday, 90 min tonight");
  await quickAdd.press("Enter");

  const confirmation = page.getByRole("dialog", { name: "Confirm quick add" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByLabel("Title")).toHaveValue("Stats Pset");
  await expect(confirmation.getByLabel("Type")).toHaveValue("deadline");
  await expect(confirmation.getByLabel("Duration")).toHaveValue("90");
  await expect(confirmation.getByLabel("Calendar time")).not.toHaveValue("");
  await expect(confirmation.getByLabel("Due time")).not.toHaveValue("");
  await expect(confirmation.getByRole("button", { name: "Save and build plan" })).toBeVisible();

  expect(await storedManualEvents(page)).toEqual([]);
  await confirmation.getByRole("button", { name: "Save to calendar" }).click();
  await expect(page.locator(".calendar-block-detail").getByRole("heading", { name: "Stats Pset", exact: true })).toBeVisible();

  let stored = await storedManualEvents(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    title: "Stats Pset",
    eventType: "deadline",
    fixed: false,
    done: false,
    durationMinutes: 90,
  });

  await page.reload();
  await openCalendarTab(page);
  await page.getByRole("button", { name: /^Stats Pset, / }).click();
  const detail = page.locator(".calendar-block-detail");
  await expect(detail).toContainText("Why here");
  await expect(detail).toContainText("Added manually. YOVA has not inferred a placement reason.");
  await expect(detail).toContainText("Fully editable because you added it manually.");
  await expect(detail.getByRole("button", { name: "Build plan" })).toBeVisible();

  const changes = page.locator(".calendar-change-log");
  await changes.getByText(/Recent schedule changes/).click();
  await expect(changes).toContainText("Added Stats Pset to the calendar.");
  await changes.getByRole("button", { name: "Undo latest change" }).click();

  await expect(page.getByRole("button", { name: /^Stats Pset, / })).toHaveCount(0);
  stored = await storedManualEvents(page);
  expect(stored).toEqual([]);
  await expect(changes).toContainText("Undone");
});

test("quick add clamps an overlong title before confirmation and persists without crashing", async ({ page }) => {
  await openPreviewCalendar(page);

  const overlongTitle = "a".repeat(220);
  const clampedTitle = `A${"a".repeat(159)}`;
  const quickAdd = page.getByLabel("Quick add a calendar item");
  await quickAdd.fill(`${overlongTitle} tonight, 30 min`);
  await quickAdd.press("Enter");

  const confirmation = page.getByRole("dialog", { name: "Confirm quick add" });
  const title = confirmation.getByLabel("Title");
  await expect(title).toHaveValue(clampedTitle);
  await expect(title).toHaveAttribute("maxlength", "160");
  await confirmation.getByRole("button", { name: "Save to calendar" }).click();

  await expect(page.locator(".calendar-action-error")).toHaveCount(0);
  const stored = await storedManualEvents(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]?.title).toBe(clampedTitle);
});

test("exiting a quick-add plan draft returns to Calendar without losing or duplicating the manual deadline", async ({ page }) => {
  await openPreviewCalendar(page);

  await page.getByLabel("Quick add a calendar item").fill("cellular respiration exam due friday, 90 min tonight");
  await page.getByLabel("Quick add a calendar item").press("Enter");
  const confirmation = page.getByRole("dialog", { name: "Confirm quick add" });
  await confirmation.getByRole("button", { name: "Save and build plan" }).click();

  await chooseCalendarGeneratedSource(page);
  // Dispatch through the button itself so Next's development-only portal
  // cannot intercept the mobile pointer before the app receives the action.
  await page.getByRole("button", { name: "Exit", exact: true }).dispatchEvent("click");
  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();

  expect(await storedManualEvents(page)).toHaveLength(1);
  expect(await previewAuthorityCounts(page)).toEqual({ plans: 0, milestones: 0 });

  await page.reload();
  await openCalendarTab(page);
  await expect(page.getByRole("button", { name: /^Cellular Respiration Exam, / })).toHaveCount(1);
  expect(await storedManualEvents(page)).toHaveLength(1);
});

test("finishing a quick-add plan replaces the manual deadline with one linked authoritative outcome", async ({ page }) => {
  await openPreviewCalendar(page);

  await page.getByLabel("Quick add a calendar item").fill("cellular respiration exam due friday, 90 min tonight");
  await page.getByLabel("Quick add a calendar item").press("Enter");
  const confirmation = page.getByRole("dialog", { name: "Confirm quick add" });
  await confirmation.getByLabel("Due time").fill(await futureLocalDateTime(page, 9));
  await confirmation.getByRole("button", { name: "Save and build plan" }).click();

  await chooseCalendarGeneratedSource(page);
  const reviewInputs = page.getByRole("button", { name: "Review plan inputs" });
  if (await reviewInputs.isVisible()) {
    await reviewInputs.click();
  } else {
    await page.getByRole("button", { name: "Continue to placement check" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
  }
  await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByText("Plan ready")).toBeVisible();
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();

  await expect.poll(() => quickAddPlanCommitState(page)).toMatchObject({
    planCount: 1,
    milestoneCount: 1,
    manualEventCount: 0,
    milestoneLinkedToPlan: true,
  });

  await openCalendarTab(page);
  await expect(page.locator(".calendar-outcome-row").filter({ hasText: "Cellular Respiration Exam" })).toHaveCount(1);
  await expect(page.locator(".calendar-issue").filter({ hasText: "Cellular Respiration Exam has no preparation plan" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Cellular Respiration Exam, .*Exam$/ })).toHaveCount(0);
});

test("authoritative plans, unplanned outcomes, evidence-backed reasons, and opt-in time adjustment stay connected", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);
  await openCalendarTab(page);
  await seedCalendarAuthority(page);
  await page.reload();
  await openCalendarTab(page);

  const planBlock = page.getByRole("button", { name: /^Causal map review, / });
  await expect(planBlock).toBeVisible();
  await planBlock.click();

  const detail = page.locator(".calendar-block-detail");
  await expect(detail).toContainText("Why here");
  await expect(detail).toContainText("session 1 of 1");
  await expect(detail).toContainText("Why this method");
  await expect(detail).toContainText("Concept Mapping");
  await expect(detail).toContainText("A cause map exposes missing links before retrieval.");
  await expect(detail).toContainText("Flexibility");
  await expect(detail).toContainText("Related outcome");
  await expect(detail.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Move", exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Open plan", exact: true })).toBeVisible();

  const attention = page.locator(".calendar-attention");
  await expect(attention.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  const unplannedIssue = attention.locator(".calendar-issue").filter({ hasText: "Unplanned term paper" });
  await expect(unplannedIssue).toContainText("has no preparation plan");
  await expect(unplannedIssue.getByRole("button", { name: "Build plan" })).toBeVisible();

  const outcomes = page.locator(".calendar-outcomes");
  await expect(outcomes).toContainText("History Midterm");
  await expect(outcomes).toContainText("Unplanned term paper");
  await expect(outcomes).not.toContainText(/% prepared/i);
  await page.locator(".calendar-week-reasons").getByRole("button", { name: "Show all" }).click();
  await expect(page.locator(".calendar-week-reasons")).toContainText("nearest open outcome");

  const originalSchedule = await previewSessionSchedule(page, "causal-map-session");
  const adjustment = page.locator(".agenda-adjustment-tools");
  await adjustment.getByText("Adjust today’s available time", { exact: true }).click();
  await adjustment.getByLabel("Minutes available today").fill("10");
  await adjustment.getByLabel("What changed? Optional").fill("busy");
  await adjustment.getByRole("button", { name: "Review options" }).click();
  await expect(adjustment).toContainText("PROPOSED ADJUSTMENT");
  await expect(adjustment).toContainText(/Move one unfinished block|Shorten one safe content block|No safe automatic change/);
  await expect.poll(() => storedAvailabilityReason(page)).toBe("You said: busy.");
  expect(await previewSessionSchedule(page, "causal-map-session")).toBe(originalSchedule);
});

test("Calendar Start opens the exact ready session and fails closed on an ambiguous legacy plan", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);
  await seedCalendarAuthority(page);
  await setPreviewSessionSchedule(page, "causal-map-session", FIXED_NOW.toISOString());
  await page.reload();
  await openCalendarTab(page);

  await page.getByRole("button", { name: /^Causal map review, / }).click();
  await page.locator(".calendar-block-detail").getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(page.locator(".session-current-assumption")).toContainText("Causal map review");
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();

  await seedSecondReadySession(page);
  await page.reload();
  await openCalendarTab(page);
  await page.getByRole("button", { name: /^Causal map review, / }).click();
  await page.locator(".calendar-block-detail").getByRole("button", { name: "Start", exact: true }).click();

  await expect(page.locator(".calendar-action-error")).toContainText(
    "That exact learning block is no longer ready. Reload Calendar to use the current plan order.",
  );
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
});

test("a future overloaded-day issue edits only that date's availability", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);
  await openCalendarTab(page);
  await seedCalendarAuthority(page);
  await setPreviewSessionSchedule(page, "causal-map-session", "2026-09-03T17:00:00.000Z");
  await seedAvailabilityOverrides(page);
  await page.reload();
  await openCalendarTab(page);

  const futureIssue = page.locator(".calendar-issue").filter({ hasText: "Sep 3 is overloaded" });
  await expect(futureIssue).toContainText("40 minutes are planned, but you said 20 minutes are available.");
  await futureIssue.getByRole("button", { name: "Adjust this day" }).click();

  const adjustment = page.locator(".agenda-adjustment-tools");
  await expect(adjustment).toHaveAttribute("open", "");
  await expect(adjustment).toContainText("Adjust Sep 3, 2026 available time");
  await expect(adjustment.getByLabel("Minutes available Sep 3, 2026")).toHaveValue("20");
  await adjustment.getByLabel("Minutes available Sep 3, 2026").fill("25");
  await adjustment.getByLabel("What changed? Optional").fill("busy");
  await adjustment.getByRole("button", { name: "Review options" }).click();
  await expect(adjustment).toContainText("PROPOSED ADJUSTMENT");

  await expect.poll(() => storedAvailabilityOverrides(page)).toEqual([
    expect.objectContaining({
      dateKey: "2026-09-02",
      availableMinutes: 120,
      reason: "Today remains available for a full study block.",
    }),
    expect.objectContaining({
      dateKey: "2026-09-03",
      availableMinutes: 25,
      reason: "You said: busy.",
    }),
  ]);
});

test("learner-owned blocks resize and suggested moves become pinned only after approval", async ({ page }) => {
  await openPreviewCalendar(page);
  await seedMovableCalendarState(page);
  await page.reload();
  await openCalendarTab(page);

  const manualBlock = page.getByRole("button", { name: /^Editable study block, / });
  await expect(manualBlock).toBeVisible();
  await expect(page.locator(".calendar-your-day")).toContainText("Editable study block");
  const resizeHandle = manualBlock.locator(".calendar-resize-handle");
  const resizeTarget = page.getByRole("button", { name: "Add at 11 AM on Sep 2, 2026" });
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await resizeHandle.dispatchEvent("dragstart", { dataTransfer });
  await resizeTarget.dispatchEvent("dragover", { dataTransfer });
  await resizeTarget.dispatchEvent("drop", { dataTransfer });
  await expect.poll(async () => {
    const events = await storedManualEvents(page);
    return events.find((event) => event.title === "Editable study block")?.durationMinutes ?? null;
  }).toBe(60);

  await page.getByRole("button", { name: /^Suggested source review, / }).click();
  const detail = page.locator(".calendar-block-detail");
  await expect(detail).toContainText("Optional and dismissible");
  await detail.getByRole("button", { name: "Move", exact: true }).click();
  await detail.getByLabel("New time").fill("2026-09-03T18:00");
  await detail.getByRole("button", { name: "Save new time" }).click();
  await expect(detail).toContainText("Pinned by you; YOVA will not move it automatically.");
  await expect.poll(() => storedSuggestion(page, "suggested-source-review")).toMatchObject({
    status: "accepted",
    flexibility: "pinned",
  });

  await page.reload();
  await openCalendarTab(page);
  await page.getByRole("button", { name: /^Suggested source review, / }).click();
  await expect(page.locator(".calendar-block-detail")).toContainText(
    "Pinned by you; YOVA will not move it automatically.",
  );
});

async function openPreviewCalendar(page: Page) {
  await createPreviewAccount(page);
  await completeOnboarding(page);
  await openCalendarTab(page);
}

async function futureLocalDateTime(page: Page, daysAhead: number) {
  return page.evaluate((offset) => {
    const date = new Date(Date.now());
    date.setDate(date.getDate() + offset);
    date.setHours(18, 0, 0, 0);
    const part = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
  }, daysAhead);
}

async function openCalendarTab(page: Page) {
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
}

async function chooseCalendarGeneratedSource(page: Page) {
  await expect(page.getByRole("heading", { name: "Where should the learning come from?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Use my materials/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Create it for me/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Guide me outside YOVA/ })).toBeVisible();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
}

async function createPreviewAccount(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill(`calendar-${crypto.randomUUID()}@example.com`);
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

async function storedManualEvents(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.calendar.prototype.v1");
    if (!raw) return [];
    const envelope = JSON.parse(raw) as {
      accounts: Record<string, {
        manualEvents: Array<{
          title: string;
          eventType: string;
          startsAt: string;
          endsAt: string;
          fixed: boolean;
          done: boolean;
        }>;
      }>;
    };
    return Object.values(envelope.accounts).flatMap((account) => account.manualEvents.map((event) => ({
      ...event,
      durationMinutes: (Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000,
    })));
  });
}

async function previewAuthorityCounts(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) throw new Error("Expected a preview snapshot.");
    const snapshot = JSON.parse(raw) as { plans?: unknown[]; deadlineMilestones?: unknown[] };
    return {
      plans: snapshot.plans?.length ?? 0,
      milestones: snapshot.deadlineMilestones?.length ?? 0,
    };
  });
}

async function quickAddPlanCommitState(page: Page) {
  const authority = await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) throw new Error("Expected a preview snapshot.");
    const snapshot = JSON.parse(raw) as {
      plans?: Array<{ learningItemId: string }>;
      deadlineMilestones?: Array<{ linkedLearningItemId: string | null }>;
    };
    const plan = snapshot.plans?.[0] ?? null;
    const milestone = snapshot.deadlineMilestones?.[0] ?? null;
    return {
      planCount: snapshot.plans?.length ?? 0,
      milestoneCount: snapshot.deadlineMilestones?.length ?? 0,
      milestoneLinkedToPlan: Boolean(
        plan && milestone && milestone.linkedLearningItemId === plan.learningItemId,
      ),
    };
  });
  return {
    ...authority,
    manualEventCount: (await storedManualEvents(page)).length,
  };
}

async function seedCalendarAuthority(page: Page) {
  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as {
      plans: unknown[];
      deadlineMilestones?: unknown[];
      updatedAt?: string;
    };
    snapshot.plans.push({
      id: "88000000-0000-4000-8000-000000000001",
      learningItemId: "88000000-0000-4000-8000-000000000002",
      title: "History Midterm",
      topic: "European alliance systems",
      kind: "test",
      deadline: "2026-09-05T18:00:00.000Z",
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
      creationIntent: "plan",
      sessionArchitectureVersion: "streamed_teaching_v1",
      rationale: "Preserve the learning sequence before the midterm.",
      createdAt: "2026-09-01T10:00:00.000Z",
      materials: [],
      sessions: [{
        id: "causal-map-session",
        sequence: 1,
        title: "Causal map review",
        objective: "Explain how alliance commitments raised escalation risk.",
        method: "Concept Mapping",
        methodReason: "A cause map exposes missing links before retrieval.",
        scheduledFor: "2026-09-02T17:00:00.000Z",
        estimatedMinutes: 40,
        amountLabel: "One causal map and evidence check · about 40 min",
        learningMode: "study",
        topicIds: ["alliances-topic"],
        contentTargets: ["Alliance escalation"],
        completionEvidence: ["Explain two linked causes without notes"],
        status: "ready",
      }],
    });
    snapshot.deadlineMilestones = [{
      id: "unplanned-term-paper",
      title: "Unplanned term paper",
      description: "Submit a sourced argument about industrialization.",
      dueAt: "2026-09-04T20:00:00.000Z",
      status: "open",
      linkedLearningItemId: null,
      createdAt: "2026-09-01T10:00:00.000Z",
    }];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
}

async function seedMovableCalendarState(page: Page) {
  await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.calendar.prototype.v1");
    if (!raw) throw new Error("Expected account-scoped Calendar storage.");
    const envelope = JSON.parse(raw) as {
      accounts: Record<string, {
        manualEvents: unknown[];
        suggestions: unknown[];
        updatedAt: string;
      }>;
    };
    const account = Object.values(envelope.accounts)[0];
    if (!account) throw new Error("Expected a Calendar account bucket.");
    const localDate = (day: number, hour: number, minute = 0) => (
      new Date(2026, 8, day, hour, minute, 0, 0).toISOString()
    );
    account.manualEvents = [{
      id: "editable-study-block",
      title: "Editable study block",
      eventType: "personal",
      startsAt: localDate(2, 10),
      endsAt: localDate(2, 10, 30),
      dueAt: null,
      fixed: false,
      done: false,
      courseId: null,
      courseLabel: "International Relations",
      outcomeId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    account.suggestions = [{
      id: "suggested-source-review",
      title: "Suggested source review",
      startsAt: localDate(3, 17),
      durationMinutes: 25,
      planId: null,
      planSessionId: null,
      courseId: null,
      outcomeId: null,
      status: "pending",
      flexibility: "movable",
      reason: {
        text: "This open period avoids the fixed class while keeping the source review optional.",
        source: "suggestion",
        evidenceRefs: ["learner-visible-suggestion"],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    account.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.calendar.prototype.v1", JSON.stringify(envelope));
  });
}

async function storedSuggestion(page: Page, suggestionId: string) {
  return page.evaluate((requestedSuggestionId) => {
    const raw = window.localStorage.getItem("yova.calendar.prototype.v1");
    if (!raw) return null;
    const envelope = JSON.parse(raw) as {
      accounts: Record<string, {
        suggestions: Array<{ id: string; status: string; flexibility: string; startsAt: string | null }>;
      }>;
    };
    return Object.values(envelope.accounts).flatMap((account) => account.suggestions)
      .find((suggestion) => suggestion.id === requestedSuggestionId) ?? null;
  }, suggestionId);
}

async function storedAvailabilityReason(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.calendar.prototype.v1");
    if (!raw) return null;
    const envelope = JSON.parse(raw) as {
      accounts: Record<string, {
        availabilityOverrides: Array<{ reason: string }>;
      }>;
    };
    return Object.values(envelope.accounts).flatMap((account) => account.availabilityOverrides)
      .at(-1)?.reason ?? null;
  });
}

async function previewSessionSchedule(page: Page, sessionId: string) {
  return page.evaluate((requestedSessionId) => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot.");
    const snapshot = JSON.parse(stored) as {
      plans: Array<{ sessions: Array<{ id: string; scheduledFor: string }> }>;
    };
    const session = snapshot.plans.flatMap((plan) => plan.sessions)
      .find((candidate) => candidate.id === requestedSessionId);
    if (!session) throw new Error(`Missing session ${requestedSessionId}.`);
    return session.scheduledFor;
  }, sessionId);
}

async function setPreviewSessionSchedule(page: Page, sessionId: string, scheduledFor: string) {
  await page.evaluate(({ requestedSessionId, nextScheduledFor }) => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot.");
    const snapshot = JSON.parse(stored) as {
      plans: Array<{ sessions: Array<{ id: string; scheduledFor: string }> }>;
      updatedAt?: string;
    };
    const session = snapshot.plans.flatMap((plan) => plan.sessions)
      .find((candidate) => candidate.id === requestedSessionId);
    if (!session) throw new Error(`Missing session ${requestedSessionId}.`);
    session.scheduledFor = nextScheduledFor;
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  }, { requestedSessionId: sessionId, nextScheduledFor: scheduledFor });
}

async function seedSecondReadySession(page: Page) {
  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot.");
    const snapshot = JSON.parse(stored) as {
      plans: Array<{
        id: string;
        sessions: Array<Record<string, unknown> & { id: string }>;
      }>;
      updatedAt?: string;
    };
    const plan = snapshot.plans.find((candidate) => candidate.id === "88000000-0000-4000-8000-000000000001");
    const first = plan?.sessions.find((session) => session.id === "causal-map-session");
    if (!plan || !first) throw new Error("Expected the seeded Calendar plan and ready session.");
    plan.sessions.push({
      ...first,
      id: "legacy-second-ready-session",
      sequence: 2,
      title: "Legacy second ready session",
      objective: "This malformed legacy state must not redirect the requested Calendar start.",
      scheduledFor: "2026-09-02T11:00:00.000Z",
      status: "ready",
    });
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
}

async function seedAvailabilityOverrides(page: Page) {
  await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.calendar.prototype.v1");
    if (!raw) throw new Error("Expected account-scoped Calendar storage.");
    const envelope = JSON.parse(raw) as {
      accounts: Record<string, {
        availabilityOverrides: unknown[];
        updatedAt: string;
      }>;
    };
    const account = Object.values(envelope.accounts)[0];
    if (!account) throw new Error("Expected a Calendar account bucket.");
    account.availabilityOverrides = [
      {
        dateKey: "2026-09-02",
        availableMinutes: 120,
        reason: "Today remains available for a full study block.",
        updatedAt: new Date().toISOString(),
      },
      {
        dateKey: "2026-09-03",
        availableMinutes: 20,
        reason: "Tomorrow has a short study window.",
        updatedAt: new Date().toISOString(),
      },
    ];
    account.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.calendar.prototype.v1", JSON.stringify(envelope));
  });
}

async function storedAvailabilityOverrides(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.calendar.prototype.v1");
    if (!raw) return [];
    const envelope = JSON.parse(raw) as {
      accounts: Record<string, {
        availabilityOverrides: Array<{ dateKey: string; availableMinutes: number; reason: string }>;
      }>;
    };
    return Object.values(envelope.accounts).flatMap((account) => account.availabilityOverrides)
      .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  });
}
