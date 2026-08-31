import { describe, expect, it } from "vitest";
import { learningModeContract } from "@/lib/learning/learning-intent";
import {
  buildLearningScienceRoutingBrief,
  type LearningScienceRoutingBrief,
} from "@/lib/learning/method-router";
import {
  applyPersonalizedMethodTieToRouting,
  personalizationDecisions,
  resolvePersonalizationForGeneration,
  type GenerationPersonalizationContext,
} from "@/lib/personalization/personalization-generation";
import {
  defaultPersonalizationState,
  setPreferredMethodIds,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";

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
    const context = personalization();
    context.preferredMethodIds = ["spaced_retrieval"];

    expect(applyPersonalizedMethodTieToRouting(
      taskRouting,
      context,
    )).toBe(taskRouting);
  });

  it("selects a saved preference only inside the task router list and in router order", () => {
    const context = personalization("unknown");
    context.preferredMethodIds = ["retrieval_practice", "spaced_retrieval"];
    const taskRouting = routing(["spaced_retrieval", "retrieval_practice"]);
    const selected = applyPersonalizedMethodTieToRouting(taskRouting, context);

    expect(selected.suggestedPrimaryMethodId).toBe("spaced_retrieval");
    expect(selected.allowedMethodIds).toEqual(["spaced_retrieval"]);
    expect(selected.allowedMethodIds.every((methodId) => (
      taskRouting.allowedMethodIds.includes(methodId)
    ))).toBe(true);
    expect(selected.decisionBasis.at(-1)).toMatch(/saved method preference/i);
  });

  it("preserves stable observed fit before a conflicting saved preference", () => {
    const taskRouting: LearningScienceRoutingBrief = {
      ...routing(["spaced_retrieval", "retrieval_practice"]),
      suggestedPrimaryMethodId: "retrieval_practice",
      methodFit: {
        orderedMethodIds: ["retrieval_practice", "spaced_retrieval"],
        selectedMethodId: "retrieval_practice",
        baselineMethodId: "spaced_retrieval",
        changedFromBaseline: true,
        learnerFacingReason: "Recent comparable retrieval sessions produced stable checked success.",
        scores: [
          {
            methodId: "retrieval_practice",
            methodName: "Retrieval Practice",
            baselineRank: 1,
            baselineScore: 0,
            declaredScore: 0,
            observedScore: 2,
            total: 2,
            signals: [{
              methodId: "retrieval_practice",
              source: "observed",
              weight: 2,
              reason: "recent comparable sessions went well",
            }],
          },
          {
            methodId: "spaced_retrieval",
            methodName: "Spaced Repetition",
            baselineRank: 0,
            baselineScore: 0.25,
            declaredScore: 0,
            observedScore: 0,
            total: 0.25,
            signals: [],
          },
        ],
      },
    };
    const context = personalization("unknown");
    context.preferredMethodIds = ["spaced_retrieval"];

    expect(applyPersonalizedMethodTieToRouting(taskRouting, context)).toBe(
      taskRouting,
    );
  });

  it("never renames an eligible method already saved on a legacy route-free session", () => {
    const legacyRouting = buildLearningScienceRoutingBrief({
      learningIntent: "study",
      sessionLearningMode: "study",
      goalTitle: "Biology vocabulary",
      goalTopic: "Remember the core biology terms",
      goalKind: "assessment",
      sessionTitle: "Vocabulary review",
      sessionObjective: "Recall each definition without looking",
      plannedMethod: "Spaced Repetition",
      plannedMethodReason: "This older saved session already named the method.",
      plannedMethodAuthority: "legacy_compatibility",
      learnerProfile: null,
      recentResults: [],
      interruptionCount: 0,
      taskTypeOverride: "memorization",
      knowledgeStageOverride: "developing",
    });
    const context = personalization("unknown");
    context.preferredMethodIds = ["retrieval_practice"];

    expect(legacyRouting.preservedLegacyMethodId).toBe("spaced_retrieval");
    expect(applyPersonalizedMethodTieToRouting(legacyRouting, context)).toBe(
      legacyRouting,
    );
    expect(legacyRouting.suggestedPrimaryMethodId).toBe("spaced_retrieval");
  });

  it("projects saved preferences only while self-report personalization is enabled", () => {
    const preferred = setPreferredMethodIds(defaultPersonalizationState(), [
      "spaced_retrieval",
    ]);
    const enabled = resolvePersonalizationForGeneration({
      answers: writePersonalizationStateToAnswers([], preferred),
      completions: [],
      interruptions: [],
      plans: [],
    });
    const disabled = resolvePersonalizationForGeneration({
      answers: writePersonalizationStateToAnswers([], {
        ...preferred,
        controls: { ...preferred.controls, selfReport: false },
      }),
      completions: [],
      interruptions: [],
      plans: [],
    });

    expect(enabled.preferredMethodIds).toEqual(["spaced_retrieval"]);
    expect(disabled).not.toHaveProperty("preferredMethodIds");
  });

  it("projects the same canonical control preference that existing profiles show", () => {
    const legacyAnswers = Array.from({ length: 17 }, () => "");
    legacyAnswers[1] = "structured_flexibility";

    const projected = resolvePersonalizationForGeneration({
      answers: legacyAnswers,
      completions: [],
      interruptions: [],
      plans: [],
    });

    expect(projected.canonicalProfile?.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        signalId: "control_mode",
        value: "help_me_choose",
        sourceQuestionId: "onboarding:q2",
      }),
    ]));
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

  it("does not run a matching hidden method experiment in milestone 3", () => {
    const context = personalization();
    context.methodTie.state.controls.experiments = true;
    context.methodTie.state.activeExperiment = {
      id: "method-test",
      variable: "method_tie",
      variantA: "retrieval_practice",
      variantB: "spaced_retrieval",
      taskType: "memorization",
      knowledgeStage: "developing",
      nextVariant: "b",
    };
    context.methodTie.signals = [];
    context.decisions = [{
      id: "decision:experiment:method-test:b",
      artifact: "method_tie",
      setting: "method_id",
      value: "spaced_retrieval",
      title: "Personal test: spaced retrieval",
      explanation: "Alternate two task-valid methods and compare the checked result cautiously.",
      signalIds: ["experiment:method-test"],
      evidenceLabel: "You told YOVA",
      methodCandidates: ["spaced_retrieval"],
      experimental: true,
    }];
    const taskRouting = routing(["retrieval_practice", "spaced_retrieval"]);

    expect(applyPersonalizedMethodTieToRouting(taskRouting, context)).toBe(taskRouting);
    expect(personalizationDecisions(context, taskRouting)).toEqual([]);
  });
});
