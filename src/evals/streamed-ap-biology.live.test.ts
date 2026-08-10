import { describe, expect, test, vi } from "vitest";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";
import {
  CachedGeneratedSessionV16Schema,
  StreamedGeneratedSessionDraftSchema,
} from "@/lib/session-generation/schema";

vi.mock("server-only", () => ({}));

const liveEvaluationEnabled = process.env.YOVA_RUN_LIVE_STREAMED_EVALS === "1";

describe.skipIf(!liveEvaluationEnabled)("live streamed AP Biology session", () => {
  test("builds a topic-specific teaching skeleton", async () => {
    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const topicId = "33333333-3333-4333-8333-333333333333";
    const context: SessionGenerationContext = {
      sessionArchitectureVersion: "streamed_teaching_v1",
      learningGoal: {
        title: "AP Biology Unit 2",
        topic: "Cell structure, membranes, organelles, and transport in AP Biology Unit 2",
        kind: "test",
        deadline: null,
        sourceMode: "yova_generated",
        studyMode: "inside_yova",
        learningIntent: "learn",
      },
      planRationale: "Teach cell structure and membrane transport from first principles before requiring independent recall.",
      knowledgeTopics: [{
        id: topicId,
        title: "Cell membrane structure and transport",
        description: "How phospholipid bilayers and membrane proteins control movement across cell membranes.",
        subtopics: ["phospholipid bilayer", "selective permeability", "passive and active transport"],
        prerequisiteTopicIds: [],
        status: "not_started",
        initialEvidence: null,
        sourceReferences: [],
        origin: "ai_generated",
        deferred: null,
        curriculumReference: null,
      }],
      journey: {
        currentSequence: 1,
        totalSessions: 4,
        previousSessions: [],
        nextSessions: [{
          sequence: 2,
          title: "Apply transport mechanisms",
          objective: "Compare diffusion, osmosis, facilitated diffusion, and active transport in biological examples.",
          contentTargets: ["Compare passive and active transport mechanisms"],
        }],
      },
      session: {
        title: "Build a model of cell membranes",
        objective: "Explain how membrane structure creates selective permeability and distinguish passive from active transport.",
        method: "Guided explanation and self-explanation",
        methodReason: "A novice needs a coherent model before retrieval and application.",
        estimatedMinutes: 25,
        learningMode: "learn",
        topicIds: [topicId],
        contentTargets: [
          "Explain how phospholipid structure creates selective permeability",
          "Distinguish passive and active transport",
        ],
        completionEvidence: [
          "Explain selective permeability and correctly classify one transport example",
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

    const result = await generateProductionSessionWithOpenAI(context);

    const streamedDraft = StreamedGeneratedSessionDraftSchema.parse(result.draft);

    expect(streamedDraft.activities[0]?.type).toBe("instruction");
    expect(streamedDraft.activities[0]?.lessonBrief).not.toBeNull();
    expect(streamedDraft.activities.every((activity) => (
      activity.topicId === topicId || activity.topicId === null
    ))).toBe(true);
    expect(JSON.stringify(streamedDraft)).not.toMatch(/cellular respiration|glycolysis/i);
    expect(() => CachedGeneratedSessionV16Schema.parse({
      schemaVersion: 16,
      ...streamedDraft,
      routingContext: result.routingContext,
      supportPlan: result.supportPlan,
      deliveryPolicy: result.deliveryPolicy,
      deliveryInstructions: result.deliveryInstructions,
      model: result.model,
      generatedAt: new Date().toISOString(),
    })).not.toThrow();
  }, 90_000);

});
