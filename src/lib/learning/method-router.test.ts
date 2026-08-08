import { describe, expect, it } from "vitest";
import {
  buildLearningScienceRoutingBrief,
  classifyLearningTask,
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

  it.each([
    ["Understand the function of mitochondria in cellular respiration", "conceptual_learning"],
    ["Explain the function of proteins in cell membranes", "conceptual_learning"],
    ["Understand the genetic code and how codons map to amino acids", "conceptual_learning"],
    ["Learn photosynthesis from this article", "conceptual_learning"],
    ["Graph quadratic functions and solve for their roots", "problem_solving"],
    ["Calculate limiting reagent amounts in chemistry problems", "problem_solving"],
    ["Write a Python function that filters an array", "programming"],
    ["Debug a JavaScript function and test the corrected code", "programming"],
    ["Write a unit test for a TypeScript function", "programming"],
    ["Prepare for a World War I unit test by explaining the July Crisis and alliance systems", "conceptual_learning"],
    ["Read this history article and prepare for a reading quiz", "reading_to_quiz"],
    ["Summarize the assigned textbook chapter before the quiz", "reading_to_quiz"],
    ["Use imagery and passage details to support a close-reading interpretation", "reading_to_quiz"],
    ["Memorize French vocabulary definitions", "memorization"],
    ["Recall the dates and facts from the Civil War unit", "memorization"],
    ["Draft a comparative essay using the writing rubric", "writing_argumentation"],
    ["Prepare for a cumulative biology final with a practice test", "mixed_assessment"],
  ] as const)("routes %s as %s", (scenario, expectedTaskType) => {
    expect(classifyLearningTask(scenario).taskType).toBe(expectedTaskType);
  });

  it("uses the session objective instead of letting a source or old method determine the task", () => {
    const routing = buildLearningScienceRoutingBrief({
      learningIntent: "learn",
      sessionLearningMode: "learn",
      goalTitle: "Photosynthesis article",
      goalTopic: "Learn how light-dependent reactions produce energy carriers",
      goalKind: "topic",
      sessionTitle: "Build the photosynthesis model",
      sessionObjective: "Explain how light energy becomes chemical energy and why each stage matters",
      plannedMethod: "Read-recall-review",
      plannedMethodReason: "The source is an article.",
      learnerProfile: null,
      recentResults: [],
      interruptionCount: 0,
    });

    expect(routing.taskType).toBe("conceptual_learning");
    expect(routing.allowedMethodIds).toContain("self_explanation");
    expect(routing.decisionBasis[0]).toMatch(/understanding|how or why reasoning/i);
  });

  it("does not label first instruction as a practice-only method", () => {
    const routing = buildLearningScienceRoutingBrief({
      learningIntent: "learn",
      sessionLearningMode: "learn",
      goalTitle: "Cellular respiration",
      goalTopic: "Understand how cellular respiration produces ATP",
      goalKind: "topic",
      sessionTitle: "Build the cellular respiration model",
      sessionObjective: "Explain how the stages connect and why each stage matters",
      plannedMethod: "Closed-note retrieval",
      plannedMethodReason: "The original plan named a review method.",
      learnerProfile: null,
      recentResults: [],
      interruptionCount: 0,
    });

    expect(routing.knowledgeStage).toBe("novice");
    expect(routing.suggestedPrimaryMethodId).toBe("self_explanation");
    expect(routing.allowedMethodIds).not.toContain("retrieval_practice");
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
