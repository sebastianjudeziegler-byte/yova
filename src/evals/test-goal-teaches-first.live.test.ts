import { describe, expect, test, vi } from "vitest";
import { resolveLearningIntent } from "@/lib/learning/learning-intent";
import { emptyOnboardingAnswers } from "@/lib/onboarding/answers";
import { generatePlanKnowledgeMap } from "@/lib/knowledge-map/generate-plan-map";
import { composeNormalPlanEnvelopes } from "@/lib/plan-generation/normal-plan-envelopes";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
import { generateNormalPlanFillWithOpenAI } from "@/lib/openai/normal-plan-fill-generator";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";

vi.mock("server-only", () => ({}));

/**
 * Brief 2.5 root cause 1, permanent. A goal that mentions a test once routed
 * every topic to practice ("Teaching skipped"): fixed 7 Sept in the old
 * composer, then inherited by the new one. This drives the real chain - intent
 * from the goal, a provider-generated topic map, the composer, the provider
 * fill - for a plain test-prep goal with no placement and no ticks, and
 * requires every scheduled topic to open with a learn block.
 */
const now = new Date("2026-09-19T08:00:00Z");
const methodContext = { profileVersion: "brief_2_5_test_goal_v1", observedEvidence: [], personalization: {
  decisions: [], methodTie: { state: { controls: { experiments: false }, activeExperiment: null, experimentHistory: [] }, signals: [] },
} };

describe.skipIf(process.env.YOVA_RUN_LIVE_TEST_GOAL_TEACHES !== "1")("live test-prep goal still teaches", () => {
  test.each([
    "I have a biology test next Friday on cell respiration",
    "Prepare for my AP Biology Unit 6 test on gene expression",
  ])("every untouched topic opens with a learn block: %s", async (goal) => {
    const learningIntent = resolveLearningIntent({ goal });
    expect(learningIntent.intent, "the goal sentence is not evidence about the learner").toBe("learn");
    const base = PlanGenerationRequestSchema.parse({
      intent: "plan", learningIntent: learningIntent.intent, goal, materialMode: "none", materials: [],
      studyMode: "inside", deadline: "2026-09-26T20:00:00.000Z", timeZone: "UTC", diagnosticResponses: [],
      availability: [{ day: "Every day", window: "Evening", minutes: 45 }],
      profileSummary: "Use my saved learner profile.",
    });
    const { map } = await generatePlanKnowledgeMap(base);
    const request = { ...base, knowledgeMap: { ...map, placementCheck: { status: "skipped" as const, completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] } } };
    expect(request.knowledgeMap.topics.every(topic => topic.status === "not_started" && !topic.initialEvidence)).toBe(true);
    const composition = composeNormalPlanEnvelopes({
      request, now,
      learningIntentRecommendation: { intent: request.learningIntent, basis: learningIntent.reason },
      durationContext: {
        profileVersion: "brief_2_5_test_goal_v1",
        profile: { sustainableMinutes: 45, preferredWindow: null, fatigueRisk: null, startingFrictionRisk: null, evidenceRefs: { sustainableMinutes: [], preferredWindow: [], fatigueRisk: [], startingFrictionRisk: [] } },
        recentOutcomes: [], onboardingAnswers: emptyOnboardingAnswers(),
      },
    });
    const { fill } = await generateNormalPlanFillWithOpenAI({ request, composition, now });
    const plan = buildNormalPlanFromFixedEnvelope({ request, composition, now, fill, methodContext });

    const scheduled = plan.knowledgeMap!.topics.filter(topic => plan.sessions.some(session => session.topicIds?.includes(topic.id)));
    expect(scheduled.length, "a test-prep plan schedules its topics").toBeGreaterThan(0);
    for (const topic of scheduled) {
      const first = plan.sessions.find(session => session.topicIds?.includes(topic.id));
      expect(first?.learningMode, `first block for "${topic.title}"`).toBe("learn");
    }
  }, 240_000);
});
