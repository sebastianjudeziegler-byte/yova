import { describe, expect, it } from "vitest";
import {
  buildLearningScienceRoutingBrief,
  inferKnowledgeStage,
  inferLearningTaskType,
  methodIdFromText,
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
      },
      recentResults: [{ correctAnswers: 1, totalAnswers: 4 }],
      interruptionCount: 0,
    });

    expect(routing.taskType).toBe("problem_solving");
    expect(routing.suggestedPrimaryMethodId).toBe("worked_example_fading");
    expect(routing.deliveryModifiers.join(" ")).toMatch(/five minutes|one visible step|concrete example/i);
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
});
