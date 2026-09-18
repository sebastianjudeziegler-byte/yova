import { expect, test, freezePlanClock, type Page } from "./helpers/frozen-clock";
import { activatePreviewPlan, openPlanSetupPreview } from "./helpers/plan-setup";
import type { LearningPlan } from "../src/lib/domain";
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
    ["Cellular respiration sequence", "Explain how glycolysis, the Krebs cycle and electron transport contribute to cellular respiration."],
    ["1.1 Water polarity", "Explain water's partial charges and how they cause hydrogen bonding."],
    ["1.2 Hydrogen bonding", "Connect hydrogen bonds to cohesion and water's thermal properties."],
    ["1.3 Carbon and functional groups", "Explain how carbon bonding and functional groups shape biological molecules."],
  ].map(([title, description], index) => ({ id: id(index + 1), title: title!, description: description!, subtopics: [], prerequisiteTopicIds: index === 2 ? [WATER] : [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null })),
  placementCheck: { status: "available", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
};

async function snapshot(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("yova.preview.v1")!).plans.at(-1) as LearningPlan);
}

async function createAndActivate(page: Page, activate = true) {
  await freezePlanClock(page, NOW);
  // The accepted topic map is the deterministic fixture. Creation, fixed-slot
  // fill, activation and revision still use their real application routes.
  await page.route("**/api/plans/generate?mode=understanding", async route => {
    const response = await route.fetch({ postData: JSON.stringify({ ...route.request().postDataJSON(), knowledgeMap: map }) });
    await route.fulfill({ response });
  });
  await openPlanSetupPreview(page, NOW);
  await page.getByPlaceholder(/I have a biology test/).fill("Teach me AP Biology foundations from scratch for my exam in three weeks: cellular respiration, water polarity, hydrogen bonding, carbon and functional groups. I can study Monday, Wednesday and Friday evenings for 60 minutes.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Skip corrections" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Skip placement and build plan" }).click();
  await expect(page.getByRole("region", { name: "Plan grouped by topic" })).toBeVisible({ timeout: 30_000 });
  if (!activate) return;
  await activatePreviewPlan(page);
}

async function topicActions(page: Page, topicId: string) {
  const topic = page.locator(`[data-topic-id="${topicId}"]`);
  if (await topic.locator("details").getAttribute("open") === null) await topic.locator("summary").click();
  return topic.getByRole("combobox", { name: /Topic actions/ });
}
async function reviewCoverageChange(page: Page, topicId: string) {
  // Open the reviewed-change composer, then choose coverage. The grouped
  // plan's inline Mark covered action intentionally applies immediately.
  await page.getByRole("button", { name: "Add material", exact: true }).click();
  const preview = page.getByRole("region", { name: "Plan change preview" });
  await preview.getByRole("combobox", { name: /^Change type\b/ }).selectOption("mark_covered");
  await preview.getByRole("combobox", { name: /^Change topic\b/ }).selectOption(topicId);
  await page.getByRole("button", { name: "Preview change", exact: true }).click();
}

/**
 * Brief 1.5 item 8: a block starts on the pre-session card and runs as a
 * baseline session. Its AI slots are mocked at the network boundary with
 * answers the loop below can complete; the revision journey is what this spec tests.
 */
async function mockShapeSlots(page: Page) {
  const keyPoints = [
    { id: "k1", text: "Glycolysis splits glucose into two pyruvate." },
    { id: "k2", text: "The Krebs cycle releases carbon dioxide and loads carriers." },
    { id: "k3", text: "The electron transport chain makes most of the ATP." },
  ];
  const question = (id: string, keyPointId: string, prompt: string) => ({ id, slotId: id, kind: "recall", keyPointIds: [keyPointId], prompt, choices: ["Correct choice", "Wrong choice one", "Wrong choice two", "Wrong choice three"], correctChoiceIndex: 0, explanation: "The first choice is what the explanation states." });
  const questions = [question("q1", "k1", "What does glycolysis produce?"), question("q2", "k2", "What does the Krebs cycle release?"), question("q3", "k3", "Where is most ATP made?")];
  await page.route("**/api/sessions/shape", async (route) => {
    const body = route.request().postDataJSON() as { action: string };
    const json = body.action === "learn_block"
      ? { action: "learn_block", explanation: "Cellular respiration releases energy from glucose in three stages: glycolysis, the Krebs cycle and the electron transport chain. ".repeat(3), keyPoints, questions, structure: ["Glycolysis", "Krebs cycle", "Electron transport"], example: { title: "A running muscle cell", steps: ["Glucose is split.", "ATP is made."] } }
      : body.action === "compare" ? { action: "compare", feedback: "You named the three stages; the carriers are still missing.", missing: ["Electron carriers"], incorrect: [] }
        : body.action === "practice" ? { action: "practice", keyPoints, questions }
          : { action: "direction", whatToLookAt: "Review your notes on cellular respiration.", howToApproach: "Read for how it works.", origin: "generated", example: null };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
  });
}

async function completeFirstSession(page: Page) {
  const before = await snapshot(page);
  await mockShapeSlots(page);
  await page.getByRole("button", { name: "Start next block", exact: true }).click();
  const early = page.getByRole("button", { name: "Start now, keep dates" });
  if (await early.isVisible()) await early.click();
  await page.getByTestId("pre-session-card").getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator("[data-shape]")).toBeVisible({ timeout: 30_000 });
  const clickIfVisible = async (name: string) => {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.isVisible() && await button.isEnabled()) { await button.click(); return true; }
    return false;
  };
  for (let step = 0; step < 40; step += 1) {
    if (await page.getByRole("heading", { name: "You studied, produced and compared." }).or(page.getByRole("heading", { name: "A full round passed clean." })).isVisible()) break;
    await page.waitForTimeout(200);
    const choice = page.getByTestId("baseline-question").getByRole("button", { name: "Correct choice" });
    if (await choice.isVisible() && await choice.isEnabled()) { await choice.click(); continue; }
    const produce = page.locator("textarea").first();
    if (await produce.isVisible() && await produce.isEnabled() && !(await produce.inputValue())) {
      await produce.fill("Glycolysis splits glucose, the Krebs cycle releases carbon dioxide, and electron transport makes ATP.");
      continue;
    }
    for (const name of ["I'm going to study it", "Continue", "Start the questions", "Compare with the source", "Save repair", "Move on", "Next question", "Finish round", "Start round 2"]) {
      if (await clickIfVisible(name)) break;
    }
  }
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.locator("[data-shape]")).toHaveCount(0);
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  const openGoal = page.locator(".learning-goal-card").filter({ hasText: before.title }).getByRole("button", { name: "Open goal", exact: true });
  if (await openGoal.isVisible()) await openGoal.click();
  await expect(page.getByRole("region", { name: "Plan grouped by topic" })).toBeVisible();
  expect((await snapshot(page)).sessions[0]!.status).toBe("complete");
}

test("active topics apply learned-elsewhere immediately without a verification quiz", async ({ page }) => {
  await createAndActivate(page);
  const actions = await topicActions(page, WATER);
  await expect(actions.locator('option[value="attach_source"]')).toHaveText("Attach material");
  await actions.selectOption("mark_covered");
  await expect(page.getByRole("status").filter({ hasText: "everything else unchanged" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Plan change preview" })).toHaveCount(0);
  const after = await snapshot(page);
  expect(after.knowledgeMap!.topics.find(topic => topic.id === WATER)!.initialEvidence).toMatchObject({source:"learner_report",checked:false});
});

test("founder journey preserves completed work, previews two topic changes, saves a receipt and undoes the revision", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await createAndActivate(page);
  await completeFirstSession(page);
  const before = await snapshot(page);
  const waterBefore = before.sessions.find(session => session.topicIds?.includes(WATER))!;
  expect(waterBefore.learningMode).toBe("learn");
  await page.screenshot({ path: testInfo.outputPath("01-before.png"), fullPage: true });

  await reviewCoverageChange(page, WATER);
  await expect(page.getByRole("region", { name: "Plan change preview" })).toBeVisible();
  await page.getByRole("button", { name: "Add another change", exact: true }).click();
  await page.getByRole("combobox", { name: /^Change topic\b/ }).selectOption(CARBON);
  await page.getByRole("combobox", { name: /^Change type\b/ }).selectOption("attach_source");
  await page.getByLabel("Source URL").fill(VIDEO);
  await page.getByRole("button", { name: "Preview source attachment", exact: true }).click();
  const preview = page.getByRole("region", { name: "Plan change preview" });
  await expect(preview).toContainText("1.1 Water polarity");
  await expect(preview).toContainText("Practice");
  await expect(preview).toContainText("1.3 Carbon and functional groups");
  await expect(preview.getByRole("checkbox", { name: /Include/ })).toHaveCount(2);
  await expect(preview.getByRole("combobox", { name: /Target topic/ }).first()).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await preview.screenshot({ path: testInfo.outputPath("02-preview.png") });
  await preview.getByRole("button", { name: "Confirm changes", exact: true }).click();

  const receipt = page.getByRole("status").filter({ hasText: "everything else unchanged" });
  await expect(receipt).toContainText(/water polarity/i);
  await expect(receipt).toContainText(/carbon and functional groups/i);
  const after = await snapshot(page);
  expect(after.sessions.find(session => session.id === waterBefore.id)!.learningMode).toBe("study");
  const waterAfter = after.sessions.find(session => session.id === waterBefore.id)!;
  await page.locator(`[data-topic-id="${WATER}"] summary`).click();
  await expect(page.locator(`[data-block-id="${waterAfter.id}"]`)).toContainText(waterAfter.method);
  // Brief 2 groups the plan by topic, each group collapsed until opened. The
  // attached source belongs to Carbon, so it is shown inside Carbon's group:
  // saved on the topic, then visible as a link once that group is opened.
  expect(after.knowledgeMap!.topics.find(topic => topic.id === CARBON)!.attachedSources).toEqual(expect.arrayContaining([expect.objectContaining({ url: VIDEO })]));
  await page.locator(`[data-topic-id="${CARBON}"] summary`).click();
  await expect(page.getByRole("list", { name: /^Sources for / }).getByRole("link", { name: VIDEO, exact: true })).toHaveAttribute("href", VIDEO);
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
  expect(restored).toHaveProperty("revisionId", before.revisionId ?? before.id);
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
  await reviewCoverageChange(page, WATER);
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


test("draft inline topic edits use the signed delta and keep the other sessions for activation", async ({ page }) => {
  let original: LearningPlan | undefined;
  page.on("response", async response => {
    if (new URL(response.url()).pathname === "/api/plans/generate" && response.request().method() === "POST") {
      const body = await response.json().catch(() => null);
      if (body?.plan && !original) original = body.plan;
    }
  });
  await createAndActivate(page, false);
  expect(original).toBeDefined();
  await (await topicActions(page, WATER)).selectOption("mark_covered");
  await expect(page.getByRole("region", { name: "Plan change preview" })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "everything else unchanged" })).toBeVisible();
  const after = await activatePreviewPlan(page);
  expect(after.sessions.find(session => session.topicIds?.includes(WATER))!.learningMode).toBe("study");
  for (const session of original!.sessions.filter(session => !session.topicIds?.includes(WATER))) {
    const current = after.sessions.find(item => item.id === session.id)!;
    expect({ ...current, studyRoute: session.studyRoute }).toEqual(session);
  }
  expect(after.knowledgeMap!.placementCheck).toEqual(original!.knowledgeMap!.placementCheck);
});


test("the availability editor changes dates through preview without regenerating the draft", async ({ page }) => {
  await createAndActivate(page, false);
  await page.getByRole("button", { name: "Edit plan", exact: true }).click();
  await page.getByRole("region", { name: "Edit plan", exact: true }).getByRole("combobox", { name: /^Time for Monday\b/ }).selectOption("Morning");
  const previewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/plans/adjust" && response.request().postDataJSON()?.action === "preview");
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  const body = await (await previewResponse).json();
  expect(body.proposal.generationRequest.availability.find((slot:{day:string}) => slot.day === "Monday").window).toBe("Morning");
  await expect(page.getByRole("button", { name: "Use this plan" })).toBeDisabled();
  await page.getByRole("region", { name: "Plan change preview" }).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use this plan" })).toBeEnabled();
});
