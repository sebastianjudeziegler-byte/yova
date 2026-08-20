import { describe, expect, it } from "vitest";
import { learningModeContract } from "@/lib/learning/learning-intent";
import type { LearningScienceRoutingBrief } from "@/lib/learning/method-router";
import {
  applyPersonalizedMethodTieToRouting,
  personalizationDecisions,
  type GenerationPersonalizationContext,
} from "@/lib/personalization/personalization-generation";

function routing(
  allowedMethodIds: LearningScienceRoutingBrief["allowedMethodIds"],
): LearningScienceRoutingBrief {
  return {
    learningIntent: "study",
    sessionLearningMode: "study",
    taskType: "memorization",
    knowledgeStage: "developing",
    suggestedPrimaryMethodId: allowedMethodIds[0]!,
    allowedMethodIds,
    methodFit: null,
    methods: [],
    deliveryModifiers: [],
    decisionBasis: ["The task router supplied the valid methods."],
    guardrails: [],
    executionContract: learningModeContract("study"),
  };
}

function personalization(
  code = "delayed_forgetting",
): GenerationPersonalizationContext {
  return {
    decisions: [],
    methodTie: {
      state: {
        controls: { experiments: false },
        activeExperiment: null,
        experimentHistory: [],
      },
      signals: [{
        id: "signal:memory_breakdown",
        key: "memory_breakdown",
        title: "Rewordable display title",
        code,
        evidenceLabel: "You told YOVA",
        paused: false,
      }],
    },
  };
}

describe("generation personalization", () => {
  it("enforces a personalized tie only as a subset of the task router list", () => {
    const taskRouting = routing(["retrieval_practice", "spaced_retrieval"]);
    const selected = applyPersonalizedMethodTieToRouting(
      taskRouting,
      personalization(),
    );

    expect(selected.suggestedPrimaryMethodId).toBe("spaced_retrieval");
    expect(selected.allowedMethodIds).toEqual(["spaced_retrieval"]);
    expect(selected.allowedMethodIds.every((methodId) => (
      taskRouting.allowedMethodIds.includes(methodId)
    ))).toBe(true);
    expect(selected.decisionBasis.at(-1)).toMatch(/personalization tie-break/i);
  });

  it("leaves routing unchanged when the preferred method is not task-valid", () => {
    const taskRouting = routing(["self_explanation", "worked_example_fading"]);

    expect(applyPersonalizedMethodTieToRouting(
      taskRouting,
      personalization(),
    )).toBe(taskRouting);
  });

  it("does not let a paused signal choose a method", () => {
    const context = personalization();
    context.methodTie.signals[0]!.paused = true;
    const taskRouting = routing(["retrieval_practice", "spaced_retrieval"]);

    expect(applyPersonalizedMethodTieToRouting(taskRouting, context)).toBe(taskRouting);
  });

  it("applies personal-test decisions only to their approved task and stage", () => {
    const context = personalization();
    context.decisions = [{
      id: "decision:experiment:workspace-test:a",
      artifact: "workspace",
      setting: "layout",
      value: "one_step",
      title: "Personal test: one step",
      explanation: "Use one step for the next comparable session, then compare the checked result cautiously.",
      signalIds: ["experiment:workspace-test"],
      evidenceLabel: "You told YOVA",
      methodCandidates: [],
      experimental: true,
    }];
    context.methodTie.state.controls.experiments = true;
    context.methodTie.state.activeExperiment = {
      id: "workspace-test",
      variable: "workspace",
      variantA: "one_step",
      variantB: "full_path",
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
      nextVariant: "a",
    };
    const matching = {
      ...routing(["self_explanation", "retrieval_practice"]),
      taskType: "conceptual_learning" as const,
      knowledgeStage: "novice" as const,
    };
    const unrelated = {
      ...matching,
      taskType: "problem_solving" as const,
    };

    expect(personalizationDecisions(context, matching)).toHaveLength(1);
    expect(personalizationDecisions(context, unrelated)).toEqual([]);
    context.methodTie.state.controls.experiments = false;
    expect(personalizationDecisions(context, matching)).toEqual([]);
  });

  it("does not reuse a paused or disabled completed method-tie winner", () => {
    const context = personalization();
    context.methodTie.state.controls.experiments = true;
    context.methodTie.state.experimentHistory = [{
      id: "method-test",
      variable: "method_tie",
      variantA: "spaced_retrieval",
      variantB: "retrieval_practice",
      taskType: "memorization",
      knowledgeStage: "developing",
      result: "promising_a",
    }];
    context.methodTie.signals = [{
      id: "experiment:method-test",
      key: "experiment_result",
      title: "Personal test",
      code: "spaced_retrieval",
      evidenceLabel: "Paused by you",
      paused: true,
    }];
    const taskRouting = routing(["retrieval_practice", "spaced_retrieval"]);

    expect(applyPersonalizedMethodTieToRouting(taskRouting, context)).toBe(taskRouting);
    context.methodTie.signals[0]!.paused = false;
    context.methodTie.signals[0]!.evidenceLabel = "Tested and promising";
    context.methodTie.state.controls.experiments = false;
    expect(applyPersonalizedMethodTieToRouting(taskRouting, context)).toBe(taskRouting);
  });

  it("does not run an active method test outside its task and stage", () => {
    const context = personalization();
    context.methodTie.state.controls.experiments = true;
    context.methodTie.state.activeExperiment = {
      id: "method-test",
      variable: "method_tie",
      variantA: "retrieval_practice",
      variantB: "spaced_retrieval",
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
      nextVariant: "b",
    };
    context.methodTie.signals = [];
    const taskRouting = routing(["retrieval_practice", "spaced_retrieval"]);

    expect(applyPersonalizedMethodTieToRouting(taskRouting, context)).toBe(taskRouting);
  });
});
