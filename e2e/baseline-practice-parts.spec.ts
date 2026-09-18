import { readFileSync } from "node:fs";
import { expect, freezePlanClock, test, type Page, type Route } from "./helpers/frozen-clock";
import type { LearningPlan } from "../src/lib/domain";

/**
 * Founder decision (18 Sept 2026, option B): a long first pass is one sitting in
 * parts of at most eight. This proves the session's own wiring — the part
 * counter, the next part asked for while the learner is still answering, the
 * "Next part" hand-off, and that the round is judged only after its last part.
 *
 * Standing rule: the slot replies are stubbed at the network boundary, so this
 * is NOT a test of generation. Each stub has the shape the server really
 * returns for a part. Part planning is proven by practice-parts.test.ts and
 * shape-slot-generator.test.ts, and live by baseline-session-quality.live.spec.ts.
 */
const { plans } = JSON.parse(readFileSync("e2e/fixtures/baseline-shape-c-plan.json", "utf8")) as { plans: LearningPlan[] };
const ONBOARDING = ["Evening", "10 to 15 minutes", "Very often", "Tell me exactly what to do", "A concrete example first", "Mapping out how the pieces connect", "I get the big picture but miss specifics", "I intend to begin but often delay", "Shorter sections with fewer steps at once", "I understand in class but forget during tests"] as const;
const KEY_POINTS = [
  { id: "k1", text: "Photosynthesis stores light energy as chemical energy in glucose." },
  { id: "k2", text: "Cellular respiration releases that energy as ATP." },
  { id: "k3", text: "The two processes cycle carbon dioxide, water and oxygen." },
];
const question = (id: string, index: number) => ({ id, slotId: id, keyPointIds: [KEY_POINTS[index % 3]!.id], kind: "recall", prompt: `Question ${id}: which molecule stores the captured light energy?`, choices: ["Glucose", "Oxygen", "Nitrogen", "Starch"], correctChoiceIndex: 0, explanation: "Glucose stores the energy captured from light." });
const partOne = Array.from({ length: 8 }, (_, index) => question(`a${index + 1}`, index));
const partTwo = Array.from({ length: 8 }, (_, index) => question(`b${index + 1}`, index));

type ShapeBody = { action: string; round?: number; part?: { index: number; count: number }; priorPrompts?: string[]; keyPoints?: Array<{ id: string }>; tips?: Array<{ step: string; reasons: Array<{ ruleId: string; sentence: string }> }> };

async function stubParts(page: Page, requests: ShapeBody[]) {
  await page.route("**/api/sessions/shape", async (route: Route) => {
    const body = route.request().postDataJSON() as ShapeBody;
    requests.push(body);
    const tips = (body.tips ?? []).map(({ step, reasons }) => ({ step, title: `Hub tip for the ${step} step.`, body: reasons[0]!.sentence, ruleId: reasons[0]!.ruleId, origin: "generated" }));
    const json = body.action === "learn_block"
      ? { action: "learn_block", explanation: "Photosynthesis captures light energy and stores it in glucose; cellular respiration releases that stored energy as ATP. ".repeat(3), keyPoints: KEY_POINTS, questions: partOne, structure: ["Light is captured", "Glucose stores it"], example: { title: "A leaf at noon", steps: ["Light reaches the chloroplast.", "Glucose is built from carbon dioxide."] } }
      : body.action === "practice"
        ? { action: "practice", keyPoints: KEY_POINTS, questions: body.part?.index === 2 ? partTwo : partOne }
        : { action: "direction", whatToLookAt: "Review your notes on photosynthesis.", howToApproach: "Read for how it works.", origin: "generated", example: null };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...json, tips }) });
  });
}

/** The fixture's ready block, sized to a 16-question workload: two parts of eight. */
function sixteenQuestionPlan() {
  return plans.map((saved, planIndex) => {
    if (planIndex !== 0) return saved;
    const plan = structuredClone(saved);
    const session = plan.sessions.find((item) => item.status === "ready")!;
    const topic = plan.knowledgeMap!.topics.find((item) => session.topicIds?.includes(item.id))!;
    session.estimatedMinutes = 20;
    session.workload = { version: "topic_workload_v1", topicSubtopics: [{ topicId: topic.id, subtopics: topic.subtopics.slice(0, 12) }], questionCount: 16, recallQuestionCount: 16, transferQuestionCount: 0, produceSteps: 0, sourceReadMinutes: 0, estimatedMinutes: 20, ceilingMinutes: 25, practicePlaceholder: false, practiceRound: 0, suggestedDate: true, ruleIds: ["plan.workload.content_estimate"] } as LearningPlan["sessions"][number]["workload"];
    return plan;
  });
}

async function openWithPlan(page: Page, saved: LearningPlan[]) {
  await freezePlanClock(page, new Date(plans[0]!.createdAt));
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill("baseline-practice-parts@example.com");
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

async function answerPart(page: Page, count: number) {
  const card = page.getByTestId("baseline-question");
  for (let index = 0; index < count; index += 1) {
    await card.getByRole("group", { name: "Answer choices" }).getByRole("button").first().click();
    if (index < count - 1) await page.getByRole("button", { name: "Next question", exact: true }).click();
  }
}

test("a 16-question pass runs as two parts of eight, the second prepared while the first is answered", async ({ page }, testInfo) => {
  const requests: ShapeBody[] = [];
  await stubParts(page, requests);
  await openWithPlan(page, sixteenQuestionPlan());
  await page.getByRole("button", { name: /Start session/ }).first().click();
  const keepDates = page.getByRole("button", { name: "Start now, keep dates" });
  if (await keepDates.isVisible({ timeout: 1_500 }).catch(() => false)) await keepDates.click();
  await page.getByTestId("pre-session-card").getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Start the questions" }).click({ timeout: 60_000 });

  const card = page.getByTestId("baseline-question");
  await expect(card).toContainText("PART 1 OF 2 · QUESTION 1 OF 8");
  await page.screenshot({ path: testInfo.outputPath("part-1.png"), fullPage: true });

  await answerPart(page, 8);
  // Prepared ahead: the part-two request left before the learner finished part one.
  const partRequest = requests.find((request) => request.action === "practice" && request.part);
  expect(partRequest, "part two was asked for while part one was still open").toBeTruthy();
  expect(partRequest).toMatchObject({ round: 1, part: { index: 2, count: 2 } });
  expect(partRequest!.priorPrompts).toEqual(partOne.map((item) => item.prompt));
  expect(partRequest!.keyPoints!.map((point) => point.id)).toEqual(KEY_POINTS.map((point) => point.id));

  await page.getByRole("button", { name: "Next part", exact: true }).click();
  await expect(card).toContainText("PART 2 OF 2 · QUESTION 1 OF 8");
  await expect(card.getByRole("heading", { level: 2 })).toContainText("Question b1");
  await page.screenshot({ path: testInfo.outputPath("part-2.png"), fullPage: true });

  await answerPart(page, 8);
  await page.getByRole("button", { name: "Finish round", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A full round passed clean." })).toBeVisible();
  expect(requests.filter((request) => request.action === "practice" && request.part)).toHaveLength(1);
});
