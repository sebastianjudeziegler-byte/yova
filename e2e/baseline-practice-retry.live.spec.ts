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

for (const misses of [1, 2]) {
  test(`a ${misses}-point retry generates live and completes`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const replies: Array<{ status: number; body: ShapeReply | null; round?: number }> = [];
    page.on("response", async (response) => {
      if (!new URL(response.url()).pathname.endsWith("/api/sessions/shape")) return;
      const request = response.request().postDataJSON() as { round?: number } | null;
      replies.push({ status: response.status(), body: await response.json().catch(() => null), round: request?.round });
    });

    await freezePlanClock(page, new Date(plans[0]!.createdAt));
    await openWithPlan(page);
    await page.getByRole("button", { name: /Start session/ }).first().click();
    const keepDates = page.getByRole("button", { name: "Start now, keep dates" });
    if (await keepDates.isVisible({ timeout: 1_500 }).catch(() => false)) await keepDates.click();
    await expect(page.locator("[data-shape]")).toHaveAttribute("data-shape", "C", { timeout: 60_000 });

    await page.getByRole("button", { name: "Start the questions" }).click({ timeout: 120_000 });
    const learn = replies.find((reply) => reply.body?.action === "learn_block");
    expect(learn?.status, "live learn block").toBe(200);
    const missed = await answerRound(page, learn!.body!.questions!, misses);
    expect(new Set(missed).size).toBe(misses);
    await expect(page.getByRole("heading", { name: `${misses} ${misses === 1 ? "point" : "points"} still to pass.` })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`round1-end-${misses}.png`), fullPage: true });

    await page.getByRole("button", { name: "Start round 2" }).click();
    await expect(page.getByTestId("baseline-question")).toContainText(`ROUND 2 · QUESTION 1 OF ${misses}`, { timeout: 120_000 });
    const retry = replies.find((reply) => reply.body?.action === "practice" && reply.round === 2);
    expect(retry?.status, "live round-two practice").toBe(200);
    expect([...new Set(retry!.body!.questions!.flatMap((question) => question.keyPointIds))].sort()).toEqual([...missed].sort());
    await page.screenshot({ path: testInfo.outputPath(`round2-question-${misses}.png`), fullPage: true });

    await answerRound(page, retry!.body!.questions!, 0);
    await expect(page.getByRole("heading", { name: "A full round passed clean." })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`round2-passed-${misses}.png`), fullPage: true });
    expect(replies.filter((reply) => reply.status >= 500), "no slot call failed").toEqual([]);
  });
}

async function openWithPlan(page: Page) {
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
  await page.evaluate((saved) => {
    const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1") ?? "{}");
    localStorage.setItem("yova.preview.v1", JSON.stringify({ ...snapshot, plans: saved }));
  }, plans);
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
