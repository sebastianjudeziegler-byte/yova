import { describe, expect, test, vi } from "vitest";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";

vi.mock("server-only", () => ({}));

const liveEvaluationEnabled = process.env.YOVA_RUN_LIVE_OUTSIDE_TEACHING_EVALS === "1";

function outsideTeachingContext(): SessionGenerationContext {
  const topicIds = [
    "81111111-1111-4111-8111-111111111111",
    "82222222-2222-4222-8222-222222222222",
    "83333333-3333-4333-8333-333333333333",
  ];
  const titles = [
    "Demand curve versus quantity demanded",
    "Supply curve versus quantity supplied",
    "Factors that shift demand and supply",
  ];

  return {
    sessionArchitectureVersion: "streamed_teaching_v1",
    learningGoal: {
      title: "Understand how supply and demand curves shift",
      topic: "I want to understand how supply and demand curves shift using my economics textbook.",
      kind: "topic",
      deadline: null,
      sourceMode: "yova_generated",
      studyMode: "outside_yova",
      learningIntent: "learn",
    },
    planRationale: "Build a causal model of curve movement before asking for independent explanation and application in the learner's textbook.",
    materials: [],
    knowledgeTopics: titles.map((title, index) => ({
      id: topicIds[index]!,
      title,
      description: [
        "Distinguish a movement along a demand curve from a shift of the demand curve.",
        "Distinguish a movement along a supply curve from a shift of the supply curve.",
        "Explain how non-price determinants shift demand or supply and predict the direction.",
      ][index]!,
      subtopics: index === 0
        ? ["demand", "quantity demanded", "own price"]
        : index === 1
          ? ["supply", "quantity supplied", "own price"]
          : ["income", "preferences", "input costs", "expectations"],
      prerequisiteTopicIds: index === 0 ? [] : [topicIds[index - 1]!],
      status: "not_started" as const,
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated" as const,
      deferred: null,
      curriculumReference: null,
    })),
    journey: {
      currentSequence: 1,
      totalSessions: 1,
      previousSessions: [],
      nextSessions: [],
    },
    session: {
      title: "Learn Demand curve versus quantity demanded and 2 connected topics",
      objective: "Use a trusted economics source to distinguish curve movement from curve shifts and explain how non-price factors shift demand and supply.",
      method: "Self-explanation",
      methodReason: "A correct causal model should precede independent application.",
      estimatedMinutes: 25,
      learningMode: "learn",
      topicIds,
      contentTargets: titles,
      completionEvidence: [
        "Explain the difference between a curve movement and a curve shift.",
        "Classify one demand-side and one supply-side change correctly.",
        "Explain the direction of each shift without reopening the source.",
      ],
      reviewConcept: null,
      reviewType: null,
    },
    learnerProfile: {
      commonBlocker: "I get distracted when a task has too many visible transitions.",
      guidancePreference: "Show one visible step at a time.",
      explanationPreference: "Give one concrete example before the rule.",
      focusFrequency: "Usually studies in twenty-five-minute sessions.",
      startingPattern: "Starts more consistently when the first action is small.",
      primaryImprovementGoal: "Explain and apply ideas without copying the source.",
      memoryChallenge: "I forget relationships after a few days.",
      supportPreference: "Break a stuck point into smaller steps.",
      workspacePreference: "Show one step at a time.",
    },
    sessionAdjustment: null,
    recentResults: [],
    recentInterruptions: [],
    conceptSignals: [],
    scaffoldSignals: [],
    topicCalibrationSignals: [],
  };
}

describe.skipIf(!liveEvaluationEnabled)("live outside-YOVA teaching reliability", () => {
  test("builds an arbitrary three-target teaching-first session repeatedly", async () => {
    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const failures: unknown[] = [];

    for (let run = 1; run <= 3; run += 1) {
      try {
        const generated = await generateProductionSessionWithOpenAI(outsideTeachingContext());
        console.info("Outside teaching generation", { run, generationStats: generated.generationStats });
      } catch (error) {
        const generationStats = error && typeof error === "object" && "generationStats" in error
          ? error.generationStats
          : null;
        console.info("Outside teaching failure", {
          run,
          message: error instanceof Error ? error.message : String(error),
          generationStats,
        });
        failures.push({ run, generationStats });
      }
    }

    expect(failures).toEqual([]);
  }, 240_000);
});
