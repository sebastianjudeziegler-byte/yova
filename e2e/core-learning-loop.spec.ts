import { beginNormalPlan, buildPlanFromSchedule, expandGroupedPlanTopics } from "./helpers/plan-setup";
import { expect, test, type Page, freezePlanClock, PLAN_FIXED_NOW } from "./helpers/frozen-clock";
import type { LearningPlan } from "../src/lib/domain";

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

test("home lets the learner browse prioritized recommendations without opening every plan", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Temporary test failure." }) });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await createOneOffLearningSession(page, "Help me understand compound growth and personal finance basics.");
  await createOneOffLearningSession(page, "Teach me startup funding stages, instruments, investors, and dilution from the beginning.");

  const recommendation = recommendedLearningPlan(page);
  await expect(recommendation).toBeVisible();
  const secondRecommendation = page.getByRole("button", { name: "Show recommendation 2 of 2" });
  await expect(secondRecommendation).toBeVisible();
  await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
  const firstTitle = await recommendation.getByRole("heading", { level: 2 }).textContent();
  await secondRecommendation.click();
  await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
  await expect(recommendation.getByRole("heading", { level: 2 })).not.toHaveText(firstTitle ?? "");
});

test("the backend rejects an opaque goal even when the browser guard is bypassed", async ({ request }) => {
  const response = await request.post("/api/plans/generate", {
    headers: { "X-Yova-Development-Preview": "plan-creator" },
    data: {
      intent: "study_now",
      learningIntent: "learn",
      goal: "Start Calc Unit 3",
      materialMode: "none",
      materials: [],
      studyMode: "inside",
      deadline: null,
      timeZone: "America/Los_Angeles",
      diagnosticResponses: [{
        question: "Where are you starting?",
        answer: "I have not learned this yet",
        evaluation: "self_report",
      }],
      availability: [{ day: "Today", window: "Now", minutes: 15 }],
      profileSummary: "The learner wants a short, clearly structured session.",
    },
  });
  const body = await response.json();

  expect(response.status()).toBe(422);
  expect(body.code).toBe("goal_needs_detail");
});

test("plan generation remains a draft until the learner activates it", async ({ request }) => {
  const deadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000);
  const generationRequest = {
    intent: "plan",
    learningIntent: "learn",
    goal: "Understand photosynthesis and cellular respiration for my biology test",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: deadline.toISOString(),
    timeZone: "America/Los_Angeles",
    diagnosticResponses: [{
      question: "Where are you starting?",
      answer: "I have not learned this yet",
      evaluation: "self_report",
    }],
    availability: [{ day: "Every day", window: "Evening", minutes: 45 }],
    profileSummary: "The learner prefers direct explanations, examples, and short structured sessions.",
  };
  const previewHeaders = { "X-Yova-Development-Preview": "plan-creator" };
  const generationResponse = await request.post("/api/plans/generate", {
    headers: previewHeaders,
    data: generationRequest,
  });
  const generated = await generationResponse.json();

  expect(generationResponse.status()).toBe(200);
  expect(generated.plan.status).toBe("draft");
  expect(generated.generation.persistence).toBe("draft");

  const activationResponse = await request.post("/api/plans/activate", {
    headers: previewHeaders,
    data: { plan: generated.plan, generationRequest },
  });
  const activated = await activationResponse.json();

  expect(activationResponse.status()).toBe(200);
  expect(activated.plan.status).toBe("active");
  expect(activated.activation.persistence).toBe("browser");

  const repeatedActivation = await request.post("/api/plans/activate", {
    headers: previewHeaders,
    data: { plan: generated.plan, generationRequest },
  });
  const repeated = await repeatedActivation.json();

  expect(repeatedActivation.status()).toBe(200);
  expect(repeated.plan.id).toBe(activated.plan.id);
  expect(repeated.plan.learningItemId).toBe(activated.plan.learningItemId);
});

test("an unverified topic rewrite leaves the learner's saved plan and completed progress unchanged", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);
  const planId = "64000000-0000-4000-8000-000000000001";
  await page.evaluate((id) => {
    const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")!);
    const topicIds = ["64000000-0000-4000-8000-000000000002", "64000000-0000-4000-8000-000000000003"];
    snapshot.plans = [{
      id, learningItemId: "64000000-0000-4000-8000-000000000004", title: "Respiration revision audit", topic: "Cellular respiration", kind: "topic", deadline: null, status: "active", sourceMode: "yova_generated", studyMode: "inside_yova", learningIntent: "learn", creationIntent: "plan", sessionArchitectureVersion: "streamed_teaching_v1", rationale: "Learn the remaining stages while keeping the completed work.", createdAt: new Date().toISOString(), materials: [],
      knowledgeMap: { version: 1, topics: ["Glycolysis", "Link reaction"].map((title, index) => ({ id: topicIds[index], title, description: `Understand the products and purpose of ${title}.`, subtopics: [], prerequisiteTopicIds: [], status: index === 0 ? "secure" : "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null })), placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] } },
      sessions: ["Glycolysis", "Link reaction"].map((title, index) => ({ id: `64000000-0000-4000-8000-00000000000${index + 5}`, sequence: index + 1, title: `Explain ${title}`, objective: `Explain the carbon products and energy carriers in ${title}.`, method: "Feynman Technique", methodReason: "Build an accurate model before independent recall.", scheduledFor: new Date(Date.now() + index * 60 * 60 * 1000).toISOString(), estimatedMinutes: 25, amountLabel: "One explanation and check", learningMode: "learn", topicIds: [topicIds[index]], contentTargets: [title], completionEvidence: [`Explain the products of ${title} without notes`], status: index === 0 ? "complete" : "ready" })),
    }];
    localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  }, planId);
  await page.reload();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.getByRole("button", { name: "Open goal" }).click();
  const savedPlan = () => page.evaluate(id => JSON.parse(localStorage.getItem("yova.preview.v1")!).plans.find((plan: LearningPlan) => plan.id === id), planId);
  const before = await savedPlan();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  const panel = page.getByRole("region", { name: "Plan change preview" });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("What should be different?")).toHaveCount(0);
  const rejected = await page.evaluate(async plan => {
    const response = await fetch("/api/plans/adjust", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.id, direction: "Replace the next Link reaction session with photosynthesis and chloroplasts instead. Leave my completed Glycolysis session unchanged.", estimatedMinutes: 25, studyMode: "inside_yova", deadline: null }) });
    return { status: response.status, body: await response.json() };
  }, before);
  expect(rejected.status).toBe(409);
  expect(rejected.body.code).toBe("plan_direction_unverified");
  expect(rejected.body.error).toContain("Your plan is unchanged");
  expect(await savedPlan()).toEqual(before);
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Respiration revision audit" })).toBeVisible();
});

test("Calendar Agenda stays first and contained at a 375px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await createPreviewAccount(page);
  await completeOnboarding(page);
  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as {
      plans: unknown[];
      sessionCompletions: unknown[];
      updatedAt?: string;
    };
    const completedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000).toISOString();
    const startedAt = new Date(Date.parse(completedAt) - 20 * 60 * 1_000).toISOString();
    const planId = "61000000-0000-4000-8000-000000000001";
    const sessionId = "61000000-0000-4000-8000-000000000002";
    const topicId = "61000000-0000-4000-8000-000000000003";
    snapshot.plans.push({
      id: planId,
      learningItemId: "61000000-0000-4000-8000-000000000004",
      title: "Ocean circulation systems and climate interactions",
      topic: "Physical oceanography",
      kind: "topic",
      deadline: null,
      status: "completed",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
      creationIntent: "plan",
      sessionArchitectureVersion: "filled_teaching_v1",
      rationale: "Use retrieval and application to check the model.",
      createdAt: startedAt,
      materials: [],
      sessions: [{
        id: sessionId,
        sequence: 1,
        title: "Retrieve the ocean-circulation model",
        objective: "Explain the relationship without support.",
        method: "Retrieval practice",
        methodReason: "Independent recall makes the current model visible.",
        scheduledFor: startedAt,
        estimatedMinutes: 20,
        amountLabel: "20 minutes",
        learningMode: "study",
        topicIds: [topicId],
        contentTargets: ["Photosynthetic electron transport chain redox carrier relationships"],
        completionEvidence: ["Explain the full relationship independently"],
        status: "complete",
      }],
    });
    snapshot.sessionCompletions.push({
      id: "61000000-0000-4000-8000-000000000005",
      planId,
      planSessionId: sessionId,
      startedAt,
      completedAt,
      plannedMinutes: 20,
      actualMinutes: 20,
      correctAnswers: 0,
      totalAnswers: 1,
      feedback: "about_right",
      observedGap: "Photosynthetic electron transport chain redox carrier relationships",
      completionMode: "guided",
      conceptEvidence: [{
        topicId,
        concept: "Photosynthetic electron transport chain redox carrier relationships",
        outcome: "needs_review",
        activityType: "free_response",
      }],
      confidenceEvidence: [],
    });
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
  await page.reload();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();

  const geometry = await page.locator(".calendar-workspace").evaluate((workspace) => {
    const rail = workspace.querySelector<HTMLElement>(".calendar-quick-add");
    const main = workspace.querySelector<HTMLElement>(".calendar-board");
    if (!rail || !main) return null;
    const railRect = rail.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    return {
      bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      workspaceFits: workspace.scrollWidth <= workspace.clientWidth + 1,
      railFits: rail.scrollWidth <= rail.clientWidth + 1,
      boardBeforeQuickAdd: mainRect.bottom <= railRect.top + 2,
    };
  });

  expect(geometry).toEqual({
    bodyFits: true,
    workspaceFits: true,
    railFits: true,
    boardBeforeQuickAdd: true,
  });
  await expect(page.getByRole("button", { name: "Agenda", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("the product shell keeps every core destination and creation path usable", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turn any goal into a clear next step." })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".home-page");

  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What you’re working toward" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".page");

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".page");

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Get help in context" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".page");
  await expect(page.getByRole("combobox", { name: "Ask YOVA context" })).toHaveValue("general");
  await expect(page.getByText("No learning goal attached")).toBeVisible();
  await page.getByRole("button", { name: /^History/ }).click();
  await expect(page.getByRole("dialog", { name: "Previous chats" })).toBeVisible();
  await page.getByRole("button", { name: "Close conversation history" }).last().click();
  await page.getByRole("textbox", { name: "Ask YOVA" }).fill("An unsent draft");

  await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your learning, in one place" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".page");
  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ask YOVA context" })).toHaveValue("general");
  await expect(page.getByRole("textbox", { name: "Ask YOVA" })).toHaveValue("");
  await page.getByRole("button", { name: "You", exact: true }).click();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Build my first plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What do you need to learn or prepare for?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.locator(".calendar-page-header").getByRole("button", { name: "Add event", exact: true }).click();
  await expect(page.getByRole("form", { name: "Add calendar event" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What do you want to study?" })).toBeVisible();
});

test("Ask YOVA turns structured explanations and math into readable interface content", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.route("**/api/tutor", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const threadId = "10000000-0000-4000-8000-000000000001";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        threadId,
        messages: [
          {
            id: "10000000-0000-4000-8000-000000000002",
            threadId,
            role: "user",
            content: "Explain the derivative at x equals 2.",
            createdAt: "2026-08-06T20:00:00.000Z",
          },
          {
            id: "10000000-0000-4000-8000-000000000003",
            threadId,
            role: "assistant",
            content: "**Core idea:** the derivative is the instantaneous rate of change.\n\nUse $f'(2)=4$.\n\n1. Compare nearby points.\n2. Shrink the interval.",
            createdAt: "2026-08-06T20:00:01.000Z",
          },
        ],
        model: "test-model",
        persistence: "browser",
        proposedAction: null,
      }),
    });
  });

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await page.getByRole("textbox", { name: "Ask YOVA" }).fill("Explain the derivative at x equals 2.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.locator(".tutor-rich-text strong")).toHaveText("Core idea:");
  await expect(page.locator(".tutor-rich-text .katex")).toBeVisible();
  await expect(page.locator(".tutor-rich-text li")).toHaveCount(2);
  await expect(page.locator(".tutor-rich-text")).not.toContainText("**");
});

test("a planning request outage still produces a reviewable plan from YOVA's saved inputs", async ({ page }) => {
  await page.route("**/api/plans/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary planning service failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await beginPlanFromAdd(page, "I have a biology test in two weeks on cellular respiration.");
  await buildPlanFromSchedule(page);

  // This browser-preview-only outage path still uses the legacy local
  // composer. It must stay reviewable and label its fallback honestly; it is
  // not evidence of server v2 composition or production offline generation.
  await expect(page.locator(".generated-plan")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Use this plan", exact: true })).toBeVisible();
  const livePlanningIssue = page.locator(".generation-notice[role='alert']");
  await expect(livePlanningIssue).toContainText("Live AI planning failed");
  await expect(livePlanningIssue.getByRole("button", { name: "Retry live planning" })).toBeVisible();
  await expect(livePlanningIssue).not.toContainText("reliable planning engine");
  await expect(page.getByRole("heading", { name: "Your information is safe." })).not.toBeVisible();
});

test("legacy split work reopens as an active plan with runnable ten-minute sessions", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as Record<string, unknown> & { plans: unknown[] };
    const topicId = "65000000-0000-4000-8000-000000000003";
    snapshot.plans = [{
      id: "65000000-0000-4000-8000-000000000001",
      learningItemId: "65000000-0000-4000-8000-000000000002",
      title: "Plate Tectonics and Mantle Convection",
      topic: "How mantle convection contributes to plate motion",
      kind: "topic",
      deadline: null,
      // Old split/start races could leave this lifecycle value behind even
      // though both generated parts were still runnable.
      status: "completed",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
      creationIntent: "plan",
      sessionArchitectureVersion: "filled_teaching_v1",
      rationale: "Recover the unfinished explanation and application work without losing either part.",
      createdAt: "2026-08-20T12:00:00.000Z",
      materials: [],
      sessions: [{
        id: "65000000-0000-4000-8000-000000000011",
        sequence: 1,
        title: "Explain mantle convection · Part 1 of 2",
        objective: "Explain how temperature and density differences drive mantle convection.",
        method: "Self-explanation",
        methodReason: "A causal explanation makes the plate-motion model visible.",
        scheduledFor: "2030-06-01T15:00:00.000Z",
        estimatedMinutes: 8,
        amountLabel: "One focused target · about 8 min",
        learningMode: "study",
        topicIds: [topicId],
        contentTargets: ["Temperature, density, and mantle circulation"],
        completionEvidence: ["Explain the convection relationship in your own words"],
        originSessionId: "65000000-0000-4000-8000-000000000010",
        originalContentMinutes: 15,
        segmentIndex: 1,
        segmentCount: 2,
        status: "ready",
      }, {
        id: "65000000-0000-4000-8000-000000000012",
        sequence: 2,
        title: "Explain mantle convection · Part 2 of 2",
        objective: "Apply the convection model to divergent and convergent plate boundaries.",
        method: "Scenario application",
        methodReason: "A new boundary scenario checks whether the causal model transfers.",
        scheduledFor: "2030-06-02T15:00:00.000Z",
        estimatedMinutes: 7,
        amountLabel: "One focused target · about 7 min",
        learningMode: "study",
        topicIds: [topicId],
        contentTargets: ["Mantle convection and plate-boundary motion"],
        completionEvidence: ["Apply the model to one unfamiliar plate-boundary scenario"],
        originSessionId: "65000000-0000-4000-8000-000000000010",
        originalContentMinutes: 15,
        segmentIndex: 2,
        segmentCount: 2,
        status: "upcoming",
      }],
    }];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });

  await page.reload();
  await page.getByRole("button", { name: "Learning", exact: true }).click();

  const recoveredPlan = page.locator(".learning-goal-card").filter({
    hasText: "Plate Tectonics and Mantle Convection",
  });
  await expect(recoveredPlan).toBeVisible();
  await expect(recoveredPlan).toContainText("0 of 2 sessions complete");
  await expect(recoveredPlan).toContainText("10 min");
  await expect(recoveredPlan.getByRole("button", { name: "Start next" })).toBeVisible();
  await expect(page.locator(".tabs").getByRole("button", { name: /Active/ })).toContainText("1");
  await expect(page.locator(".tabs").getByRole("button", { name: /Recent/ })).toContainText("0");

  await expect.poll(() => page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return null;
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{
        title?: string;
        status?: string;
        sessions?: Array<{ estimatedMinutes?: number; amountLabel?: string }>;
      }>;
    };
    const plan = snapshot.plans?.find((candidate) => candidate.title === "Plate Tectonics and Mantle Convection");
    return plan ? {
      status: plan.status,
      minutes: plan.sessions?.map((session) => session.estimatedMinutes),
      labels: plan.sessions?.map((session) => session.amountLabel),
    } : null;
  })).toEqual({
    status: "active",
    minutes: [10, 10],
    labels: [
      "One focused target · about 10 min",
      "One focused target · about 10 min",
    ],
  });

  await recoveredPlan.getByRole("button", { name: "Start next" }).click();
  const earlyStartDialog = page.getByRole("dialog", {
    name: "Start Explain mantle convection · Part 1 of 2 now?",
  });
  if (await earlyStartDialog.isVisible()) {
    await earlyStartDialog.getByRole("button", { name: "Start now, keep dates" }).click();
  }
  // Brief 1.5 item 8: the runnable part opens its pre-session card at ten minutes.
  const card = page.getByTestId("pre-session-card");
  await expect(card).toContainText("· 10 min");
  await expect(card).not.toContainText("8 min");
});

test("adjusting ordinary future work preserves the exact scheduled review contract", async ({ page }) => {
  await freezePlanClock(page, new Date("2030-06-03T12:00:00.000Z"));
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as Record<string, unknown> & { plans: unknown[] };
    const topicId = "66000000-0000-4000-8000-000000000003";
    snapshot.plans = [{
      id: "66000000-0000-4000-8000-000000000001",
      learningItemId: "66000000-0000-4000-8000-000000000002",
      title: "Plate Boundary Evidence Plan",
      topic: "Use geological evidence to explain plate-boundary motion",
      kind: "topic",
      deadline: null,
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
      creationIntent: "plan",
      sessionArchitectureVersion: "filled_teaching_v1",
      rationale: "Keep the delayed evidence check exact while resizing later content practice.",
      createdAt: "2026-08-20T12:00:00.000Z",
      materials: [],
      schedulePreferences: { timeZone: "UTC", availability: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(day => ({ day, window: "15:00–17:00", minutes: 120 })) },
      knowledgeMap: { version: 1,
        scopeJudgment: { band: "unit_or_exam", label: "Plate boundary evidence", minimumSessions: 1, recommendedSessions: 2, maximumSessions: 2, minimumTeachingSessions: 1, explanation: "Apply geological evidence and preserve the delayed review." },
        topics: [{ id: topicId, title: "Plate boundary evidence", description: "Use geological evidence to compare convergent and divergent boundaries.", subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null }],
        placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] } },
      sessions: [{
        id: "66000000-0000-4000-8000-000000000011",
        sequence: 1,
        title: "Verify the mantle-convection relationship",
        objective: "Verify the relationship after a delay without reopening the earlier lesson.",
        method: "Three-item closed-note review",
        methodReason: "A delayed closed-note check tests whether the repaired relationship now holds.",
        scheduledFor: "2030-06-03T15:00:00.000Z",
        estimatedMinutes: 5,
        amountLabel: "3 quick questions · about 5 min",
        learningMode: "study",
        topicIds: [topicId],
        contentTargets: ["Mantle convection and plate motion"],
        completionEvidence: ["Answer exactly 3 closed-note questions about the relationship"],
        status: "ready",
        reviewConcept: "Mantle convection and plate motion",
        reviewType: "verify",
      }, {
        id: "66000000-0000-4000-8000-000000000012",
        sequence: 2,
        title: "Apply evidence at contrasting plate boundaries",
        objective: "Compare geological evidence from two contrasting plate-boundary settings.",
        method: "Case comparison",
        methodReason: "Contrasting cases make the transferable evidence rules explicit.",
        scheduledFor: "2030-06-04T15:00:00.000Z",
        estimatedMinutes: 25,
        amountLabel: "Two boundary cases + evidence check · about 25 min",
        learningMode: "study",
        topicIds: [topicId],
        contentTargets: ["Evidence at convergent boundaries", "Evidence at divergent boundaries"],
        completionEvidence: ["Compare the evidence and explain what each case supports"],
        status: "upcoming",
      }],
    }];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });

  await page.reload();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  const planCard = page.locator(".learning-goal-card").filter({ hasText: "Plate Boundary Evidence Plan" });
  await planCard.getByRole("button", { name: "Open goal" }).click();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();

  const adjustmentPanel = page.getByRole("region", { name: "Plan change preview" });
  await adjustmentPanel.getByLabel("Change type").selectOption("attach_source");
  await adjustmentPanel.getByLabel("Source URL").fill("https://example.com/plate-boundary-notes");
  await adjustmentPanel.getByRole("button", { name: "Preview source attachment" }).click();
  await expect(adjustmentPanel).toContainText("Study this source, then practice");
  await adjustmentPanel.getByRole("button", { name: "Confirm changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "everything else unchanged" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return null;
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{
        title?: string;
        sessions?: Array<Record<string, unknown>>;
      }>;
    };
    const sessions = snapshot.plans?.find((plan) => plan.title === "Plate Boundary Evidence Plan")?.sessions ?? [];
    const review = sessions.find((session) => session.id === "66000000-0000-4000-8000-000000000011");
    const ordinary = sessions.filter((session) => session.id !== "66000000-0000-4000-8000-000000000011");
    return review ? {
      review: {
        id: review.id,
        sequence: review.sequence,
        title: review.title,
        objective: review.objective,
        method: review.method,
        methodReason: review.methodReason,
        scheduledFor: review.scheduledFor,
        estimatedMinutes: review.estimatedMinutes,
        amountLabel: review.amountLabel,
        learningMode: review.learningMode,
        topicIds: review.topicIds,
        contentTargets: review.contentTargets,
        completionEvidence: review.completionEvidence,
        status: review.status,
        reviewConcept: review.reviewConcept,
        reviewType: review.reviewType,
      },
      ordinary: ordinary.map((session) => ({
        sequence: session.sequence,
        estimatedMinutes: session.estimatedMinutes,
        status: session.status,
        originSessionId: session.originSessionId,
      })),
    } : null;
  })).toEqual({
    review: {
      id: "66000000-0000-4000-8000-000000000011",
      sequence: 1,
      title: "Verify the mantle-convection relationship",
      objective: "Verify the relationship after a delay without reopening the earlier lesson.",
      method: "Three-item closed-note review",
      methodReason: "A delayed closed-note check tests whether the repaired relationship now holds.",
      scheduledFor: "2030-06-03T15:00:00.000Z",
      estimatedMinutes: 5,
      amountLabel: "3 quick questions · about 5 min",
      learningMode: "study",
      topicIds: ["66000000-0000-4000-8000-000000000003"],
      contentTargets: ["Mantle convection and plate motion"],
      completionEvidence: ["Answer exactly 3 closed-note questions about the relationship"],
      status: "ready",
      reviewConcept: "Mantle convection and plate motion",
      reviewType: "verify",
    },
    ordinary: [{
      sequence: 2,
      estimatedMinutes: 45,
      status: "upcoming",
      originSessionId: undefined,
    }],
  });

  const timeline = page.locator(".plan-timeline");
  await expect(timeline).toContainText("Verify the mantle-convection relationship");
  await expect(timeline.locator(".timeline-row").filter({ hasText: "Verify the mantle-convection relationship" }))
    .toContainText("5 min");
  expect(await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("yova.preview.v1")!).plans.find((item: LearningPlan) => item.title === "Plate Boundary Evidence Plan");
    return plan.knowledgeMap.topics[0].attachedSources;
  })).toEqual([{ url: "https://example.com/plate-boundary-notes" }]);
});

test("a normal conceptual plan visibly moves from Learn to later Practice and commits both route modes", async ({ page }) => {
  await createPreviewAccount(page); await completeOnboarding(page);
  await beginPlanFromAdd(page, "I have never studied cellular respiration. Teach me from scratch for my exam in three weeks.");
  await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  const generated = await (await buildPlanFromSchedule(page)).json() as {plan:LearningPlan};
  await expect(page.getByRole("region", { name: "Plan grouped by topic" })).toBeVisible();
  await expandGroupedPlanTopics(page);
  const learnIndex = generated.plan.sessions.findIndex(session => session.learningMode === "learn");
  const practiceIndex = generated.plan.sessions.findIndex((session,index) => index > learnIndex && session.learningMode === "study");
  expect(learnIndex).toBeGreaterThanOrEqual(0); expect(practiceIndex).toBeGreaterThan(learnIndex);
  for (const session of generated.plan.sessions) {
    await expect(page.locator(`[data-block-id="${session.id}"]`)).toContainText(session.title);
    await expect(page.locator(`[data-block-id="${session.id}"]`)).toContainText(session.method);
  }
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("button", {name:"Start next block",exact:true})).toBeVisible();
  const stored = await page.evaluate(() => (JSON.parse(localStorage.getItem("yova.preview.v1")!) as {plans:LearningPlan[]}).plans.at(-1)!);
  expect(stored.sessions.map(session=>session.title)).toEqual(generated.plan.sessions.map(session=>session.title));
  expect(stored.sessions[learnIndex]!.studyRoute!.approach.mode).toBe("learn");
  expect(stored.sessions[practiceIndex]!.studyRoute!.approach.mode).toBe("practice");
  expect(stored.sessions.every(session=>session.studyRoute!.identity.lifecycleStatus==="committed")).toBe(true);
});

test("map revision cannot activate a stale draft and covered reports preserve placement", async ({ page }) => {
  await freezePlanClock(page);
  let releaseUpdate: (() => void) | undefined;
  let updateStarted = false; let activated = 0; let diagnosticRequests = 0;
  let previewBody: { proposal: { after: LearningPlan; before: LearningPlan } } | undefined;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/plans/activate") activated += 1;
    if (request.url().includes("/api/plans/generate?mode=diagnostic")) diagnosticRequests += 1;
  });
  await page.route("**/api/plans/adjust", async route => {
    if (route.request().postDataJSON().action === "preview" && !updateStarted) {
      updateStarted = true;
      await new Promise<void>(resolve => { releaseUpdate = resolve; });
      const response = await route.fetch(); previewBody = await response.json();
      await route.fulfill({ response, json: previewBody });
    } else await route.continue();
  });
  await createPreviewAccount(page); await completeOnboarding(page);
  await beginPlanFromAdd(page, "Build me a plan to understand cellular respiration from scratch in three weeks.");
  await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  await buildPlanFromSchedule(page);
  await page.getByRole("button", {name:"Edit plan",exact:true}).click();
  await page.getByLabel("Add topic",{exact:true}).fill("Fermentation comparison");
  await page.getByRole("button",{name:"Preview changes",exact:true}).click();
  const panel = page.getByRole("region", { name: "Plan change preview" });
  await expect.poll(() => updateStarted).toBe(true);
  try {
    await expect(page.getByRole("button", { name: "Use this plan" })).toBeDisabled();
    for (const name of ["Edit plan", "Add material"]) await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
    expect(activated).toBe(0);
  } finally { releaseUpdate?.(); }
  await expect(panel.getByRole("button", { name: "Confirm changes" })).toBeEnabled();
  await panel.getByRole("button", { name: "Confirm changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "everything else unchanged" })).toBeVisible();
  expect(previewBody!.proposal.after.knowledgeMap!.placementCheck).toEqual(previewBody!.proposal.before.knowledgeMap!.placementCheck);
  await page.getByRole("button",{name:"Edit plan",exact:true}).click();
  await page.getByRole("region",{name:"Edit plan",exact:true}).getByRole("button",{name:"Cancel",exact:true}).click();
  await expandGroupedPlanTopics(page);
  const report = page.waitForResponse(response=>new URL(response.url()).pathname==="/api/plans/adjust"&&response.request().postDataJSON().action==="apply");
  await page.getByRole("combobox",{name:/^Topic actions for/}).first().selectOption("mark_covered");
  const applied = await (await report).json() as {plan:LearningPlan};
  expect(applied.plan.knowledgeMap!.placementCheck).toEqual(previewBody!.proposal.before.knowledgeMap!.placementCheck);
  expect(applied.plan.knowledgeMap!.topics.some(topic=>topic.initialEvidence?.source==="learner_report")).toBe(true);
  expect(diagnosticRequests).toBe(0); expect(activated).toBe(0);
  await expect(page.getByRole("button", { name: "Use this plan" })).toBeEnabled();
});

test("normal-plan review changes one offered method without regenerating or rewriting other routes", async ({ page }) => {
  let planGenerationRequests=0;
  page.on("request",request=>{if(new URL(request.url()).pathname==="/api/plans/generate")planGenerationRequests+=1;});
  await createPreviewAccount(page);await completeOnboarding(page);
  await beginPlanFromAdd(page,"I have a biology test next Friday on cellular respiration.");
  await page.getByRole("button",{name:"45 minutes",exact:true}).click();
  const generated=await(await buildPlanFromSchedule(page)).json() as {plan:LearningPlan};
  await expect(page.getByRole("region",{name:"Plan grouped by topic"})).toBeVisible();
  await expandGroupedPlanTopics(page);
  const generationCountBeforeChoice=planGenerationRequests;
  const target=generated.plan.sessions.find(session=>session.studyRoute?.agency.alternatives.length)!;
  expect(target).toBeDefined();const alternative=target.studyRoute!.agency.alternatives[0]!;
  expect(alternative.visibleMethodName).not.toBe(target.method);
  const appliedResponse=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/plans/adjust"&&response.request().postDataJSON().action==="apply");
  await page.locator(`[data-block-id="${target.id}"]`).getByRole("combobox").selectOption(alternative.primaryMethodId);
  const applied=await appliedResponse;expect(applied.ok()).toBe(true);
  const updated=(await applied.json() as {plan:LearningPlan}).plan;
  const changed=updated.sessions.find(session=>session.id===target.id)!;
  expect(changed.studyRoute!.approach.primaryMethodId).toBe(alternative.primaryMethodId);
  expect(changed.studyRoute!.identity.routeRevisionId).not.toBe(target.studyRoute!.identity.routeRevisionId);
  expect(changed.studyRoute!.agency.selectedBy).toBe("learner");
  for(const before of generated.plan.sessions){if(before.id!==target.id)expect(updated.sessions.find(session=>session.id===before.id)).toEqual(before);}
  await expect(page.locator(`[data-block-id="${target.id}"]`)).toContainText(alternative.visibleMethodName);
  expect(planGenerationRequests).toBe(generationCountBeforeChoice);
  await page.getByRole("button",{name:"Use this plan",exact:true}).click();
  await expect(page.getByRole("button",{name:"Start next block",exact:true})).toBeVisible();
  const stored=await page.evaluate(id=>(JSON.parse(localStorage.getItem("yova.preview.v1")!) as {plans:LearningPlan[]}).plans.find(plan=>plan.id===id)!,updated.id);
  const storedTarget=stored.sessions.find(session=>session.id===target.id)!;
  expect(storedTarget.method).toBe(alternative.visibleMethodName);
  expect(storedTarget.studyRoute!.approach.visibleMethodName).toBe(alternative.visibleMethodName);
  expect(storedTarget.studyRoute!.identity.lifecycleStatus).toBe("committed");
  expect(storedTarget.studyRoute!.identity.routeRevisionId).toBe(changed.studyRoute!.identity.routeRevisionId);
  expect(storedTarget.studyRoute!.agency).toMatchObject({selectedBy:"learner",controlMode:"learner_customizes",override:{changedFields:["primary_method"]}});
  for(const before of generated.plan.sessions){if(before.id!==target.id){const persisted=stored.sessions.find(session=>session.id===before.id)!;expect(persisted.studyRoute!.identity.routeRevisionId).toBe(before.studyRoute!.identity.routeRevisionId);expect(persisted.studyRoute!.agency.selectedBy).toBe("yova");}}
});

test("a multi-session plan carries one clear source decision from Add to Learning", async ({ page }, testInfo) => {
  // Deterministic scheduling: this journey asserts on session counts after a
  // "next Friday" goal, which depends on how much of today is still available.
  await freezePlanClock(page);
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await beginPlanFromAdd(page, "I have a biology test next Friday on cellular respiration.");

  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  const generated = await (await buildPlanFromSchedule(page)).json() as {plan:LearningPlan};
  const grouped = page.getByRole("region", {name:"Plan grouped by topic"});
  await expect(grouped).toBeVisible();
  await expect(page.getByText("Nothing is active until you save this plan.")).toBeVisible();
  expect(generated.plan.sourceMode).toBe("yova_generated");
  expect(generated.plan.studyMode).toBe("inside_yova");
  expect(generated.plan.knowledgeMap!.topics.length).toBeGreaterThan(0);
  expect(generated.plan.sessions.length).toBeGreaterThan(0);
  await expect(grouped).toContainText(`${generated.plan.sessions.length} blocks`);
  await expect(grouped).toContainText(generated.plan.planModel!.personalizationSentence);
  await page.getByRole("button", { name: "Edit plan",exact:true }).click();
  const editor=page.getByRole("region",{name:"Edit plan",exact:true});
  await editor.getByLabel("Day for window 1").selectOption("Sunday");
  await editor.getByLabel("Time for Sunday",{exact:true}).selectOption("Evening");
  await editor.getByRole("button",{name:"Preview changes",exact:true}).click();
  const schedulePreview=page.getByRole("region",{name:"Plan change preview"});
  const savedResponse=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/plans/adjust"&&response.request().postDataJSON().action==="apply");
  await schedulePreview.getByRole("button",{name:"Confirm changes",exact:true}).click();
  const reviewed=(await(await savedResponse).json() as {plan:LearningPlan}).plan;
  const reviewedMethods=reviewed.sessions.map(session=>session.method);
  const reviewedMethodReasons=reviewed.sessions.map(session=>session.methodReason);
  expect(reviewedMethods.length).toBeGreaterThan(0);
  expect(reviewedMethods.every(method=>method.length>0)).toBe(true);
  expect(reviewedMethodReasons.every(reason=>reason.length>0)).toBe(true);
  await expandGroupedPlanTopics(page);
  for(const session of reviewed.sessions)await expect(page.locator(`[data-block-id="${session.id}"]`)).toContainText(session.method);
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("button", { name:"Start next block",exact:true })).toBeVisible();
  const persistedMethodContract = await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) throw new Error("Expected the activated multi-session plan in preview storage.");
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    const plan = snapshot.plans?.at(-1);
    if (!plan) throw new Error("Expected the latest activated multi-session plan.");
    return plan.sessions.map((session) => ({
      method: session.method,
      methodReason: session.methodReason,
      routeMethod: session.studyRoute?.approach.visibleMethodName ?? null,
      lifecycle: session.studyRoute?.identity.lifecycleStatus ?? null,
      selectedBy: session.studyRoute?.agency.selectedBy ?? null,
      ruleIds: session.studyRoute?.provenance.ruleTrace.map((entry) => entry.ruleId) ?? [],
    }));
  });
  expect(persistedMethodContract.map((session) => session.method)).toEqual(reviewedMethods);
  expect(persistedMethodContract.map((session) => session.methodReason)).toEqual(reviewedMethodReasons);
  expect(persistedMethodContract.every((session) => (
    session.routeMethod === session.method
    && session.lifecycle === "committed"
    && session.selectedBy === "yova"
    && session.ruleIds.includes("initial_plan_method_routing_v1")
    && session.ruleIds.includes("canonical_method_selection_v1")
  ))).toBe(true);

  const actionHeights = await page.locator(".learning-hero-actions .button").evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  expect(actionHeights.every(height => height >= 44 && height <= 80)).toBe(true);
  await page.locator(".learning-hero-actions").screenshot({ path: testInfo.outputPath("plan-actions.png") });

  const initialSessionCount = await page.locator("[data-block-id]").count();
  expect(initialSessionCount).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Edit plan", exact: true }).click();
  const activeEditor=page.getByRole("region",{name:"Edit plan",exact:true});
  const removeWindow=activeEditor.getByRole("button",{name:/^Remove window/});
  while(await removeWindow.count()>1)await removeWindow.last().click();
  await activeEditor.getByLabel("Day for window 1").selectOption("Thursday");
  await activeEditor.getByLabel("Time for Thursday",{exact:true}).selectOption("Evening");
  await activeEditor.getByLabel("Minutes for Thursday",{exact:true}).fill("15");
  const capacityResponse=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/plans/adjust"&&response.request().postDataJSON().action==="preview");
  await activeEditor.getByRole("button",{name:"Preview changes",exact:true}).click();
  const activePreview = page.getByRole("region", { name: "Plan change preview" });
  const capacity=await(await capacityResponse).json() as {proposal:{canApply:boolean;before:LearningPlan;after:LearningPlan}};
  // Availability may move the full queue beyond the deadline. It must never
  // silently discard topics or fake a completion when a short window is chosen.
  expect(capacity.proposal.after.knowledgeMap!.topics).toEqual(capacity.proposal.before.knowledgeMap!.topics);
  expect(capacity.proposal.after.sessions.every(session=>session.status!=="complete")).toBe(true);
  if(!capacity.proposal.canApply){
    await expect(activePreview).toContainText(/Move a block|Shorten scope|Add time/);
    await expect(activePreview.getByRole("button",{name:"Confirm changes"})).toBeDisabled();
    expect(capacity.proposal.after.sessions).toEqual(capacity.proposal.before.sessions);
  } else {
    await expect(activePreview.getByRole("button",{name:"Confirm changes"})).toBeEnabled();
    expect(capacity.proposal.after.sessions).toHaveLength(capacity.proposal.before.sessions.length);
  }
  await activePreview.getByRole("button", { name: "Cancel", exact: true }).click();
  const adjustedDurations = await page.locator("[data-block-id] > p").allTextContents();
  expect(adjustedDurations).toHaveLength(initialSessionCount);
  const planClock = await page.evaluate(() => {
    const snapshot = JSON.parse(window.localStorage.getItem("yova.preview.v1")!) as { plans: LearningPlan[] };
    const plan = snapshot.plans.at(-1)!;
    return {
      deadline: plan.deadline,
      deadlineLocal: new Intl.DateTimeFormat("en-CA").format(new Date(plan.deadline!)),
      createdAt: plan.createdAt,
      committedAt: plan.sessions.map((session) => session.studyRoute?.identity.committedAt),
    };
  });
  expect(planClock.deadlineLocal).toBe("2026-09-04");
  expect(planClock.createdAt).toBe(PLAN_FIXED_NOW.toISOString());
  expect(planClock.committedAt.every((at) => at === PLAN_FIXED_NOW.toISOString())).toBe(true);
  const clockEvidence = { initialSessionCount, adjustedSessionCount: adjustedDurations.length, ...planClock };
  await testInfo.attach("plan-clock-evidence", {
    body: JSON.stringify(clockEvidence),
    contentType: "application/json",
  });
  console.log("Plan clock evidence:", JSON.stringify(clockEvidence));
  await expect(page.getByRole("region",{name:"Plan grouped by topic"})).toContainText("0 done");

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  const tutorContext = page.getByRole("combobox", { name: "Ask YOVA context" });
  await expect(tutorContext).toHaveValue("general");
  await expect(tutorContext.locator("option").nth(1)).toContainText(reviewed.title);
  await tutorContext.selectOption({ index: 1 });
  await expect(page.getByText("Using learning context")).toBeVisible();
  await expect(page.getByText("YOVA can use this goal's materials, next session, and learner evidence.")).toBeVisible();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ask YOVA context" })).toHaveValue("general");

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const moveOverdue = page.getByRole("button", { name: "Move to tomorrow" });
  if (await moveOverdue.isVisible()) await moveOverdue.click();
  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
  const adjustmentTools = page.locator("details.agenda-adjustment-tools");
  if (!(await adjustmentTools.getAttribute("open"))) await adjustmentTools.locator("summary").click();
  await expect(adjustmentTools).toContainText("You stay in control");
  await adjustmentTools.getByLabel("Minutes available today").fill("15");
  await adjustmentTools.getByLabel("What changed? Optional").fill("Only a short window is available today");
  await expectNoHorizontalOverflow(page, ".agenda-capacity-planner");
  await adjustmentTools.getByRole("button", { name: "Review options" }).click();
  const proposal = adjustmentTools.locator(".agenda-capacity-options");
  await expect(proposal).toContainText("PROPOSED ADJUSTMENT");
  await expect(proposal).toContainText(
    /Nothing needs to move|Today already fits|Move one unfinished block|Shorten one safe content block|No safe automatic change/,
  );
});

test("archived, draft, and deleted-plan projections stay out of current-work surfaces", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as Record<string, unknown>;
    const now = new Date();
    // Keep the fixture on the currently selected Calendar day even when the
    // suite runs late at night. Adding an hour can cross midnight and hide the
    // otherwise-valid active session on tomorrow's card.
    const scheduledFor = now.toISOString();
    const dueAt = new Date(now.getTime() + 2 * 60 * 60 * 1_000).toISOString();
    const createdAt = new Date(now.getTime() - 60 * 60 * 1_000).toISOString();
    const session = (id: string, title: string) => ({
      id,
      sequence: 1,
      title,
      objective: `Finish ${title}`,
      method: "Guided learning",
      methodReason: "Visibility regression fixture",
      scheduledFor,
      estimatedMinutes: 25,
      amountLabel: "One focused section",
      learningMode: "learn",
      status: "ready",
    });
    const plan = (id: string, learningItemId: string, title: string, status: "draft" | "active" | "archived") => ({
      id,
      learningItemId,
      title,
      topic: title,
      kind: "topic",
      deadline: dueAt,
      status,
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "learn",
      rationale: "Visibility regression fixture",
      createdAt,
      sessions: [session(`${id}-session`, `${title} session`)],
    });

    snapshot.plans = [
      plan("active-plan", "active-item", "Visible active biology plan", "active"),
      plan("archived-plan", "archived-item", "Hidden archived calculus plan", "archived"),
      plan("draft-plan", "draft-item", "Hidden draft chemistry plan", "draft"),
    ];
    snapshot.deadlineMilestones = [
      { id: "active-deadline", title: "Visible biology deadline", description: "Active linked work", dueAt, status: "open", linkedLearningItemId: "active-item", createdAt },
      { id: "archived-deadline", title: "Hidden archived deadline", description: "Archived linked work", dueAt, status: "open", linkedLearningItemId: "archived-item", createdAt },
      { id: "draft-deadline", title: "Hidden draft deadline", description: "Draft linked work", dueAt, status: "open", linkedLearningItemId: "draft-item", createdAt },
      { id: "deleted-deadline", title: "Hidden deleted-plan deadline", description: "Orphaned linked work", dueAt, status: "open", linkedLearningItemId: "deleted-item", createdAt },
    ];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
  await page.reload();

  await expect(page.getByText("Visible active biology plan").first()).toBeVisible();
  await expect(page.getByText("Hidden archived calculus plan")).toHaveCount(0);
  await expect(page.getByText("Hidden draft chemistry plan")).toHaveCount(0);

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByText("Visible active biology plan").first()).toBeVisible();
  await expect(page.getByText("Visible biology deadline").first()).toBeVisible();
  await expect(page.getByText("Hidden archived calculus plan")).toHaveCount(0);
  await expect(page.getByText("Hidden archived deadline")).toHaveCount(0);
  await expect(page.getByText("Hidden draft deadline")).toHaveCount(0);
  await expect(page.getByText("Hidden deleted-plan deadline")).toHaveCount(0);

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  const contextOptions = page.getByRole("combobox", { name: "Ask YOVA context" }).locator("option");
  await expect(contextOptions.filter({ hasText: "Visible active biology plan" })).toHaveCount(1);
  await expect(contextOptions.filter({ hasText: "Hidden archived calculus plan" })).toHaveCount(0);
  await expect(contextOptions.filter({ hasText: "Hidden draft chemistry plan" })).toHaveCount(0);

  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.getByRole("button", { name: /Archive/ }).click();
  await expect(page.getByText("Hidden archived calculus plan").first()).toBeVisible();

  await page.getByRole("button", { name: "Open goal" }).click();
  await expect(page.getByRole("heading", { name: "Hidden archived calculus plan" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Archived goal history" })).toContainText("0 of 1 sessions");
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("button", { name: /Active/ })).toHaveClass(/active/);
  await expect(page.getByText("Hidden archived calculus plan").first()).toBeVisible();

  await page.locator(".learning-goal-card").filter({ hasText: "Hidden archived calculus plan" }).getByRole("button", { name: "Open goal" }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator(".tabs").getByRole("button", { name: /Archive/ })).toHaveClass(/active/);
  await page.getByRole("button", { name: "Open goal" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  const deletionDialog = page.getByRole("dialog", { name: "Delete this archived goal?" });
  await expect(deletionDialog).toContainText("sessions, results, tutor conversation, linked deadlines, and attached materials");
  await deletionDialog.getByLabel("Type DELETE to confirm").fill("DELETE");
  await deletionDialog.getByRole("button", { name: "Permanently delete goal" }).click();
  await expect(page.getByText("Hidden archived calculus plan")).toHaveCount(0);
});

test("material setup clearly supports files, articles, and YouTube transcripts", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  // Brief 1.5 item 8: material is optional on Study Now's one screen.
  await page.getByLabel("Study Now topic or result").fill(
    "Help me understand how ecosystems respond to invasive species.",
  );
  const dropzone = page.getByLabel("Upload learning materials. Choose files or drag and drop them here.");
  await expect(dropzone).toContainText("Choose files or drag them here");
  await expect(dropzone).toContainText("PDF, TXT, or Markdown");
  await expect(page.getByRole("button", { name: /Add an article or YouTube video/ })).toBeVisible();
  await page.getByRole("button", { name: /Add an article or YouTube video/ }).click();
  await expect(page.getByRole("region", { name: "Add material from a link" })).toContainText("Public article");
  await expect(page.getByRole("region", { name: "Add material from a link" })).toContainText("YouTube transcript");
  await expect(page.getByText(/does not bypass paywalls or sign-ins/i)).toBeVisible();
});

test("material drop zone accepts drag gestures and explains rejected files", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  // Brief 1.5 item 8: material is optional on Study Now's one screen.
  await page.getByLabel("Study Now topic or result").fill(
    "Help me prepare for a World War I history test.",
  );

  const dropzone = page.getByLabel("Upload learning materials. Choose files or drag and drop them here.");
  const transfer = await page.evaluateHandle(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["history notes"], "history-notes.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }));
    return dataTransfer;
  });

  await dropzone.dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(dropzone).toHaveClass(/drag-active/);
  await expect(dropzone).toContainText("Drop files to add them");
  await dropzone.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(dropzone).not.toHaveClass(/drag-active/);
  await expect(page.getByText("history-notes.docx is not supported. Use PDF, TXT, or Markdown.")).toBeVisible();
  await transfer.dispose();

  await page.getByLabel("Choose learning materials").setInputFiles({
    name: "teacher-guide.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from("not a supported upload"),
  });
  await expect(page.getByText("teacher-guide.pptx is not supported. Use PDF, TXT, or Markdown.")).toBeVisible();
});

async function beginPlanFromAdd(page: Page, description: string) {
  await beginNormalPlan(page, description);
}

async function expectNoHorizontalOverflow(page: Page, selector: string) {
  const overflow = await page.locator(selector).first().evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
    offenders: Array.from(element.querySelectorAll<HTMLElement>("*")).map((child) => {
      const rect = child.getBoundingClientRect();
      return {
        tag: child.tagName.toLowerCase(),
        className: child.className,
        client: child.clientWidth,
        scroll: child.scrollWidth,
        width: Math.round(rect.width),
        right: Math.round(rect.right),
      };
    }).filter((item) => item.scroll > item.client + 1 || item.width > window.innerWidth + 1 || item.right > window.innerWidth + 1).slice(0, 12),
  }));
  expect(
    overflow.scroll,
    `Horizontal overflow in ${selector}: ${JSON.stringify(overflow.offenders)}`,
  ).toBeLessThanOrEqual(overflow.client + 1);
}

async function createPreviewAccount(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill("learning-loop@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Make YOVA fit how you actually study." })).toBeVisible();
}

async function completeOnboarding(page: Page) {
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();

  for (const [index, answer] of onboardingAnswers.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    const nextLabel = index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue";
    await page.getByRole("button", { name: nextLabel }).click();
  }

  await expect(page.getByRole("heading", { name: "YOVA will begin like this." })).toBeVisible();
  await page.getByRole("button", { name: "Open YOVA" }).click();
}

function recommendedLearningPlan(page: Page) {
  return page.getByRole("region", { name: "Recommended learning plan" });
}

/** Brief 1.5 item 8: Study Now's one screen builds the session and opens its pre-session card; this leaves it unstarted. */
async function createOneOffLearningSession(page: Page, request: string) {
  await page.getByRole("button", {
    name: /^(?:Study something now|Study now Quick, off-plan)$/,
  }).first().click();
  await page.getByLabel("Study Now topic or result").fill(request);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByTestId("pre-session-card").getByRole("button", { name: "Close" }).click({ timeout: 30_000 });
}
