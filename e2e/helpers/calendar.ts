import { expect, type Page } from "@playwright/test";

export const FIXED_NOW = new Date("2026-09-02T10:00:00.000Z");

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

async function createPreviewAccount(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
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

export async function storedManualEvents(page: Page) {
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


export async function seedCalendarAuthority(page: Page) {
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

export async function seedMovableCalendarState(page: Page) {
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



export async function openCalendar(page: Page, week = false) {
  await page.getByRole("button", {name: "Calendar", exact: true}).click();
  await expect(page.locator(".calendar-workspace")).toHaveAttribute("aria-busy", "false");
  if (week) await showWeek(page);
}
export async function openPreviewCalendar(page: Page) {
  await page.clock.setFixedTime(FIXED_NOW);
  await createPreviewAccount(page);
  await completeOnboarding(page);
  await openCalendar(page);
}
export async function closeDetail(page: Page) {
  const button = page.getByRole("button", {name:"Close calendar detail"});
  if (await button.isVisible()) await button.click();
}
export async function quickDraft(page: Page, phrase: string) {
  await closeDetail(page);
  const input = page.getByLabel("Quick add a calendar item");
  await input.fill(phrase);
  await input.press("Enter");
  const dialog = page.getByRole("dialog", {name:"Confirm quick add"});
  await expect(dialog).toBeVisible();
  return dialog;
}
export async function addManual(page: Page, title: string, time: string, duration = "30", type = "personal", due?: string) {
  const form = await quickDraft(page, `${title} tomorrow for 30 minutes`);
  await form.getByLabel("Title", {exact:true}).fill(title);
  await form.getByRole("combobox", {name:"Type"}).selectOption(type);
  await form.getByLabel("Calendar time", {exact:true}).fill(time);
  await form.getByLabel("Duration", {exact:true}).fill(duration);
  await form.getByLabel("Fixed time", {exact:true}).setChecked(type === "class" || type === "exam");
  if (due) await form.getByLabel("Due time", {exact:true}).fill(due);
  await form.getByRole("button", {name:"Save to calendar", exact:true}).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText(title);
}

export async function showWeek(page: Page) {
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator(".calendar-week")).toBeVisible();
}
