import { describe, expect, it } from "vitest";
import {
  selectCanonicalStudyMethod,
  type CanonicalObservedMethodEvidence,
} from "@/lib/learning/canonical-method-selection";
import type { GenerationPersonalizationContext } from "@/lib/personalization/personalization-generation";
import {
  personalizationInputsForRollout,
  resolvePersonalizationRollout,
} from "@/lib/study-route/personalization-rollout";

describe("personalization rollout integration contract", () => {
  it("cannot personalize a baseline cohort even when declarations and outcomes are available", () => {
    const comparisonKey = "method_compare_v1:memorization:developing:practice:inside_yova:standard:compact:independent_start:single_target:retrieval";
    const personalization: GenerationPersonalizationContext = {
      decisions: [],
      preferredMethodIds: ["spaced_retrieval"],
      methodTie: {
        state: {
          controls: { experiments: true },
          activeExperiment: {
            id: "experiment-inert",
            variable: "method_tie",
            variantA: "retrieval_practice",
            variantB: "spaced_retrieval",
            taskType: "memorization",
            knowledgeStage: "developing",
            nextVariant: "b",
          },
          experimentHistory: [],
        },
        signals: [{
          id: "experiment:experiment-inert",
          key: "experiment_result",
          title: "Legacy personal test",
          code: "spaced_retrieval",
          evidenceLabel: "Tested and promising",
          paused: false,
        }],
      },
    };
    const observedEvidence: readonly CanonicalObservedMethodEvidence[] = [{
      comparisonKey,
      signal: {
        methodId: "spaced_retrieval",
        methodName: "Spaced Repetition",
        taskType: "memorization",
        knowledgeStage: "developing",
        comparisonLabel: "memorization/developing",
        sessions: 4,
        checkedAnswers: 16,
        accuracyPercent: 88,
        difficultRatings: 0,
        status: "promising",
        evidence: "Bounded fixture evidence.",
        deliveryGuidance: "Bounded fixture guidance.",
      },
      evidenceRefs: ["attempt:1", "attempt:2", "attempt:3", "attempt:4"],
      distinctStudyDays: 4,
      latestObservedAt: "2026-08-23T08:00:00.000Z",
    }];
    const common = {
      taskType: "memorization" as const,
      knowledgeStage: "developing" as const,
      learningMode: "study" as const,
      currentComparisonKey: comparisonKey,
    };
    const baselineInputs = personalizationInputsForRollout({
      decision: resolvePersonalizationRollout({
        rolloutPercent: 0,
        subjectKey: "authenticated-user-id",
      }),
      personalization,
      observedEvidence,
    });
    const personalizedInputs = personalizationInputsForRollout({
      decision: resolvePersonalizationRollout({
        rolloutPercent: 100,
        subjectKey: "authenticated-user-id",
      }),
      personalization,
      observedEvidence,
    });

    const baseline = selectCanonicalStudyMethod({ ...common, ...baselineInputs });
    const personalized = selectCanonicalStudyMethod({
      ...common,
      ...personalizedInputs,
    });

    expect(baseline).toMatchObject({
      selectedMethodId: "retrieval_practice",
      authority: "task_baseline",
      evidenceRefs: [],
      ignoredExperimentalSignalIds: [],
    });
    expect(personalized).toMatchObject({
      selectedMethodId: "spaced_retrieval",
      authority: "observed_outcomes",
    });
    expect(personalized.ignoredExperimentalSignalIds).toEqual([
      "experiment:experiment-inert",
    ]);
    expect(personalized.ruleTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: "method.hidden_experiments_disabled_v1",
      }),
    ]));
  });
});
