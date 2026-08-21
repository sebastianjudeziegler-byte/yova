import { describe, expect, test, vi } from "vitest";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";
import { StreamedGeneratedSessionDraftSchema } from "@/lib/session-generation/schema";

vi.mock("server-only", () => ({}));

const liveEvaluationEnabled = process.env.YOVA_RUN_LIVE_RAYLEIGH_EVALS === "1";

export function rayleighStreamedEvaluationContext(): SessionGenerationContext {
  const scatteringTopicId = "61111111-1111-4111-8111-111111111111";
  const blueSkyTopicId = "62222222-2222-4222-8222-222222222222";

  return {
    sessionArchitectureVersion: "streamed_teaching_v1",
    learningGoal: {
      title: "Understand why the sky is blue using Rayleigh scattering",
      topic: "I want to understand why the sky is blue using Rayleigh scattering, and explain why sunsets look red.",
      kind: "topic",
      deadline: null,
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "learn",
    },
    planRationale: "Build a physical model of atmospheric light scattering before requiring an explanation from memory.",
    knowledgeTopics: [
      {
        id: scatteringTopicId,
        title: "Light scattering in the atmosphere",
        description: "How sunlight interacts with air molecules and gets redirected in different directions.",
        subtopics: ["sunlight", "air molecules", "wavelength-dependent scattering"],
        prerequisiteTopicIds: [],
        status: "not_started",
        initialEvidence: null,
        sourceReferences: [],
        origin: "ai_generated",
        deferred: null,
        curriculumReference: null,
      },
      {
        id: blueSkyTopicId,
        title: "Why the sky looks blue during the day",
        description: "How Rayleigh scattering makes blue light arrive from all directions in the sky.",
        subtopics: ["Rayleigh scattering", "short wavelengths", "diffuse blue light"],
        prerequisiteTopicIds: [scatteringTopicId],
        status: "not_started",
        initialEvidence: null,
        sourceReferences: [],
        origin: "ai_generated",
        deferred: null,
        curriculumReference: null,
      },
    ],
    journey: {
      currentSequence: 1,
      totalSessions: 1,
      previousSessions: [],
      nextSessions: [],
    },
    session: {
      title: "Learn Light scattering in the atmosphere and 1 connected topic",
      objective: "Explain how wavelength-dependent scattering by air molecules makes the daytime sky look blue.",
      method: "Self-explanation with worked example fading",
      methodReason: "A concise causal model should come before independent explanation.",
      estimatedMinutes: 15,
      learningMode: "learn",
      topicIds: [scatteringTopicId, blueSkyTopicId],
      contentTargets: [
        "Light scattering in the atmosphere",
        "Why the sky looks blue during the day",
      ],
      completionEvidence: [
        "Explain why shorter wavelengths are scattered more strongly by air molecules",
        "Explain why scattered blue light reaches an observer from across the sky",
      ],
      reviewConcept: null,
      reviewType: null,
    },
    learnerProfile: null,
    recentResults: [],
    recentInterruptions: [],
    conceptSignals: [],
    scaffoldSignals: [],
    topicCalibrationSignals: [],
    materials: [],
    sessionAdjustment: null,
  };
}

describe.skipIf(!liveEvaluationEnabled)("live streamed Rayleigh-scattering session", () => {
  test("builds the production 15-minute two-target teaching skeleton", async () => {
    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const context = rayleighStreamedEvaluationContext();

    const requestedRunCount = Number.parseInt(
      process.env.YOVA_LIVE_RAYLEIGH_RUN_COUNT ?? "1",
      10,
    );
    const runCount = Number.isFinite(requestedRunCount)
      ? Math.min(5, Math.max(1, requestedRunCount))
      : 1;

    for (let run = 1; run <= runCount; run += 1) {
      try {
        const result = await generateProductionSessionWithOpenAI(context);
        const draft = StreamedGeneratedSessionDraftSchema.parse(result.draft);
        console.info("Rayleigh streamed skeleton", {
          run,
          generationStats: result.generationStats,
          coverage: draft.coverage,
          activities: draft.activities.map((activity) => ({
            type: activity.type,
            phase: activity.methodPhase,
            concept: activity.concept,
            minutes: activity.estimatedMinutes,
            ideas: activity.lessonBrief?.essentialIdeas ?? [],
          })),
        });

        expect(draft.coverage.essentialIdeas).toHaveLength(2);
        expect(draft.coverage.deferredContent).not.toContain(
          "Why sunsets look red and orange",
        );
        expect(draft.activities.some((activity) => (
          activity.type === "free_response" && activity.requiredForCompletion
        ))).toBe(true);
      } catch (error) {
        console.info("Rayleigh streamed skeleton failure", {
          run,
          message: error instanceof Error ? error.message : String(error),
          generationStats: error && typeof error === "object" && "generationStats" in error
            ? error.generationStats
            : null,
        });
        throw error;
      }
    }
  }, 180_000);
});
