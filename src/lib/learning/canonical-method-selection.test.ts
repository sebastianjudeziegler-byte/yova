import { describe, expect, it } from "vitest";
import {
  CANONICAL_METHOD_SELECTION_POLICY_VERSION,
  CanonicalMethodSelectionError,
  selectCanonicalStudyMethod,
  type CanonicalMethodSelectionInput,
} from "@/lib/learning/canonical-method-selection";
import type { CoreMethodId, LearningTaskType } from "@/lib/learning/method-catalog";
import type { KnowledgeStage } from "@/lib/learning/method-eligibility";
import type { MethodOutcomeSignal } from "@/lib/personalization/method-outcomes";
import type { GenerationPersonalizationContext } from "@/lib/personalization/personalization-generation";

const ROUTE_A = "11111111-1111-4111-8111-111111111111";
const ROUTE_B = "22222222-2222-4222-8222-222222222222";

function baseInput(): CanonicalMethodSelectionInput {
  return {
    taskType: "memorization",
    knowledgeStage: "developing",
    learningMode: "study",
  };
}

function personalization({
  code = "delayed_forgetting",
  paused = false,
}: {
  code?: string;
  paused?: boolean;
} = {}): GenerationPersonalizationContext {
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
        title: "Memory breakdown",
        code,
        evidenceLabel: "You told YOVA",
        paused,
      }],
    },
  };
}

function outcome({
  methodId,
  sessions = 4,
  checkedAnswers = 16,
  accuracyPercent = 88,
  difficultRatings = 0,
  status = "promising",
  taskType = "memorization",
  knowledgeStage = "developing",
}: {
  methodId: CoreMethodId;
  sessions?: number;
  checkedAnswers?: number;
  accuracyPercent?: number | null;
  difficultRatings?: number;
  status?: MethodOutcomeSignal["status"];
  taskType?: LearningTaskType;
  knowledgeStage?: KnowledgeStage;
}): MethodOutcomeSignal {
  return {
    methodId,
    methodName: methodId.replaceAll("_", " "),
    taskType,
    knowledgeStage,
    comparisonLabel: `${taskType}/${knowledgeStage}`,
    sessions,
    checkedAnswers,
    accuracyPercent,
    difficultRatings,
    status,
    evidence: "Bounded fixture evidence.",
    deliveryGuidance: "Bounded fixture guidance.",
  };
}

describe("canonical method selection", () => {
  it("returns a stable, versioned baseline without manufactured personalization", () => {
    const first = selectCanonicalStudyMethod(baseInput());
    const second = selectCanonicalStudyMethod(baseInput());

    expect(first).toEqual(second);
    expect(first.policyVersion).toBe(CANONICAL_METHOD_SELECTION_POLICY_VERSION);
    expect(first.eligibilityPolicyVersion).toBe("method_eligibility_v1");
    expect(first.selectedMethodId).toBe("retrieval_practice");
    expect(first.authority).toBe("task_baseline");
    expect(first.changedFromBaseline).toBe(false);
    expect(first.evidenceRefs).toEqual([]);
    expect(first.learnerFacingReason).toMatch(/stable evidence-constrained baseline/i);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.ruleTrace)).toBe(true);
  });

  it("lets a deliberate learner choice override the recommendation only inside eligibility", () => {
    const context = personalization();
    context.preferredMethodIds = ["spaced_retrieval"];
    const selection = selectCanonicalStudyMethod({
      ...baseInput(),
      learnerChoice: {
        methodId: "interleaved_practice",
        evidenceRef: "learner-choice:session-setup",
      },
      personalization: context,
      observedEvidence: [{
        signal: outcome({ methodId: "spaced_retrieval" }),
        evidenceRefs: ["attempt:spaced-1"],
        distinctStudyDays: 2,
        latestObservedAt: "2026-08-23T08:00:00.000Z",
      }],
    });

    expect(selection.selectedMethodId).toBe("interleaved_practice");
    expect(selection.authority).toBe("learner_choice");
    expect(selection.evidenceRefs).toEqual(["learner-choice:session-setup"]);
    expect(selection.learnerFacingReason).toMatch(/^You chose/);

    expect(() => selectCanonicalStudyMethod({
      ...baseInput(),
      learnerChoice: {
        methodId: "self_explanation",
        evidenceRef: "learner-choice:invalid",
      },
    })).toThrowError(CanonicalMethodSelectionError);
    try {
      selectCanonicalStudyMethod({
        ...baseInput(),
        learnerChoice: {
          methodId: "self_explanation",
          evidenceRef: "learner-choice:invalid",
        },
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: "learner_choice_ineligible",
        methodId: "self_explanation",
      });
    }
  });

  it("keeps an eligible committed route immutable and rejects an invalid commitment", () => {
    const context = personalization();
    context.preferredMethodIds = ["spaced_retrieval"];
    const selection = selectCanonicalStudyMethod({
      ...baseInput(),
      committedRoute: {
        methodId: "interleaved_practice",
        routeRevisionId: ROUTE_A,
      },
      learnerChoice: {
        methodId: "spaced_retrieval",
        evidenceRef: "learner-choice:later",
      },
      personalization: context,
    });

    expect(selection.selectedMethodId).toBe("interleaved_practice");
    expect(selection.authority).toBe("committed_route");
    expect(selection.evidenceRefs).toEqual([`route-revision:${ROUTE_A}`]);

    expect(() => selectCanonicalStudyMethod({
      ...baseInput(),
      committedRoute: {
        methodId: "self_explanation",
        routeRevisionId: ROUTE_A,
      },
    })).toThrowError(expect.objectContaining({
      code: "committed_method_ineligible",
    }));
  });

  it("allows four comparable positive sessions to rank a nonbaseline eligible method", () => {
    const selection = selectCanonicalStudyMethod({
      ...baseInput(),
      observedEvidence: [{
        signal: outcome({ methodId: "spaced_retrieval" }),
        evidenceRefs: ["attempt:one", "attempt:two", "attempt:three", "attempt:four"],
        distinctStudyDays: 2,
        latestObservedAt: "2026-08-23T08:00:00.000Z",
      }],
    });

    expect(selection.selectedMethodId).toBe("spaced_retrieval");
    expect(selection.authority).toBe("observed_outcomes");
    expect(selection.learnerFacingReason).toContain("4 comparable sessions");
    expect(selection.learnerFacingReason).toContain("does not label a fixed best method");
  });

  it("does not switch from three sessions, missing durable refs, or negative evidence", () => {
    const tooEarly = selectCanonicalStudyMethod({
      ...baseInput(),
      observedEvidence: [{
        signal: outcome({ methodId: "spaced_retrieval", sessions: 3 }),
        evidenceRefs: ["attempt:one", "attempt:two", "attempt:three"],
        distinctStudyDays: 2,
        latestObservedAt: "2026-08-23T08:00:00.000Z",
      }],
    });
    const noRefs = selectCanonicalStudyMethod({
      ...baseInput(),
      observedEvidence: [{
        signal: outcome({ methodId: "spaced_retrieval" }),
        evidenceRefs: [],
        distinctStudyDays: 2,
        latestObservedAt: "2026-08-23T08:00:00.000Z",
      }],
    });
    const needsSupport = selectCanonicalStudyMethod({
      ...baseInput(),
      observedEvidence: [{
        signal: outcome({
          methodId: "spaced_retrieval",
          accuracyPercent: 42,
          difficultRatings: 3,
          status: "needs_more_support",
        }),
        evidenceRefs: ["attempt:one", "attempt:two", "attempt:three", "attempt:four"],
        distinctStudyDays: 2,
        latestObservedAt: "2026-08-23T08:00:00.000Z",
      }],
    });

    expect(tooEarly.authority).toBe("task_baseline");
    expect(noRefs.authority).toBe("task_baseline");
    expect(needsSupport.authority).toBe("task_baseline");
    expect(tooEarly.supportOnlyMethodIds).toContain("spaced_retrieval");
    expect(needsSupport.supportOnlyMethodIds).toContain("spaced_retrieval");
  });

  it("requires observed evidence to match the exact task and stage", () => {
    const wrongTask = selectCanonicalStudyMethod({
      ...baseInput(),
      observedEvidence: [{
        signal: outcome({
          methodId: "spaced_retrieval",
          taskType: "conceptual_learning",
        }),
        evidenceRefs: ["attempt:wrong-task"],
        distinctStudyDays: 2,
        latestObservedAt: "2026-08-23T08:00:00.000Z",
      }],
    });
    const wrongStage = selectCanonicalStudyMethod({
      ...baseInput(),
      observedEvidence: [{
        signal: outcome({
          methodId: "spaced_retrieval",
          knowledgeStage: "retrieval_ready",
        }),
        evidenceRefs: ["attempt:wrong-stage"],
        distinctStudyDays: 2,
        latestObservedAt: "2026-08-23T08:00:00.000Z",
      }],
    });

    expect(wrongTask.authority).toBe("task_baseline");
    expect(wrongStage.authority).toBe("task_baseline");
  });

  it("lets stable outcomes outrank an authorized declaration", () => {
    const selection = selectCanonicalStudyMethod({
      ...baseInput(),
      personalization: personalization(),
      observedEvidence: [{
        signal: outcome({ methodId: "interleaved_practice" }),
        evidenceRefs: ["attempt:interleaved-1"],
        distinctStudyDays: 2,
        latestObservedAt: "2026-08-23T08:00:00.000Z",
      }],
    });

    expect(selection.selectedMethodId).toBe("interleaved_practice");
    expect(selection.authority).toBe("observed_outcomes");
  });

  it("lets stable outcomes outrank a saved method preference", () => {
    const context = personalization({ code: "unknown" });
    context.preferredMethodIds = ["spaced_retrieval"];
    const selection = selectCanonicalStudyMethod({
      ...baseInput(),
      personalization: context,
      observedEvidence: [{
        signal: outcome({ methodId: "interleaved_practice" }),
        evidenceRefs: ["attempt:interleaved-1"],
        distinctStudyDays: 2,
        latestObservedAt: "2026-08-23T08:00:00.000Z",
      }],
    });

    expect(selection.selectedMethodId).toBe("interleaved_practice");
    expect(selection.authority).toBe("observed_outcomes");
  });

  it("intersects saved preferences with eligibility in server baseline order", () => {
    const context = personalization({ code: "unknown" });
    // Catalog order puts retrieval practice before self-explanation. The
    // conceptual-novice eligibility policy puts self-explanation first.
    context.preferredMethodIds = ["retrieval_practice", "self_explanation"];
    const selection = selectCanonicalStudyMethod({
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
      learningMode: "study",
      personalization: context,
    });

    expect(selection.eligibleMethodIds).toEqual([
      "self_explanation",
      "read_recall_review",
      "retrieval_practice",
    ]);
    expect(selection.selectedMethodId).toBe("self_explanation");
    expect(selection.authority).toBe("authorized_declaration");
    expect(selection.evidenceRefs).toEqual([
      "profile-method-preference:self_explanation",
    ]);
    expect(selection.learnerFacingReason).toMatch(/when it fits/i);
  });

  it("ignores a saved preference outside the server eligibility set", () => {
    const context = personalization({ code: "unknown" });
    context.preferredMethodIds = ["self_explanation"];
    const selection = selectCanonicalStudyMethod({
      ...baseInput(),
      personalization: context,
    });

    expect(selection.selectedMethodId).toBe("retrieval_practice");
    expect(selection.authority).toBe("task_baseline");
    expect(selection.eligibleMethodIds).not.toContain("self_explanation");
  });

  it("uses a typed, unpaused declaration only inside the eligible set", () => {
    const declared = selectCanonicalStudyMethod({
      ...baseInput(),
      personalization: personalization(),
    });
    const paused = selectCanonicalStudyMethod({
      ...baseInput(),
      personalization: personalization({ paused: true }),
    });
    const irrelevant = selectCanonicalStudyMethod({
      ...baseInput(),
      personalization: personalization({ code: "application_gap" }),
    });

    expect(declared.selectedMethodId).toBe("spaced_retrieval");
    expect(declared.authority).toBe("authorized_declaration");
    expect(declared.evidenceRefs).toEqual(["signal:memory_breakdown"]);
    expect(paused.authority).toBe("task_baseline");
    expect(irrelevant.authority).toBe("task_baseline");
  });

  it("ignores hidden method experiments in v1 even when the old control is enabled", () => {
    const context = personalization({ code: "unknown" });
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
    context.methodTie.signals = [{
      id: "experiment:method-test",
      key: "experiment_result",
      title: "Hidden personal test",
      code: "spaced_retrieval",
      evidenceLabel: "Tested and promising",
      paused: false,
    }];

    const selection = selectCanonicalStudyMethod({
      ...baseInput(),
      personalization: context,
    });

    expect(selection.selectedMethodId).toBe("retrieval_practice");
    expect(selection.authority).toBe("task_baseline");
    expect(selection.ignoredExperimentalSignalIds).toEqual(["experiment:method-test"]);
    expect(selection.ruleTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "method.hidden_experiments_disabled_v1" }),
    ]));
  });

  it("uses continuity before route-free legacy compatibility and ignores ineligible hints", () => {
    const continuity = selectCanonicalStudyMethod({
      ...baseInput(),
      continuity: {
        methodId: "interleaved_practice",
        routeRevisionId: ROUTE_B,
      },
      legacyCompatibilityMethodId: "spaced_retrieval",
    });
    const legacy = selectCanonicalStudyMethod({
      ...baseInput(),
      continuity: {
        methodId: "self_explanation",
        routeRevisionId: ROUTE_B,
      },
      legacyCompatibilityMethodId: "spaced_retrieval",
    });
    const ignored = selectCanonicalStudyMethod({
      ...baseInput(),
      legacyCompatibilityMethodId: "self_explanation",
    });

    expect(continuity.authority).toBe("continuity");
    expect(continuity.selectedMethodId).toBe("interleaved_practice");
    expect(legacy.authority).toBe("legacy_compatibility");
    expect(legacy.selectedMethodId).toBe("spaced_retrieval");
    expect(ignored.authority).toBe("task_baseline");
  });

  it("keeps candidate order deterministic and does not mutate caller input", () => {
    const input: CanonicalMethodSelectionInput = {
      ...baseInput(),
      personalization: personalization(),
      observedEvidence: [{
        signal: outcome({ methodId: "interleaved_practice" }),
        evidenceRefs: ["attempt:one"],
        distinctStudyDays: 2,
        latestObservedAt: "2026-08-23T08:00:00.000Z",
      }],
    };
    const before = structuredClone(input);
    const selection = selectCanonicalStudyMethod(input);

    expect(input).toEqual(before);
    expect(selection.eligibleMethodIds).toEqual([
      "retrieval_practice",
      "spaced_retrieval",
      "interleaved_practice",
    ]);
    expect(selection.orderedMethodIds).toEqual([
      "interleaved_practice",
      "retrieval_practice",
      "spaced_retrieval",
    ]);
  });

  it("rejects duplicate exact-method outcome summaries instead of choosing ambiguously", () => {
    expect(() => selectCanonicalStudyMethod({
      ...baseInput(),
      observedEvidence: [
        {
          signal: outcome({ methodId: "spaced_retrieval" }),
          evidenceRefs: ["attempt:first"],
          distinctStudyDays: 2,
          latestObservedAt: "2026-08-23T08:00:00.000Z",
        },
        {
          signal: outcome({ methodId: "spaced_retrieval" }),
          evidenceRefs: ["attempt:second"],
          distinctStudyDays: 2,
          latestObservedAt: "2026-08-23T08:00:00.000Z",
        },
      ],
    })).toThrow(/duplicate spaced_retrieval outcome signals/i);
  });
});
