import { describe, expect, test, vi } from "vitest";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { buildPreviewSessionContext } from "@/lib/session-generation/preview-context";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { selectCanonicalStudyMethod } from "@/lib/learning/canonical-method-selection";
import { methodSelectionContextForStudyRoute } from "@/lib/study-route/method-plan-integration";
import { writeFileSync } from "node:fs";
import { liveFixturePath } from "@/evals/live-fixtures";

vi.mock("server-only", () => ({}));

const journeys = [
  { id: "calculus", minutes: 10, intent: "learn", goal: "Help me understand why the product rule has two derivative terms, then practice differentiating x squared times sin x." },
  { id: "osmosis", minutes: 25, intent: "learn", goal: "Help me understand how osmosis moves water across a cell membrane, using a simple example, then check my understanding." },
  { id: "recall", minutes: 15, intent: "study", goal: "Quiz me on the order and locations of glycolysis, the Krebs cycle, and the electron transport chain in cellular respiration." },
];

describe.skipIf(process.env.YOVA_RUN_LIVE_LAUNCH_EVALS !== "1")("launch session journeys with committed recipes", () => {
  test.each(journeys.filter((journey) => !process.env.YOVA_LAUNCH_CASE || journey.id === process.env.YOVA_LAUNCH_CASE))("$id", async (journey) => {
    const { generatePlanKnowledgeMap } = await import("@/lib/knowledge-map/generate-plan-map");
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");
    const request = PlanGenerationRequestSchema.parse({
      intent: "study_now", learningIntent: journey.intent, goal: journey.goal,
      materialMode: "none", materials: [], studyMode: "inside", timeZone: "Europe/London",
      diagnosticResponses: [{ question: "Where are you starting?", answer: journey.intent === "learn" ? "I haven't learned this yet" : "I know it and want to test my recall", evaluation: "self_report" }],
      availability: [{ day: "Monday", window: "Now", minutes: journey.minutes }],
      profileSummary: "No established learning preferences.",
    });
    request.knowledgeMap = (await generatePlanKnowledgeMap(request)).map;
    const initial = generatePreviewPlan(request);
    const route = initial.sessions[0]!.studyRoute!;
    const plan = commitPlanStudyRoutes(generatePreviewPlan(request, new Date(), {
      studyNowMethodDecision: {
        selection: selectCanonicalStudyMethod(methodSelectionContextForStudyRoute(route)),
        profileVersion: "launch-regression-v1",
      },
    }), new Date().toISOString());
    const context = { ...buildPreviewSessionContext({ plan, session: plan.sessions[0]!, onboardingAnswers: [], completions: [], interruptions: [] }), materials: [] };
    writeFileSync(liveFixturePath("launch", `${journey.id}-context.json`), JSON.stringify(context, null, 2));
    try {
      const result = await generateProductionSessionWithOpenAI(context);
      writeFileSync(liveFixturePath("launch", `${journey.id}-result.json`), JSON.stringify(result, null, 2));
      console.info(journey.id, result.generationStats, result.draft.methodBriefing.methodId);
      expect(result.draft.activities.some((activity) => activity.type === "free_response")).toBe(true);
      expect(result.draft.methodBriefing.methodId).toBe(context.studyRoute!.approach.primaryMethodId);
    } catch (error) {
      console.error(journey.id, error);
      throw error;
    }
  }, 120_000);
});
