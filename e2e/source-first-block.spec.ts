import { test, expect, freezePlanClock, type Page } from "./helpers/frozen-clock";
import { blockFixture, BLOCK_TOPIC_ID } from "../src/evals/brief-c-block-fixture";
import { PlanGenerationRequestSchema } from "../src/lib/plan-generation/schema";
import { composeNormalPlanEnvelopes } from "../src/lib/plan-generation/normal-plan-envelopes";
import { buildNormalPlanFallbackFill } from "../src/lib/plan-generation/normal-plan-provider-fill";
import { buildNormalPlanFromFixedEnvelope } from "../src/lib/plan-generation/normal-plan-pipeline";
import { commitPlanStudyRoutes } from "../src/lib/study-route/activation";
import { resolvePersonalizationRollout } from "../src/lib/study-route/personalization-rollout";
import { sessionCacheContractKey, sessionCacheScopeFingerprint } from "../src/lib/session-generation/cache-contract";
import type { LearningPlan, YovaPreviewSnapshot } from "../src/lib/domain";

const NOW = new Date("2026-09-10T10:00:00.000Z");
const OTHER_TOPIC = "c0000000-0000-4000-8000-000000000010";
test.use({ video: "on" });

function preparedPlan() {
  const source = blockFixture().block.sources[0]!;
  const request = PlanGenerationRequestSchema.parse({
    intent: "plan", learningIntent: "learn", goal: "Understand AP Biology ATP energy transfer and enzyme catalysis.",
    startingContext: "I prefer short checks with examples and hints.", profileSummary: "Examples first, hints before explanations, a short focus window.",
    materialMode: "upload", materials: [{ id: source.materialId, name: source.title, mimeType: "application/pdf", sizeBytes: 1200, processingStatus: "ready", textContent: source.text }],
    studyMode: "inside", deadline: "2026-09-18T20:00:00.000Z", timeZone: "UTC", diagnosticResponses: [],
    availability: [{ day: "Every day", window: "Morning", minutes: 120 }],
    knowledgeMap: {
      version: 1, scopeJudgment: { band: "unit_or_exam", label: "AP Biology energetics", minimumSessions: 4, recommendedSessions: 4, maximumSessions: 4, minimumTeachingSessions: 2, explanation: "Study each topic, then check its application." },
      topics: [[BLOCK_TOPIC_ID, "ATP and energy transfer"], [OTHER_TOPIC, "Enzyme catalysis"]].map(([id, title], index) => ({
        id, title, description: index === 0 ? blockFixture().block.objective : "Explain how enzymes lower activation energy without changing the reaction's free-energy difference.",
        subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, origin: index === 0 ? "material" : "ai_generated", deferred: null,
        attachedSources: index === 0 ? [{ material_id: source.materialId }] : [],
        sourceReferences: index === 0 ? [{ materialId: source.materialId, chunkId: "c0000000-0000-4000-8000-000000000005", chunkIndex: 0, startCharacter: 0, endCharacter: source.text.length, locationLabel: source.section, sectionRole: "content_source" }] : [],
      })),
      placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
    },
  });
  const durationContext = { profileVersion: "brief_c_browser_duration", profile: { sustainableMinutes: null, startingFrictionRisk: null, fatigueRisk: null, preferredWindow: null, evidenceRefs: { sustainableMinutes: [], startingFrictionRisk: [], fatigueRisk: [], preferredWindow: [] } }, recentOutcomes: [] };
  const composition = composeNormalPlanEnvelopes({ request, now: NOW, durationContext, learningIntentRecommendation: { intent: "learn", basis: "Teach each unlearned topic before checking it." } });
  const methodContext = { profileVersion: "brief_c_browser_profile", personalization: { decisions: [], methodTie: { state: { controls: { experiments: false }, activeExperiment: null, experimentHistory: [] }, signals: [] } }, observedEvidence: [], rolloutDecision: resolvePersonalizationRollout({ rolloutPercent: 0, subjectKey: "brief-c-browser" }) };
  const input = { request, composition, now: NOW, methodContext };
  return { ...commitPlanStudyRoutes(buildNormalPlanFromFixedEnvelope({ ...input, fill: buildNormalPlanFallbackFill(input) }), NOW.toISOString()), status: "active" as const };
}

async function openNext(page: Page) {
  await expect(page.getByRole("region", { name: "Recommended learning plan" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recommended learning plan" }).getByRole("button").first()).toBeEnabled();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  const goal = page.getByRole("button", { name: "Open goal", exact: true }).first();
  await goal.click();
  await page.getByRole("button", { name: /Start next session|Continue session/, exact: true }).first().click();
  const early = page.getByRole("button", { name: "Start now, keep dates" });
  if (await early.isVisible()) await early.click();
  await expect(page.locator(".session-setup-shell, .session-shell")).toBeVisible({ timeout: 30_000 });
  if (await page.locator(".session-setup-shell").isVisible()) {
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Prepare this session" }).click();
  }
}

for (const finalBlock of [false, true]) {
test(finalBlock ? "finishing the final source-first block persists completion and exits without entering the legacy player" : "founder source-first block preserves practice on leave/resume and requires the check before completion", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezePlanClock(page, NOW);
  const plan = preparedPlan();
  if (finalBlock) plan.sessions = plan.sessions.map((session, index) => index === 0 ? session : { ...session, status: "complete" });
  const snapshot: YovaPreviewSnapshot = { version: 1, account: { id: "c0000000-0000-4000-8000-000000000099", email: "block@example.com", displayName: "Learner", createdAt: NOW.toISOString(), identityMode: "preview" }, signedIn: true, onboardingAnswers: [], onboardingCompleted: true, alphaEntered: true, plans: [plan], sessionCompletions: [], sessionInterruptions: [], updatedAt: NOW.toISOString() };
  await page.addInitScript(value => { if (!localStorage.getItem("yova.preview.v1")) localStorage.setItem("yova.preview.v1", JSON.stringify(value)); }, snapshot);
  let prepared = 0;
  let explanationStreams = 0;
  const newProgress = (blockId: string) => ({ blockId, sourceCompletedIds: [] as string[], attempts: [] as Array<{ questionId: string; outcome: string; feedback: string; assisted: boolean }>, revealedQuestionIds: [] as string[], reportedQuestionIds: [] as string[], hintCounts: {} as Record<string, number>, helpRequestedQuestionIds: [] as string[], complete: false, receipt: null as string | null });
  const states = new Map<string, ReturnType<typeof newProgress>>();
  await page.route("**/api/sessions/generate", async route => {
    prepared += 1;
    const body = route.request().postDataJSON();
    const session = plan.sessions.find(item => item.id === body.planSessionId)!;
    const resource = blockFixture();
    resource.block.id = session.id;
    resource.routeRevisionId = body.routeRevisionId;
    resource.cacheContext.routeRevisionId = body.routeRevisionId;
    resource.cacheContext.effectiveMinutes = session.estimatedMinutes;
    resource.cacheContext.scopeFingerprint = sessionCacheScopeFingerprint({
      plannedMinutes: session.estimatedMinutes, adjustment: body.sessionAdjustment,
      contractKey: sessionCacheContractKey({ reviewType: null, reviewConcept: null, title: session.title, methodReason: session.methodReason, topicIds: session.topicIds!, contentTargets: session.contentTargets!, completionEvidence: session.completionEvidence!, knowledgeTopics: plan.knowledgeMap!.topics.filter(topic => session.topicIds!.includes(topic.id)) }),
      routeRevisionId: body.routeRevisionId,
    });
    resource.block.estimatedMinutes = session.estimatedMinutes;
    resource.methodBriefing.methodId = session.studyRoute!.approach.primaryMethodId;
    resource.methodBriefing.name = session.method;
    resource.methodBriefing.learningMode = session.learningMode!;
    resource.block.learningMode = session.learningMode!;
    resource.block.objective = session.objective;
    const sourced = session.topicIds!.includes(BLOCK_TOPIC_ID);
    if (!sourced) {
      resource.coverage.focus = session.objective;
      resource.coverage.essentialIdeas = ["Enzymes lower activation energy."];
      resource.coverage.evidenceMap = [{ essentialIdea: "Enzymes lower activation energy.", activityConcept: "Enzyme catalysis" }];
      resource.topicIds = [OTHER_TOPIC]; resource.block.topicIds = [OTHER_TOPIC]; resource.block.sources = [];
      resource.block.activities = resource.block.activities.map((item, index) => ({ ...item, topicId: OTHER_TOPIC, ...(index === 0 ? { kind: "ai_explanation", sourceId: null, title: "Learn enzyme catalysis", content: "Enzymes lower the activation energy needed for a reaction. They do not change the reaction's free-energy difference." } : {}) }));
      resource.block.questions = resource.block.questions.map((item, index) => ({ ...item, topicId: OTHER_TOPIC,
        prompt: index === 0 ? "What does an enzyme change about a reaction?" : "Why does lowering activation energy allow a reaction to proceed faster?",
        choices: index === 0 ? ["The activation energy", "The reaction's free-energy difference", "The identity of its products"] : [],
        hints: ["Separate the reaction barrier from its overall free-energy difference."], workedExample: null,
      }));
    }
    await route.fulfill({ json: { planSessionId: body.planSessionId, session: resource, generation: { mode: "openai", persistence: "browser" } } });
  });
  await page.route("**/api/sessions/block", async route => {
    const body = route.request().postDataJSON();
    const progress = states.get(body.blockId) ?? newProgress(body.blockId);
    states.set(body.blockId, progress);
    if (body.action === "source_complete" && !progress.sourceCompletedIds.includes(body.sourceId)) progress.sourceCompletedIds.push(body.sourceId);
    if (body.action === "help_requested" && !progress.helpRequestedQuestionIds.includes(body.questionId)) progress.helpRequestedQuestionIds.push(body.questionId);
    if (body.action === "continue_after_help" && !progress.attempts.some(item => item.questionId === body.questionId)) {
      expect(progress.helpRequestedQuestionIds).toContain(body.questionId);
      progress.attempts.push({ questionId: body.questionId, outcome: "unscored", assisted: true, feedback: "You continued after help; this is not independent evidence." });
    }
    if (body.action === "answer" && !progress.attempts.some(item => item.questionId === body.questionId)) progress.attempts.push({ questionId: body.questionId, outcome: "secure", assisted: progress.helpRequestedQuestionIds.includes(body.questionId), feedback: "You connected the correct ATP products with favorable energy transfer." });
    if (body.action === "complete") {
      expect(progress.sourceCompletedIds).toHaveLength(1); expect(progress.attempts).toHaveLength(2);
      progress.complete = true; progress.receipt = "You demonstrated ATP products in your short check; the answer after requesting help remains unverified, and enzyme catalysis comes next.";
    }
    await route.fulfill({ json: { progress, ...(progress.complete ? { summary: { correctAnswers: 1, totalAnswers: 1, conceptEvidence: [], observedGap: "No checked gap." } } : {}) } });
  });
  await page.route("**/api/sessions/block/explanation", route => {
    explanationStreams += 1;
    return route.fulfill({ contentType: "text/plain", body: "Enzymes lower the activation energy needed for a reaction. They do not change the reaction's free-energy difference." });
  });
  let helpRequests = 0;
  await page.route("**/api/tutor", route => {
    helpRequests += 1;
    if (helpRequests === 1) return route.fulfill({ status: 503, json: { error: "Help is temporarily unavailable. Your practice is saved." } });
    const threadId = "c0000000-0000-4000-8000-000000000098";
    return route.fulfill({ json: { threadId, model: "fixture-only", persistence: "ephemeral", proposedAction: null,
      messages: [
        { id: "c0000000-0000-4000-8000-000000000096", threadId, role: "user", content: "Show me one example.", createdAt: NOW.toISOString() },
        { id: "c0000000-0000-4000-8000-000000000097", threadId, role: "assistant", content: "A coupled favorable reaction can supply free energy for a process that requires energy. You may continue when ready.", createdAt: NOW.toISOString() },
      ],
    } });
  });
  await page.goto("/?qa=preview");
  await openNext(page);
  const block = page.getByRole("region", { name: "Session work block" });
  await expect(block).toContainText("Cellular energetics lecture.pdf");
  await expect(block).toContainText("Page 1");
  await expect(block.getByRole("button", { name: "Mark source done" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("01-source-first.png"), fullPage: true });
  await block.getByRole("button", { name: "Mark source done" }).click();
  await expect(block.getByRole("button", { name: "Finish block" })).toBeDisabled();
  await expect(block).toContainText("Which products");
  await block.getByRole("button", { name: "ADP and inorganic phosphate", exact: true }).click();
  await block.getByRole("button", { name: "Check answer", exact: true }).click();
  await block.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(block).toContainText("why can a cell couple", { ignoreCase: true });
  await block.getByRole("button", { name: "Explain this", exact: true }).click();
  await expect(block.getByRole("alert")).toContainText("saved");
  await block.getByRole("button", { name: "Save and leave", exact: true }).click();
  await page.reload();
  await openNext(page);
  await expect(block).toContainText("why can a cell couple", { ignoreCase: true });
  expect(prepared).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("02-resumed-check.png"), fullPage: true });
  if (finalBlock) {
    await block.getByRole("button", { name: "Show me an example", exact: true }).click();
    await expect(block).toContainText("You may continue when ready.");
    await block.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(block.getByRole("button", { name: "Check answer", exact: true })).toHaveCount(0);
    await expect(block.getByRole("button", { name: "Finish block" })).toBeEnabled();
    expect([...states.values()][0]!.attempts[1]!.outcome).toBe("unscored");
  } else {
    await block.getByLabel("Your answer").fill("The favorable hydrolysis reaction supplies free energy to the coupled process.");
    await block.getByRole("button", { name: "Check answer", exact: true }).click();
    await block.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await block.getByRole("button", { name: "Finish block" }).click();
  await expect(page.getByRole("status").filter({ hasText: "You demonstrated ATP" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("03-receipt.png"), fullPage: true });
  await page.getByRole("button", { name: "Finish and continue", exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("yova.preview.v1")!).plans[0] as LearningPlan);
  expect(saved.sessions[0]!.status).toBe("complete");
  expect(explanationStreams).toBe(0);
  if (finalBlock) {
    await expect(page.getByRole("button", { name: "Learning", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Learning", exact: true })).toBeVisible();
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("yova.preview.v1")!).plans[0] as LearningPlan);
    expect(restored.sessions.every(session => session.status === "complete")).toBe(true);
    return;
  }
  await openNext(page);
  await expect(block.getByRole("heading", { name: "Learn enzyme catalysis" })).toBeVisible();
  await expect(block.getByRole("button", { name: "Mark source done" })).toHaveCount(0);
  // Development StrictMode may reopen the same read-only saved stream. The
  // invariant is no default stream for the PDF, with reviewed text streamed
  // for the unsourced topic and no additional block preparation.
  await expect.poll(() => explanationStreams).toBeGreaterThan(0);
  expect(prepared).toBe(2);
  await expect(block).toContainText("Enzymes lower the activation energy");
  await page.screenshot({ path: testInfo.outputPath("04-unsourced-explanation.png"), fullPage: true });
});

}
