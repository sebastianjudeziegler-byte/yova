import { readFileSync } from "node:fs";
import { expect, freezePlanClock, test, type Page } from "./helpers/frozen-clock";
import type { LearningPlan } from "../src/lib/domain";

/**
 * Brief 1.5 item 1, live and unmocked. Every learn-block and practice call
 * goes to the real model through the real slot route and composer; nothing
 * here fulfils /api/sessions/shape. Responses are only observed, to know which
 * choice is correct so a round can miss exactly one or two key points.
 *
 * The saved plan is app state, not model output: the no-model fallback plan
 * whose first ready session is a vocabulary learn block, so it routes to
 * Shape C without depending on live plan generation.
 */
test.skip(process.env.YOVA_RUN_LIVE_BASELINE_PRACTICE !== "1", "Live model run only: pnpm test:e2e:baseline:live.");

const { plans } = JSON.parse(readFileSync("e2e/fixtures/baseline-shape-c-plan.json", "utf8")) as { plans: LearningPlan[] };
const ONBOARDING = ["Evening", "10 to 15 minutes", "Very often", "Tell me exactly what to do", "A concrete example first", "Mapping out how the pieces connect", "I get the big picture but miss specifics", "I intend to begin but often delay", "Shorter sections with fewer steps at once", "I understand in class but forget during tests"];

type Question = { id: string; keyPointIds: string[]; prompt: string; choices: string[]; correctChoiceIndex: number };
type ShapeReply = { action: string; questions?: Question[] };
type ShapeRequest = { round?: number; roundKind?: string; repairTargets?: unknown[]; keyPoints?: Array<{ id: string }> };
type Reply = { status: number; body: ShapeReply | null; round?: number; request?: ShapeRequest };

function observeShapeReplies(page: Page) {
  const replies: Reply[] = [];
  page.on("response", async (response) => {
    if (!new URL(response.url()).pathname.endsWith("/api/sessions/shape")) return;
    const request = response.request().postDataJSON() as ShapeRequest | null;
    replies.push({ status: response.status(), body: await response.json().catch(() => null), round: request?.round, request: request ?? undefined });
  });
  return replies;
}

async function ruleIds(page: Page) {
  return (await page.locator("[data-shape]").getAttribute("data-rule-ids"))?.split(" ") ?? [];
}

for (const misses of [1, 2]) {
  test(`a ${misses}-point retry generates live and completes`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const replies = observeShapeReplies(page);

    await freezePlanClock(page, new Date(plans[0]!.createdAt));
    await openWithPlan(page);
    await page.getByRole("button", { name: /Start session/ }).first().click();
    const keepDates = page.getByRole("button", { name: "Start now, keep dates" });
    if (await keepDates.isVisible({ timeout: 1_500 }).catch(() => false)) await keepDates.click();
    await page.getByTestId("pre-session-card").getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.locator("[data-shape]")).toHaveAttribute("data-shape", "C", { timeout: 60_000 });

    await page.getByRole("button", { name: "Start the questions" }).click({ timeout: 120_000 });
    const learn = replies.find((reply) => reply.body?.action === "learn_block");
    expect(learn?.status, "live learn block").toBe(200);
    await expect(page.getByTestId("baseline-question")).toHaveAttribute("data-practice-round", "active_recall");
    expect(await ruleIds(page)).toEqual(expect.arrayContaining(["L4.practice.active_recall.default", "L4.practice.error_repair.after_missed_round"]));
    await page.screenshot({ path: testInfo.outputPath(`label-active-recall-${misses}.png`), fullPage: true });
    const missed = await answerRound(page, learn!.body!.questions!, misses);
    expect(new Set(missed).size).toBe(misses);
    await expect(page.getByRole("heading", { name: `${misses} ${misses === 1 ? "point" : "points"} still to pass.` })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`round1-end-${misses}.png`), fullPage: true });

    await page.getByRole("button", { name: "Start round 2" }).click();
    await expect(page.getByTestId("baseline-question")).toContainText(`ROUND 2 · QUESTION 1 OF ${misses}`, { timeout: 120_000 });
    const retry = replies.find((reply) => reply.body?.action === "practice" && reply.round === 2);
    expect(retry?.status, "live round-two practice").toBe(200);
    expect([...new Set(retry!.body!.questions!.flatMap((question) => question.keyPointIds))].sort()).toEqual([...missed].sort());
    await expect(page.getByTestId("baseline-question")).toHaveAttribute("data-practice-round", "error_repair");
    expect(retry!.request?.roundKind).toBe("error_repair");
    // One target per missed question; a missed two-point question is one target covering two points.
    expect(retry!.request?.repairTargets?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(retry!.request?.repairTargets?.length ?? 0).toBeLessThanOrEqual(misses);
    await page.screenshot({ path: testInfo.outputPath(`label-error-repair-${misses}.png`), fullPage: true });

    await answerRound(page, retry!.body!.questions!, 0);
    await expect(page.getByRole("heading", { name: "A full round passed clean." })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`round2-passed-${misses}.png`), fullPage: true });
    expect(replies.filter((reply) => reply.status >= 500), "no slot call failed").toEqual([]);
  });
}

/** The fixture plan with one practice session made ready and the rest of its state adjusted. */
function planWithReadyPractice(sequence: number, deadline: string | null) {
  const plan = structuredClone(plans[0]!);
  plan.deadline = deadline;
  plan.sessions = plan.sessions.map((session) => ({ ...session, status: session.sequence === sequence ? "ready" : session.sequence < sequence ? "complete" : "upcoming" }));
  return plan;
}

function cleanPass(plan: LearningPlan, topicId: string, concepts: string[]) {
  const session = plan.sessions.find((candidate) => candidate.topicIds?.includes(topicId))!;
  return {
    id: crypto.randomUUID(), planId: plan.id, planSessionId: session.id,
    startedAt: new Date(Date.parse(plan.createdAt) - 40 * 60_000).toISOString(), completedAt: new Date(Date.parse(plan.createdAt) - 20 * 60_000).toISOString(),
    plannedMinutes: 20, actualMinutes: 20, correctAnswers: concepts.length, totalAnswers: concepts.length, feedback: null, observedGap: "", completionMode: "guided",
    conceptEvidence: concepts.map((concept) => ({ topicId, concept, outcome: "secure", activityType: "multiple_choice" })), confidenceEvidence: [],
  };
}

async function startReadyPractice(page: Page) {
  await page.getByRole("button", { name: /Start session/ }).first().click();
  const keepDates = page.getByRole("button", { name: "Start now, keep dates" });
  if (await keepDates.isVisible({ timeout: 1_500 }).catch(() => false)) await keepDates.click();
  await page.getByTestId("pre-session-card").getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator("[data-shape]")).toHaveAttribute("data-shape", "C", { timeout: 60_000 });
}

// Brief 1.5 item 3: one live sample of each opening practice label, with its rule ID.
test("a practice block within three days of the deadline runs a live Practice Test", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const replies = observeShapeReplies(page);
  const plan = planWithReadyPractice(5, new Date(Date.parse(plans[0]!.createdAt) + 2 * 24 * 60 * 60_000).toISOString());
  await freezePlanClock(page, new Date(plan.createdAt));
  await openWithPlan(page, [plan]);
  await startReadyPractice(page);
  expect(await ruleIds(page)).toContain("L4.practice.practice_test.deadline_within_3_days");
  await expect(page.getByTestId("baseline-question")).toHaveAttribute("data-practice-round", "practice_test", { timeout: 120_000 });
  await expect(page.getByText("Method: Practice Test")).toBeVisible();
  const practice = replies.find((reply) => reply.body?.action === "practice");
  expect(practice?.status).toBe(200);
  expect(practice!.request?.roundKind).toBe("practice_test");
  // A Practice Test plans eight questions; a question the independent review
  // still rejects is dropped rather than failing the whole round, so the
  // learner's counter must match what this round actually delivered.
  const delivered = practice!.body!.questions!.length;
  expect(delivered).toBeGreaterThanOrEqual(6);
  expect(delivered).toBeLessThanOrEqual(8);
  await expect(page.getByTestId("baseline-question")).toContainText(`QUESTION 1 OF ${delivered}`);
  await page.screenshot({ path: testInfo.outputPath("label-practice-test.png"), fullPage: true });
  await answerRound(page, practice!.body!.questions!, 0);
  await expect(page.getByRole("heading", { name: "A full round passed clean." })).toBeVisible();
});

test("a practice block whose related topics each passed once runs a live Interleaved Review", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const replies = observeShapeReplies(page);
  const plan = planWithReadyPractice(6, null);
  const [vocabulary, gaps] = [plan.knowledgeMap!.topics[0]!, plan.knowledgeMap!.topics[1]!];
  const completions = [
    cleanPass(plan, vocabulary.id, ["Photosynthesis stores light energy in glucose.", "Cellular respiration releases energy stored in glucose."]),
    cleanPass(plan, gaps.id, ["Chloroplasts are where photosynthesis takes place.", "Mitochondria are where most ATP is made."]),
  ];
  await freezePlanClock(page, new Date(plan.createdAt));
  await openWithPlan(page, [plan], completions);
  await startReadyPractice(page);
  expect(await ruleIds(page)).toContain("L4.practice.interleaved_review.related_topics_passed");
  await expect(page.getByTestId("baseline-question")).toHaveAttribute("data-practice-round", "interleaved_review", { timeout: 120_000 });
  await expect(page.getByText("Method: Interleaved Review")).toBeVisible();
  const practice = replies.find((reply) => reply.body?.action === "practice");
  expect(practice?.status).toBe(200);
  expect(practice!.request?.roundKind).toBe("interleaved_review");
  const swept = new Set((practice!.request?.keyPoints ?? []).map((keyPoint) => keyPoint.id.slice(0, 2)));
  expect([...swept].sort(), "key points swept from both passed topics").toEqual(["t1", "t2"]);
  await page.screenshot({ path: testInfo.outputPath("label-interleaved-review.png"), fullPage: true });
  await answerRound(page, practice!.body!.questions!, 0);
  await expect(page.getByRole("heading", { name: "A full round passed clean." })).toBeVisible();
});

async function openWithPlan(page: Page, saved: LearningPlan[] = plans, completions: unknown[] = []) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill("baseline-live-retry@example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();
  for (const [index, answer] of ONBOARDING.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", { name: index === ONBOARDING.length - 1 ? "Build my setup" : "Continue" }).click();
  }
  await page.getByRole("button", { name: "Open YOVA" }).click();
  await page.evaluate(({ saved, completions }) => {
    const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1") ?? "{}");
    localStorage.setItem("yova.preview.v1", JSON.stringify({ ...snapshot, plans: saved, sessionCompletions: [...(snapshot.sessionCompletions ?? []), ...completions] }));
  }, { saved, completions });
  await page.reload();
}

/** Answers the shown round from the observed live questions; misses questions until `misses` distinct key points are missed. Returns the missed key point ids. */
async function answerRound(page: Page, questions: Question[], misses: number) {
  const missed: string[] = [];
  const card = page.getByTestId("baseline-question");
  for (let index = 0; index < questions.length; index += 1) {
    const prompt = (await card.getByRole("heading", { level: 2 }).innerText()).trim();
    const question = questions.find((item) => item.prompt.trim() === prompt);
    expect(question, `shown question came from the live reply: ${prompt}`).toBeTruthy();
    // A two-point question misses both of its points, so only miss one that keeps the total within `misses`.
    const unseen = question!.keyPointIds.filter((id) => !missed.includes(id));
    const miss = unseen.length > 0 && missed.length + unseen.length <= misses;
    const choice = miss ? (question!.correctChoiceIndex + 1) % question!.choices.length : question!.correctChoiceIndex;
    if (miss) missed.push(...unseen);
    await card.getByRole("group", { name: "Answer choices" }).getByRole("button").nth(choice).click();
    await expect(page.getByTestId("baseline-reveal")).toHaveAttribute("data-correct", String(!miss));
    await page.getByRole("button", { name: /^(Next question|Finish round)/ }).click();
  }
  return missed;
}
