import { describe, expect, it } from "vitest";
import {
  buildLearningScienceRoutingBrief,
  inferKnowledgeStage,
  inferLearningTaskType,
  methodIdFromText,
  validateLearningScienceRoutingSelection,
} from "@/lib/learning/method-router";

describe("learning-science method router", () => {
  it("classifies the task before considering learner delivery preferences", () => {
    const routing = buildLearningScienceRoutingBrief({
      learningIntent: "study",
      sessionLearningMode: "study",
      goalTitle: "Calculus derivatives",
      goalTopic: "Solve product-rule and quotient-rule problems",
      goalKind: "skill",
      sessionTitle: "Repair quotient-rule setup",
      sessionObjective: "Study one worked solution and solve a similar derivative independently",
      plannedMethod: "Worked example fading, then retrieval",
      plannedMethodReason: "The prior check showed a setup error.",
      learnerProfile: {
        commonBlocker: "Large tasks feel difficult to start",
        guidancePreference: "Show one step at a time",
        explanationPreference: "One concrete example first",
        focusFrequency: null,
        startingPattern: null,
        primaryImprovementGoal: "Solve independently",
        processingPreference: "A concrete example before the rule",
        memoryChallenge: "I understand it but cannot apply it",
        supportPreference: "Give me a small hint first",
        workspacePreference: "Show one step at a time",
        freeformContext: "I can copy steps without knowing when to use the rule.",
        observationCorrection: null,
      },
      recentResults: [{ correctAnswers: 1, totalAnswers: 4 }],
      interruptionCount: 0,
    });

    expect(routing.taskType).toBe("problem_solving");
    expect(routing.suggestedPrimaryMethodId).toBe("worked_example_fading");
    expect(routing.deliveryModifiers.join(" ")).toMatch(/five minutes|one visible step|concrete example/i);
    expect(routing.deliveryModifiers.join(" ")).toMatch(/independent application|smallest useful hint/i);
  });

  it("moves repeated strong performance toward independent mixed assessment", () => {
    expect(inferKnowledgeStage([
      { correctAnswers: 4, totalAnswers: 5 },
      { correctAnswers: 5, totalAnswers: 5 },
    ], "final review")).toBe("retrieval_ready");
  });

  it("recognizes the core task and method families", () => {
    expect(inferLearningTaskType("Draft a comparative essay thesis from a rubric")).toBe("writing_argumentation");
    expect(inferLearningTaskType("Trace a JavaScript array function")).toBe("programming");
    expect(methodIdFromText("Closed-note retrieval with spaced review")).toBe("spaced_retrieval");
  });

  it("rejects a model-generated task label that contradicts the deterministic router", () => {
    const routing = buildLearningScienceRoutingBrief({
      learningIntent: "learn",
      sessionLearningMode: "study",
      goalTitle: "Calculus product rule",
      goalTopic: "Recognize products of functions and differentiate them",
      goalKind: "skill",
      sessionTitle: "Product rule recognition",
      sessionObjective: "Choose when the product rule applies and solve one derivative",
      plannedMethod: "Worked example fading",
      plannedMethodReason: "Move from recognition to independent application.",
      learnerProfile: null,
      recentResults: [],
      interruptionCount: 0,
    });

    expect(routing.taskType).toBe("problem_solving");
    expect(validateLearningScienceRoutingSelection({
      taskType: "writing_argumentation",
      methodId: "practice_test_error_repair",
      learningMode: "study",
    }, routing)).toMatch(/deterministic task router/i);
  });
});
