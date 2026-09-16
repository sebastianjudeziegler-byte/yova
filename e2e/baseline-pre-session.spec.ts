import { readFileSync } from "node:fs";
import { expect, freezePlanClock, test, type Page, type Route } from "./helpers/frozen-clock";
import type { LearningPlan } from "../src/lib/domain";

/**
 * Brief 1.5 item 8: Start opens one pre-session card, then the hub. The four
 * AI slots are mocked at the network boundary (as in baseline-session.spec.ts);
 * the card, routing, plan revisions and resume are the product's own code.
 */
const { plans } = JSON.parse(readFileSync("e2e/fixtures/baseline-shape-c-plan.json", "utf8")) as { plans: LearningPlan[] };
const ONBOARDING = ["Evening", "10 to 15 minutes", "Very often", "Tell me exactly what to do", "A concrete example first", "Mapping out how the pieces connect", "I get the big picture but miss specifics", "I intend to begin but often delay", "Shorter sections with fewer steps at once", "I understand in class but forget during tests"];
const MATERIAL_ID = "9e1f3c2a-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const KEY_POINTS = [
  { id: "k1", text: "Photosynthesis stores light energy as chemical energy in glucose." },
  { id: "k2", text: "Cellular respiration releases that energy as ATP." },
  { id: "k3", text: "The two processes cycle carbon dioxide, water and oxygen." },
];
const question = (id: string, keyPointId: string, prompt: string) => ({ id, slotId: id, keyPointIds: [keyPointId], kind: "recall", prompt, choices: ["Glucose", "Oxygen", "Nitrogen", "Starch"], correctChoiceIndex: 0, explanation: "Glucose stores the captured energy." });

type TipRequestEntry = { step: string; reasons: Array<{ ruleId: string; sentence: string }> };
const tipsFollowing = (requested: TipRequestEntry[] = []) => requested.map(({ step, reasons }) => ({ step, title: `Hub tip for the ${step} step.`, body: reasons[0]!.sentence, ruleId: reasons[0]!.ruleId, origin: "generated" }));

async function mockShapeSlots(page: Page, calls: string[]) {
  await page.route("**/api/sessions/shape", async (route: Route) => {
    const body = route.request().postDataJSON() as { action: string; purpose?: string; tips?: TipRequestEntry[] };
    calls.push(body.purpose === "study_outside" ? "direction:outside" : body.action);
    const json = body.action === "learn_block"
      ? { action: "learn_block", explanation: "Photosynthesis captures light energy and stores it in glucose; cellular respiration releases that stored energy as ATP. ".repeat(3), keyPoints: KEY_POINTS, questions: [question("q1", "k1", "Where is captured light energy stored?"), question("q2", "k2", "What does respiration release energy as? Glucose is the fuel."), question("q3", "k3", "Which molecule do the two processes exchange with glucose?")], structure: ["Light is captured", "Glucose stores it"], example: { title: "A leaf at noon", steps: ["Light reaches the chloroplast.", "Glucose is built from carbon dioxide."] } }
      : body.action === "practice"
        ? { action: "practice", keyPoints: KEY_POINTS, questions: [question("p1", "k1", "Round one: where is light energy stored?"), question("p2", "k2", "Round one: what does respiration release?"), question("p3", "k3", "Round one: what is exchanged?")] }
        : { action: "direction", whatToLookAt: body.purpose === "study_outside" ? "Find the part of your textbook or notes that covers photosynthesis and cellular respiration." : "Review Glycolysis notes.txt on photosynthesis.", howToApproach: "Read for how it works, not for the terms; you'll answer closed-book questions on it next, not explain it back.", origin: "generated", example: null };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...json, tips: tipsFollowing(body.tips) }) });
  });
}

function planWith(change: (plan: LearningPlan) => LearningPlan) {
  return plans.map((plan, index) => (index === 0 ? change(structuredClone(plan)) : plan));
}

const sourced = planWith((plan) => {
  plan.materials = [{ id: MATERIAL_ID, name: "Glycolysis notes.txt", mimeType: "text/plain", sizeBytes: 120, textContent: "Photosynthesis stores light energy in glucose. Respiration releases it as ATP.", processingStatus: "ready" }];
  plan.knowledgeMap!.topics[0]!.attachedSources = [{ material_id: MATERIAL_ID }];
  return plan;
});

const covered = planWith((plan) => {
  plan.knowledgeMap!.topics[0]!.initialEvidence = { source: "learner_report", outcome: "covered_elsewhere", checked: false } as never;
  return plan;
});

async function openWithPlan(page: Page, saved: LearningPlan[]) {
  await freezePlanClock(page, new Date(plans[0]!.createdAt));
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill("baseline-pre-session@example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();
  for (const [index, answer] of ONBOARDING.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", { name: index === ONBOARDING.length - 1 ? "Build my setup" : "Continue" }).click();
  }
  await page.getByRole("button", { name: "Open YOVA" }).click();
  await page.evaluate((plansToSave) => {
    const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1") ?? "{}");
    localStorage.setItem("yova.preview.v1", JSON.stringify({ ...snapshot, plans: plansToSave }));
  }, saved);
  await page.reload();
}

async function pressStart(page: Page) {
  await page.getByRole("button", { name: /Start session|Continue session/ }).first().click();
  const keepDates = page.getByRole("button", { name: "Start now, keep dates" });
  if (await keepDates.isVisible({ timeout: 1_500 }).catch(() => false)) await keepDates.click();
}

test("an unsourced block: Start, the pre-session card, then the hub", async ({ page }) => {
  const calls: string[] = [];
  await mockShapeSlots(page, calls);
  await openWithPlan(page, plans);
  await pressStart(page);
  const card = page.getByTestId("pre-session-card");
  await expect(card).toContainText("The core vocabulary and relationships in Photosynthesis and cellular respiration");
  await expect(card).toContainText("Learn block · 25 min");
  await expect(card.getByLabel("Source")).toContainText("YOVA will teach this");
  await expect(card.getByRole("switch", { name: "I've already covered this" })).toHaveAttribute("aria-checked", "false");
  await expect(card.getByRole("radio", { name: "Study inside YOVA" })).toHaveAttribute("aria-checked", "true");
  // Nothing else: no "has anything changed", no pace note, and nothing generated yet.
  await expect(page.getByText(/Has anything changed|Set the pace/)).toHaveCount(0);
  expect(calls).toEqual([]);
  await card.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator("[data-shape]")).toBeVisible();
  await expect(page.getByTestId("pre-session-card")).toHaveCount(0);
  await expect(page.getByText(/Photosynthesis captures light energy/).first()).toBeVisible();
  expect([...new Set(calls)]).toEqual(["learn_block"]);
});

test("a sourced block names its material on the card and studies from it", async ({ page }) => {
  const calls: string[] = [];
  await mockShapeSlots(page, calls);
  await openWithPlan(page, sourced);
  await pressStart(page);
  const card = page.getByTestId("pre-session-card");
  await expect(card.getByLabel("Source")).toContainText("Review Glycolysis notes.txt");
  await card.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator("[data-shape]")).toBeVisible();
  await expect(page.getByText("Review Glycolysis notes.txt on photosynthesis.")).toBeVisible();
  expect([...new Set(calls)]).toEqual(["direction"]);
});

test("a covered block is practice: the card says so and the hub opens on questions", async ({ page }) => {
  const calls: string[] = [];
  await mockShapeSlots(page, calls);
  await openWithPlan(page, covered);
  await pressStart(page);
  const card = page.getByTestId("pre-session-card");
  await expect(card).toContainText("Practice block · 25 min");
  await expect(card.getByRole("switch", { name: "I've already covered this" })).toHaveAttribute("aria-checked", "true");
  await expect(card.getByRole("radiogroup", { name: "Where will you study?" })).toHaveCount(0);
  await card.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("baseline-question")).toContainText("Round one: where is light energy stored?");
  expect([...new Set(calls)]).toEqual(["practice"]);
});

test("I've already covered this is the plan's mark_covered, with a receipt and undo", async ({ page }) => {
  await mockShapeSlots(page, []);
  await openWithPlan(page, plans);
  await pressStart(page);
  const card = page.getByTestId("pre-session-card");
  await card.getByRole("switch", { name: "I've already covered this" }).click();
  await card.getByRole("button", { name: /Confirm changes/ }).click({ timeout: 30_000 });
  const receipt = card.locator(".plan-revision-receipt");
  await expect(receipt.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(card).toContainText("Practice block");
  await expect(card.getByRole("switch", { name: "I've already covered this" })).toHaveAttribute("aria-checked", "true");
  await receipt.getByRole("button", { name: "Undo" }).click();
  await expect(card).toContainText("Learn block");
});

test("outside YOVA: directions, I'm back, then straight to practice with no produce step or explanation", async ({ page }) => {
  const calls: string[] = [];
  await mockShapeSlots(page, calls);
  await openWithPlan(page, plans);
  await pressStart(page);
  const card = page.getByTestId("pre-session-card");
  await card.getByRole("radio", { name: "Study outside YOVA" }).click();
  await expect(card.getByLabel("Method")).toContainText("Active Recall");
  await expect(card.getByLabel("Source")).toContainText("your own textbook or notes");
  await card.getByRole("button", { name: "Start", exact: true }).click();
  const directions = page.getByTestId("outside-directions");
  await expect(directions).toContainText("WHAT TO STUDY");
  await expect(directions).toContainText("Find the part of your textbook or notes that covers photosynthesis");
  await expect(directions).toContainText("HOW TO APPROACH IT");
  await expect(directions).toContainText("SUGGESTED TIME");
  expect((await page.locator("[data-shape]").getAttribute("data-rule-ids"))?.split(" ")).toContain("L5.learner_study_outside");
  await directions.getByRole("button", { name: "I'm back" }).click();
  await expect(page.getByTestId("baseline-question")).toContainText("Round one: where is light energy stored?");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect([...new Set(calls)]).toEqual(["direction:outside", "practice"]);
});

test("Study Now is two screens, then the hub", async ({ page }) => {
  const calls: string[] = [];
  await mockShapeSlots(page, calls);
  await openWithPlan(page, []);
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What do you want to study?" })).toBeVisible();
  await page.getByLabel("Study Now topic or result").fill("Explain how photosynthesis converts light energy into chemical energy inside a leaf.");
  await expect(page.getByRole("radio", { name: "Inside YOVA" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const card = page.getByTestId("pre-session-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator("[data-shape]")).toBeVisible();
});

test("returning mid-session lands on the same step, with no setup", async ({ page }) => {
  const calls: string[] = [];
  await mockShapeSlots(page, calls);
  await openWithPlan(page, plans);
  await pressStart(page);
  await page.getByTestId("pre-session-card").getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Start the questions" }).click();
  await page.getByRole("button", { name: "Glucose" }).click();
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByTestId("baseline-question")).toContainText("ROUND 1 · QUESTION 2 OF 3");
  await page.getByRole("button", { name: "Exit session" }).click();
  await expect(page.locator("[data-shape]")).toHaveCount(0);
  await page.reload();
  await pressStart(page);
  await expect(page.getByTestId("baseline-question")).toContainText("ROUND 1 · QUESTION 2 OF 3");
  await expect(page.getByTestId("pre-session-card")).toHaveCount(0);
  expect(calls.filter((call) => call === "learn_block").length).toBeLessThanOrEqual(2);
});

// Founder decision (16 Sept): the allowance is enforced on the pre-session card.
test("at the allowance limit the card shows the limit instead of Start, and a saved session still resumes", async ({ page }) => {
  const calls: string[] = [];
  await mockShapeSlots(page, calls);
  let exhausted = false;
  await page.route("**/api/sessions/allowance", async (route) => {
    const body = exhausted
      ? { status: "exhausted", remainingToday: 0, retryAfterSeconds: 7_200, resetAt: "2026-09-17T00:00:00.000Z" }
      : { status: "available", remainingToday: 3, retryAfterSeconds: 0, resetAt: null };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await openWithPlan(page, plans);
  // Below the limit: no allowance message and no count anywhere.
  await expect(page.getByText(/allowance|remaining today|sessions left/i)).toHaveCount(0);
  await pressStart(page);
  await expect(page.getByTestId("pre-session-card").getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await expect(page.getByTestId("allowance-limit")).toHaveCount(0);
  await page.getByTestId("pre-session-card").getByRole("button", { name: "Close" }).click();

  exhausted = true;
  await page.reload();
  // Home no longer blocks or explains; the card does.
  await expect(page.getByRole("button", { name: /Start session/ }).first()).toBeEnabled();
  await expect(page.getByText(/allowance/i)).toHaveCount(0);
  await pressStart(page);
  const card = page.getByTestId("pre-session-card");
  await expect(card.getByTestId("allowance-limit")).toContainText("You have used today's guided sessions.");
  await expect(card.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
  expect(calls).toEqual([]);
  await card.getByRole("button", { name: "Close" }).click();

  // A session started before the limit continues without the card.
  exhausted = false;
  await page.reload();
  await pressStart(page);
  await page.getByTestId("pre-session-card").getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Start the questions" }).click();
  await expect(page.getByTestId("baseline-question")).toContainText("ROUND 1 · QUESTION 1 OF 3");
  await page.getByRole("button", { name: "Exit session" }).click();
  exhausted = true;
  await page.reload();
  await pressStart(page);
  await expect(page.getByTestId("baseline-question")).toContainText("ROUND 1 · QUESTION 1 OF 3");
});

// Founder decision (16 Sept): scheduled reviews stay functional; they run as practice through the card.
test("a scheduled review opens the card as a practice block and runs closed-book practice", async ({ page }) => {
  const calls: string[] = [];
  await mockShapeSlots(page, calls);
  const withReview = planWith((plan) => {
    const first = plan.sessions[0]!;
    first.status = "complete";
    plan.sessions.push({ ...first, id: "7b3a2c1d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", sequence: plan.sessions.length + 1, status: "ready", learningMode: "study", title: "Verify the core vocabulary", estimatedMinutes: 5, reviewType: "verify", reviewConcept: "Photosynthesis stores light energy in glucose", studyRoute: undefined } as LearningPlan["sessions"][number]);
    return plan;
  });
  await openWithPlan(page, withReview);
  await pressStart(page);
  const card = page.getByTestId("pre-session-card");
  await expect(card).toContainText("Practice block · 5 min");
  await card.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("baseline-question")).toContainText("Round one: where is light energy stored?");
  expect([...new Set(calls)]).toEqual(["practice"]);
});

