import { expect, freezePlanClock, test, type Page } from "./helpers/frozen-clock";
import { writeOnboardingAnswers } from "../src/lib/onboarding/answers";

/** Transport fixtures prove recovery and state preservation, not AI generation quality.
 * Live source/task quality remains in baseline-hub-profiles.live.spec.ts. */
// A readable review recording, including successful runs. Slow browser actions
// aid playback only; every state transition still waits on an assertion.
test.use({ video: { mode: "on", size: { width: 1280, height: 900 } }, launchOptions: { slowMo: 180 } });
const point = { id: "k1", text: "Water moves from higher to lower water potential through a selectively permeable membrane." };
const questions = [1, 2, 3].map((id) => ({ id: `q${id}`, slotId: `q${id}`, keyPointIds: ["k1"], kind: "recall", prompt: `Transport check ${id}: which direction does water move?`, choices: ["Higher to lower water potential", "Lower to higher water potential", "Only into cells", "Only out of cells"], correctChoiceIndex: 0, explanation: "The net movement follows the water potential gradient across a selectively permeable membrane." }));
const learn = { action: "learn_block", explanation: "Osmosis is the net movement of water molecules from a region of higher water potential to a region of lower water potential through a selectively permeable membrane. The direction depends on the gradient, so water can enter or leave a cell. ".repeat(2), keyPoints: [point, { id: "k2", text: "A selectively permeable membrane is required for osmosis." }, { id: "k3", text: "The direction of movement depends on the water potential gradient." }], questions, structure: ["Identify the gradient", "Check for a selectively permeable membrane"], example: { title: "A plant cell in pure water", steps: ["Water potential is higher outside the cell.", "Water enters through the selectively permeable membrane."] }, tips: [] };

async function openMapSession(page: Page) {
  await freezePlanClock(page);
  const now = new Date().toISOString();
  const snapshot = { version: 1, account: { id: "99000000-0000-4000-8000-000000000002", email: "session-launch@example.com", displayName: "Session tester", createdAt: now, identityMode: "preview" }, signedIn: true,
    onboardingAnswers: writeOnboardingAnswers([], { version: 1, answers: { energy_window: "afternoon", session_length: "minutes_20_30", focus_loss: "rarely", guidance: "exact_guidance", difficulty_help: "simple_explanation", prove_knowing: "map_it", gist_detail: "balanced", starting_pattern: "on_time", support_needs: ["no_extra_support"], extra_context: "nothing_else" }, legacy: {} }),
    onboardingCompleted: true, alphaEntered: true, plans: [], sessionCompletions: [], sessionInterruptions: [], updatedAt: now };
  await page.addInitScript(value => { if (!localStorage.getItem("yova.preview.v1")) localStorage.setItem("yova.preview.v1", JSON.stringify(value)); }, snapshot);
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByLabel("Study Now topic or result").fill("Understand and explain osmosis and water potential in plant cells.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByTestId("pre-session-card").getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Map the concepts and links" })).toBeVisible();
}

async function enterMap(page: Page) {
  await page.getByLabel("Concept 1", { exact: true }).fill("Water molecules");
  await page.getByLabel("Concept 2", { exact: true }).fill("Water potential");
  await page.getByRole("button", { name: "Add relationship", exact: true }).click();
  await page.getByLabel("Link 1 label", { exact: true }).fill("moves from lower to higher");
}

test("guided map preserves the last keystroke and original/revised provenance across retry and reload", async ({ page }, testInfo) => {
  const events: Array<{ step: string; seconds: number }> = [];
  const began = Date.now();
  let revisionAttempts = 0;
  const originalInputs: string[] = [];
  await page.route("**/api/sessions/shape", async route => {
    const request = route.request().postDataJSON();
    if (request.action === "compare" && request.revision) {
      revisionAttempts += 1;
      originalInputs.push(request.revision.originalProduced);
      if (revisionAttempts === 1) { await route.fulfill({ status: 503, json: { code: "provider_unavailable", error: "The comparison service is temporarily unavailable." } }); return; }
      await route.fulfill({ status: 200, json: { action: "compare", feedback: "Your revised relationship now follows the water potential gradient.", missing: [], incorrect: [], itemFeedback: [], tips: [] } }); return;
    }
    await route.fulfill({ status: 200, json: request.action === "learn_block" ? learn : request.action === "practice" ? { action: "practice", keyPoints: [point], questions, tips: [] } : { action: "compare", feedback: "Your map reverses the direction of net water movement.", missing: [], incorrect: ["Water moves from higher to lower water potential."], itemFeedback: request.mapItems?.filter((item: { kind: string }) => item.kind === "link").map((item: { id: string }) => ({ targetId: item.id, message: "Reverse this relationship's direction." })) ?? [], tips: [] } });
  });
  await openMapSession(page);
  await enterMap(page);
  await page.getByLabel("Concept 1", { exact: true }).fill("Water final keystroke Ω");
  // No timer wait: Exit immediately after the input event.
  await page.getByRole("button", { name: "Exit session", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: /^(Start session|Continue session|Start next block)$/ }).first().click();
  await expect(page.getByLabel("Concept 1", { exact: true })).toHaveValue("Water final keystroke Ω");
  await expect(page.getByLabel("Link 1 label", { exact: true })).toHaveValue("moves from lower to higher");
  events.push({ step: "Exact map restored after immediate exit and reload", seconds: (Date.now() - began) / 1_000 });
  await page.getByRole("button", { name: "Compare my map", exact: true }).click();
  await expect(page.getByTestId("baseline-comparison")).toContainText("reverses the direction");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Link 1 label", { exact: true }).fill("moves from higher to lower");
  await page.getByRole("button", { name: "Check correction", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue unchecked", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^(Start session|Continue session|Start next block)$/ }).first().click();
  await expect(page.getByLabel("Link 1 label", { exact: true })).toHaveValue("moves from higher to lower");
  await page.getByRole("button", { name: "Retry correction check", exact: true }).click();
  await expect(page.getByTestId("repair-comparison")).toContainText("revised relationship now follows");
  await page.getByText("Original answer and feedback", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Original map", exact: true })).toContainText("moves from lower to higher");
  expect(revisionAttempts).toBe(2);
  expect(originalInputs[0]).toBe(originalInputs[1]);
  expect(originalInputs[0]).toContain("moves from lower to higher");
  events.push({ step: "Failed correction restored, retried once, original preserved", seconds: (Date.now() - began) / 1_000 });
  await testInfo.attach("journey-index.json", { body: JSON.stringify({ environment: "development preview", dependencies: "auth/profile and slot transport fixtures; no live model or database", events }, null, 2), contentType: "application/json" });
});

test("comparison transport failure can continue without claiming feedback", async ({ page }) => {
  await page.route("**/api/sessions/shape", async route => {
    const request = route.request().postDataJSON();
    await route.fulfill(request.action === "compare" ? { status: 503, json: { code: "provider_unavailable", error: "Comparison is temporarily unavailable." } } : { status: 200, json: request.action === "learn_block" ? learn : { action: "practice", keyPoints: [point], questions, tips: [] } });
  });
  await openMapSession(page); await enterMap(page);
  await page.getByRole("button", { name: "Compare my map", exact: true }).click();
  await page.getByRole("button", { name: "Move on without feedback", exact: true }).click();
  await expect(page.getByTestId("baseline-question").or(page.getByText("Feedback unavailable", { exact: true }))).toBeVisible();
  await expect(page.getByRole("heading", { name: "What is missing or wrong", exact: true })).toHaveCount(0);
});

test("two planned activities preserve first activity evidence and the second draft across reload before one completion", async ({ page }, testInfo) => {
  const requests: Array<{ action: string; segmentId?: string; topicId: string }> = [];
  await page.route("**/api/sessions/shape", async route => {
    const request = route.request().postDataJSON();
    requests.push({ action: request.action, segmentId: request.segmentId, topicId: request.topic.id });
    const scopedPoints = learn.keyPoints.map(item => ({ ...item, sourceTopicId: request.topic.id }));
    const scopedQuestions = questions.map((question, index) => ({ ...question, keyPointIds: [scopedPoints[index]!.id] }));
    await route.fulfill({ status: 200, json: request.action === "learn_block" ? { ...learn, keyPoints: scopedPoints, questions: scopedQuestions } : request.action === "practice" ? { action: "practice", keyPoints: scopedPoints, questions: scopedQuestions, tips: [] } : { action: "compare", feedback: `Fixture feedback for ${request.topic.title}: the submitted relationship is retained.`, missing: [], incorrect: [], itemFeedback: [], tips: [] } });
  });
  await openMapSession(page);
  await page.getByRole("button", { name: "Exit session", exact: true }).click();
  const topicIds = await page.evaluate(() => {
    // This test controls the work contract to isolate runtime/checkpoint
    // behavior. Real planner/authoritative DB coverage is a separate gate.
    const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")!);
    const plan = snapshot.plans.at(-1);
    const first = plan.knowledgeMap.topics[0];
    const second = { ...first, id: crypto.randomUUID(), title: "Diffusion", description: "Explain how diffusion follows a concentration gradient.", subtopics: ["Concentration gradient and net movement"], prerequisiteTopicIds: [], sourceReferences: [] };
    plan.knowledgeMap.topics = [first, second];
    const single = (topic: typeof first) => ({ version: "topic_workload_v1", topicSubtopics: [{ topicId: topic.id, subtopics: topic.subtopics.slice(0, 3) }], questionCount: 3, recallQuestionCount: 1, transferQuestionCount: 2, produceSteps: 1, sourceReadMinutes: 3, estimatedMinutes: 12, ceilingMinutes: 30, practicePlaceholder: false, practiceRound: 0, suggestedDate: true, ruleIds: ["L3.q6.map_it"] });
    const left = single(first), right = single(second);
    plan.sessions[0] = { ...plan.sessions[0], topicIds: [first.id, second.id], estimatedMinutes: 24, workload: { ...left, topicSubtopics: [...left.topicSubtopics, ...right.topicSubtopics], questionCount: 6, recallQuestionCount: 2, transferQuestionCount: 4, produceSteps: 2, sourceReadMinutes: 6, estimatedMinutes: 24, segments: [{ segmentId: "segment-1", learningMode: "learn", taskType: "conceptual_learning", workload: left }, { segmentId: "segment-2", learningMode: "learn", taskType: "conceptual_learning", workload: right }] } };
    localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
    return [first.id, second.id] as string[];
  });
  await page.reload();
  await page.getByRole("button", { name: /^(Start session|Continue session|Start next block)$/ }).first().click();
  await expect(page.locator('[data-segment-id="segment-1"]')).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await enterMap(page);
  await page.getByRole("button", { name: "Compare my map", exact: true }).click();
  await expect(page.getByTestId("baseline-comparison")).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Move on", exact: true }).click();
  await answerFixtureRound(page);
  await expect(page.getByRole("button", { name: "Finish", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to next activity", exact: true }).click();
  await expect(page.locator('[data-segment-id="segment-2"]')).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await enterMap(page);
  await page.getByRole("textbox", { name: "Concept 1", exact: true }).fill("Second activity final key Ω");
  await page.getByRole("button", { name: "Exit session", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("yova.preview.v1")!).sessionCompletions.length)).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: /^(Start session|Continue session|Start next block)$/ }).first().click();
  await expect(page.locator('[data-segment-id="segment-2"]')).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Concept 1", exact: true })).toHaveValue("Second activity final key Ω");
  await expect(page.getByTestId("completed-activity-work")).toContainText("3 of 3 answers correct");
  await page.getByRole("button", { name: "Compare my map", exact: true }).click();
  await expect(page.getByTestId("baseline-comparison")).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Move on", exact: true }).click();
  await answerFixtureRound(page);
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.locator("[data-segment-id]")).toHaveCount(0);
  const completed = await page.evaluate(() => JSON.parse(localStorage.getItem("yova.preview.v1")!).sessionCompletions);
  expect(completed).toHaveLength(1);
  expect(completed[0]).toMatchObject({ correctAnswers: 6, totalAnswers: 6, segmentCompletions: [{ segmentId: "segment-1", correctAnswers: 3, totalAnswers: 3 }, { segmentId: "segment-2", correctAnswers: 3, totalAnswers: 3 }] });
  expect(completed[0].conceptEvidence).toHaveLength(6);
  expect([...new Set(completed[0].conceptEvidence.map((entry: { topicId: string }) => entry.topicId))].sort()).toEqual([...topicIds].sort());
  for (const request of requests.filter(request => request.segmentId)) expect(request.topicId).toBe(topicIds[request.segmentId === "segment-1" ? 0 : 1]);
  // Reload resumes generated content; it must not request the first activity again.
  const firstCalls = requests.filter(request => request.segmentId === "segment-1").length;
  expect(requests.slice(requests.findIndex(request => request.segmentId === "segment-2")).filter(request => request.segmentId === "segment-1")).toHaveLength(0);
  await testInfo.attach("two-activity-journey.json", { body: JSON.stringify({ dependencies: "preview plan/workload and model transport fixtures; no live model or database", firstActivityCalls: firstCalls, requests, completion: completed[0] }, null, 2), contentType: "application/json" });
});

async function answerFixtureRound(page: Page) {
  for (let index = 0; index < questions.length; index += 1) {
    await expect(page.getByTestId("baseline-question")).toBeVisible();
    await page.getByRole("button", { name: "Higher to lower water potential", exact: true }).click();
    await page.getByRole("button", { name: index === questions.length - 1 ? "Finish round" : "Next question", exact: true }).click();
  }
}
