import { readFileSync } from "node:fs";
import { expect, freezePlanClock, test, type Page } from "./helpers/frozen-clock";
import type { LearningPlan } from "../src/lib/domain";

/**
 * Brief 1.5 item 8, live and unmocked: studying outside YOVA is a directions
 * card from the real Slot 1, then "I'm back", then real closed-book practice.
 * No produce step and no AI explanation may run. Requests are only observed.
 */
test.skip(process.env.YOVA_RUN_LIVE_BASELINE_PRACTICE !== "1", "Live model run only: pnpm test:e2e:baseline:live.");

const { plans } = JSON.parse(readFileSync("e2e/fixtures/baseline-shape-c-plan.json", "utf8")) as { plans: LearningPlan[] };
const ONBOARDING = ["Evening", "10 to 15 minutes", "Very often", "Tell me exactly what to do", "A concrete example first", "Mapping out how the pieces connect", "I get the big picture but miss specifics", "I intend to begin but often delay", "Shorter sections with fewer steps at once", "I understand in class but forget during tests"];

type Question = { prompt: string; correctChoiceIndex: number };
type Observed = { action: string; purpose?: string; status: number; questions?: Question[] };

test("outside YOVA: live directions, I'm back, then live practice, with no produce step or explanation", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const observed: Observed[] = [];
  page.on("response", async (response) => {
    if (!new URL(response.url()).pathname.endsWith("/api/sessions/shape")) return;
    const request = response.request().postDataJSON() as { action: string; purpose?: string };
    const body = await response.json().catch(() => null) as { questions?: Question[] } | null;
    observed.push({ action: request.action, purpose: request.purpose, status: response.status(), questions: body?.questions });
  });

  await freezePlanClock(page, new Date(plans[0]!.createdAt));
  await openWithPlan(page);
  await page.getByRole("button", { name: /Start session/ }).first().click();
  const keepDates = page.getByRole("button", { name: "Start now, keep dates" });
  if (await keepDates.isVisible({ timeout: 1_500 }).catch(() => false)) await keepDates.click();

  const card = page.getByTestId("pre-session-card");
  await card.getByRole("radio", { name: "Study outside YOVA" }).click();
  await page.screenshot({ path: testInfo.outputPath("outside-1-card.png"), fullPage: true });
  await card.getByRole("button", { name: "Start", exact: true }).click();

  const directions = page.getByTestId("outside-directions");
  await expect(directions.getByRole("button", { name: "I'm back" })).toBeVisible({ timeout: 120_000 });
  await expect(directions).toContainText("WHAT TO STUDY");
  await expect(directions).toContainText("HOW TO APPROACH IT");
  await expect(directions).toContainText("SUGGESTED TIME");
  await page.screenshot({ path: testInfo.outputPath("outside-2-directions.png"), fullPage: true });
  await directions.getByRole("button", { name: "I'm back" }).click();

  const questionCard = page.getByTestId("baseline-question");
  await expect(questionCard).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("outside-3-practice.png"), fullPage: true });
  expect(observed.find((entry) => entry.action === "practice" && entry.status === 200)?.questions?.length ?? 0).toBeGreaterThan(0);
  // A pass over eight questions arrives in parts; later parts are further
  // practice replies, so look each shown question up across all of them.
  const end = page.getByRole("heading", { name: "A full round passed clean." });
  for (;;) {
    await expect(questionCard.or(end)).toBeVisible({ timeout: 150_000 });
    if (!await questionCard.isVisible()) break;
    const prompt = (await questionCard.getByRole("heading", { level: 2 }).innerText()).trim();
    const question = observed.filter((entry) => entry.action === "practice" && entry.status === 200).flatMap((entry) => entry.questions ?? []).find((item) => item.prompt.trim() === prompt);
    expect(question, `shown question came from a live reply: ${prompt}`).toBeTruthy();
    await questionCard.getByRole("group", { name: "Answer choices" }).getByRole("button").nth(question!.correctChoiceIndex).click();
    await page.getByRole("button", { name: /^(Next question|Next part|Finish round)/ }).click();
  }
  await expect(end).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("outside-4-end.png"), fullPage: true });

  // The whole outside path: one directions call for studying outside, then practice. Nothing else ran.
  expect(observed.filter((entry) => entry.status === 200).map((entry) => (entry.purpose ? `${entry.action}:${entry.purpose}` : entry.action)).filter((value, index, all) => all.indexOf(value) === index)).toEqual(["direction:study_outside", "practice"]);
  expect(observed.some((entry) => entry.action === "learn_block" || entry.action === "compare")).toBe(false);
});

async function openWithPlan(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill("baseline-live-outside@example.com");
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
