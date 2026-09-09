import { expect, test, freezePlanClock, type Page } from "./helpers/frozen-clock";
import type { LearningPlan, SessionResource } from "../src/lib/domain";
import type { PlanKnowledgeMap } from "../src/lib/knowledge-map/schema";

test.use({ video: "on" });
const NOW = new Date("2026-09-07T08:00:00.000Z");
const id = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WATER = id(2);
const CARBON = id(4);
const VIDEO = "https://www.youtube.com/watch?v=example-ap-biology";
const map: PlanKnowledgeMap = {
  version: 1,
  scopeJudgment: { band: "unit_or_exam", label: "AP Biology foundations", minimumSessions: 8, recommendedSessions: 8, maximumSessions: 8, minimumTeachingSessions: 4, explanation: "Build each foundation separately, then check it in independent practice." },
  topics: [
    ["Orientation: ATP and cellular energy", "Explain why ATP hydrolysis can provide energy for cellular work."],
    ["1.1 Water polarity", "Explain water's partial charges and how they cause hydrogen bonding."],
    ["1.2 Hydrogen bonding", "Connect hydrogen bonds to cohesion and water's thermal properties."],
    ["1.3 Carbon and functional groups", "Explain how carbon bonding and functional groups shape biological molecules."],
  ].map(([title, description], index) => ({ id: id(index + 1), title: title!, description: description!, subtopics: [], prerequisiteTopicIds: index === 2 ? [WATER] : [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null })),
  placementCheck: { status: "available", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
};

async function snapshot(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("yova.preview.v1")!).plans.at(-1) as LearningPlan);
}

async function createAndActivate(page: Page) {
  await freezePlanClock(page, NOW);
  // The accepted topic map is the deterministic fixture. Creation, fixed-slot
  // fill, activation and revision still use their real application routes.
  await page.route("**/api/plans/generate?mode=diagnostic", async route => {
    const response = await route.fetch({ postData: JSON.stringify({ ...route.request().postDataJSON(), knowledgeMap: map }) });
    await route.fulfill({ response });
  });
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill("living-plan@example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();
  const answers = ["Show a short recommendation and alternatives", "I delay a little, then get going", "20 to 30 minutes", "A concrete example before the rule", "Recalling it without notes, then checking", "I recognize it but cannot recall it", "Give me a small hint", "Show one step at a time", "Clear checkpoints inside the block", "No extra support right now", "Afternoon"];
  for (const [index, answer] of answers.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", { name: index === answers.length - 1 ? "Build my setup" : "Continue", exact: true }).click();
  }
  await page.getByRole("button", { name: "Open YOVA" }).click();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.locator(".calendar-page-header").getByRole("button", { name: "Add to YOVA", exact: true }).click();
  await page.getByRole("textbox", { name: "Describe what you want to add" }).fill("Create an AP Biology plan from scratch for my exam in three weeks: ATP and cellular energy, water polarity, hydrogen bonding, carbon and functional groups. I have no materials.");
  await page.getByRole("button", { name: "Organize this" }).click();
  await page.getByRole("button", { name: "Choose what YOVA should do" }).click();
  await page.getByRole("button", { name: /Create a plan/ }).click();
  await page.getByRole("button", { name: "25 minutes", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByText("Plan ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan", exact: true })).toBeVisible();
}

async function completeFirstSession(page: Page) {
  const before = await snapshot(page);
  await page.getByRole("button", { name: "Start next session", exact: true }).click();
  const early = page.getByRole("button", { name: "Start now, keep dates" });
  if (await early.isVisible()) await early.click();
  await expect(page.locator(".session-setup-shell, .session-shell")).toBeVisible({ timeout: 30_000 });
  if (await page.locator(".session-setup-shell").isVisible()) {
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Prepare this session" }).click();
  }
  for (let step = 0; step < 20; step += 1) {
    if (await page.getByText("SESSION COMPLETE", { exact: true }).isVisible()) break;
    const title = await page.locator(".session-activity-header h1").innerText({ timeout: 30_000 });
    const resource = (await snapshot(page)).sessions[0]!.resource as SessionResource;
    const question = resource.activities.find(item => item.title === title && (item.type === "free_response" || item.type === "multiple_choice"));
    const confidence = page.getByRole("button", { name: "Somewhat sure", exact: true });
    if (await confidence.isVisible() && await confidence.isEnabled()) await confidence.click();
    const answer = page.locator(".recall-response textarea");
    if (await answer.isVisible() && await answer.isEnabled()) {
      expect(question?.correctAnswer, "The visible recall must have a matching fixture answer").toBeTruthy();
      await answer.fill(question!.correctAnswer!);
      await page.getByRole("button", { name: "Check my answer", exact: true }).click();
      const rating = page.getByRole("button", { name: "I got the key idea", exact: true });
      const unscored = page.getByText("YOVA did not record a correct or incorrect result from this check. Continue after comparing with the model answer.", { exact: true });
      await expect(rating.or(unscored)).toBeVisible({ timeout: 30_000 });
      if (await rating.isVisible()) await rating.click();
    } else if (question?.correctAnswer && await page.locator(".answer-grid").isVisible()) {
      await page.locator(".answer-grid").getByRole("button", { name: question.correctAnswer, exact: true }).click();
    }
    const next = page.locator(".session-action-bar").getByRole("button");
    await expect(next).toBeEnabled({ timeout: 30_000 });
    await next.click();
  }
  await expect(page.getByText("SESSION COMPLETE", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish and continue", exact: true }).click();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.locator(".learning-goal-card").filter({ hasText: before.title }).getByRole("button", { name: "Open goal", exact: true }).click();
  expect((await snapshot(page)).sessions[0]!.status).toBe("complete");
}

test("active topics offer learned-elsewhere and source actions without a verification quiz", async ({ page }) => {
  await createAndActivate(page);
  const water = page.locator(".knowledge-topic-list li").filter({ hasText: "1.1 Water polarity" });
  await expect(water.getByRole("button", { name: "I already learned this", exact: true })).toBeVisible();
  await expect(water.getByRole("button", { name: "Attach a source", exact: true })).toBeVisible();
});

test("founder journey preserves completed work, previews two topic changes, saves a receipt and undoes the revision", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await createAndActivate(page);
  await completeFirstSession(page);
  const before = await snapshot(page);
  const waterBefore = before.sessions.find(session => session.topicIds?.includes(WATER))!;
  expect(waterBefore.learningMode).toBe("learn");
  await page.screenshot({ path: testInfo.outputPath("01-before.png"), fullPage: true });

  await page.locator(".knowledge-topic-list li").filter({ hasText: "1.1 Water polarity" }).getByRole("button", { name: "I already learned this", exact: true }).click();
  await expect(page.getByRole("region", { name: "Plan change preview" })).toBeVisible();
  await page.getByRole("button", { name: "Add another change", exact: true }).click();
  await page.getByLabel("Change topic").selectOption(CARBON);
  await page.getByLabel("Change type").selectOption("attach_source");
  await page.getByLabel("Source URL").fill(VIDEO);
  await page.getByRole("button", { name: "Preview source attachment", exact: true }).click();
  const preview = page.getByRole("region", { name: "Plan change preview" });
  await expect(preview).toContainText("1.1 Water polarity");
  await expect(preview).toContainText("Practice");
  await expect(preview).toContainText("1.3 Carbon and functional groups");
  await expect(preview.getByRole("checkbox", { name: /Include/ })).toHaveCount(2);
  await expect(preview.getByRole("combobox", { name: /Target topic/ }).first()).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath("02-preview.png"), fullPage: true });
  await preview.getByRole("button", { name: "Confirm changes", exact: true }).click();

  const receipt = page.getByRole("status").filter({ hasText: "everything else unchanged" });
  await expect(receipt).toContainText(/water polarity/i);
  await expect(receipt).toContainText(/carbon and functional groups/i);
  const after = await snapshot(page);
  expect(after.sessions.find(session => session.id === waterBefore.id)!.learningMode).toBe("study");
  const waterAfter = after.sessions.find(session => session.id === waterBefore.id)!;
  await expect(page.locator(".timeline-row").filter({ hasText: waterAfter.title })).toContainText("Practice first");
  await expect(page.getByRole("link", { name: VIDEO, exact: true })).toHaveAttribute("href", VIDEO);
  for (const session of before.sessions.filter(item => item.status === "complete" || !item.topicIds?.some(topicId => [WATER, CARBON].includes(topicId)))) {
    expect(after.sessions.find(item => item.id === session.id)).toEqual(session);
  }
  await page.screenshot({ path: testInfo.outputPath("03-saved.png"), fullPage: true });
  await receipt.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /previous revision restored/i })).toBeVisible();
  const restored = await snapshot(page);
  for (const prior of before.sessions) {
    const current = restored.sessions.find(session => session.id === prior.id)!;
    if (prior.status === "complete") expect(current).toEqual(prior);
    else {
      // Undo restores the previous plan revision and its learner-visible
      // contract. Route successors retain the immutable execution history.
      expect({ ...current, studyRoute: prior.studyRoute }).toEqual(prior);
      expect(current.studyRoute!.execution).toEqual(prior.studyRoute!.execution);
      expect(current.studyRoute!.target).toEqual(prior.studyRoute!.target);
    }
  }
  expect(restored).toHaveProperty("revisionId", (before as LearningPlan & { revisionId: string }).revisionId);
  expect(restored.knowledgeMap).toEqual(before.knowledgeMap);
  expect(restored.sessions[0]!.status).toBe("complete");
  await page.screenshot({ path: testInfo.outputPath("04-undone.png"), fullPage: true });
  await testInfo.attach("revision-before-after-undo", { body: JSON.stringify({ before, after, restored }, null, 2), contentType: "application/json" });
});

test("a failed revision save shows no success receipt and preserves the original plan for retry", async ({ page }) => {
  await createAndActivate(page);
  const before = await snapshot(page);
  let failApply = true;
  await page.route("**/api/plans/adjust", async route => {
    const body = route.request().postDataJSON();
    if (body.action === "apply" && failApply) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The plan change could not be saved. Your current plan is unchanged." }) });
    } else await route.continue();
  });
  await page.locator(".knowledge-topic-list li").filter({ hasText: "1.1 Water polarity" }).getByRole("button", { name: "I already learned this", exact: true }).click();
  const preview = page.getByRole("region", { name: "Plan change preview" });
  await preview.getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(preview.getByRole("alert")).toContainText("could not be saved");
  await expect(page.getByRole("status").filter({ hasText: "everything else unchanged" })).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  failApply = false;
  await preview.getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "everything else unchanged" })).toBeVisible();
  const after = await snapshot(page);
  expect(after.id).toBe(before.id);
  expect(after.sessions).toHaveLength(before.sessions.length);
  expect(after.sessions.find(session => session.topicIds?.includes(WATER))!.learningMode).toBe("study");
});
