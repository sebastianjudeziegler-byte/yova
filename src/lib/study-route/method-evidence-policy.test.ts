import { describe, expect, it } from "vitest";
import {
  METHOD_EVIDENCE_COMPARABILITY_POLICY_VERSION,
  METHOD_EVIDENCE_MINIMUM_CHECKED_ANSWERS,
  METHOD_EVIDENCE_MINIMUM_DISTINCT_STUDY_DAYS,
  METHOD_EVIDENCE_MINIMUM_SESSIONS,
  methodEvidenceComparisonContextForRoute,
  methodEvidenceComparisonKey,
  methodEvidenceDurationBand,
  methodEvidenceMeetsMinimum,
} from "@/lib/study-route/method-evidence-policy";
import {
  STUDY_ROUTE_SCHEMA_VERSION,
  StudyRouteSchema,
  type StudyRoute,
} from "@/lib/study-route/schema";

const IDS = {
  lineage: "11111111-1111-4111-8111-111111111111",
  revision: "22222222-2222-4222-8222-222222222222",
  plan: "33333333-3333-4333-8333-333333333333",
  session: "44444444-4444-4444-8444-444444444444",
  firstTarget: "55555555-5555-4555-8555-555555555555",
  secondTarget: "66666666-6666-4666-8666-666666666666",
} as const;

describe("method evidence policy", () => {
  it("centralizes the frozen v1 evidence floor", () => {
    expect({
      sessions: METHOD_EVIDENCE_MINIMUM_SESSIONS,
      checkedAnswers: METHOD_EVIDENCE_MINIMUM_CHECKED_ANSWERS,
      distinctStudyDays: METHOD_EVIDENCE_MINIMUM_DISTINCT_STUDY_DAYS,
    }).toEqual({ sessions: 4, checkedAnswers: 12, distinctStudyDays: 2 });
    expect(methodEvidenceMeetsMinimum({
      sessions: 4,
      checkedAnswers: 12,
      distinctStudyDays: 2,
    })).toBe(true);
    expect(methodEvidenceMeetsMinimum({
      sessions: 4,
      checkedAnswers: 12,
      distinctStudyDays: 1,
    })).toBe(false);
  });

  it("uses bounded duration bands instead of pooling short and long work", () => {
    expect([5, 10, 11, 15, 16, 25, 26, 45, 46, 60, 61, 180].map(
      methodEvidenceDurationBand,
    )).toEqual([
      "brief",
      "brief",
      "compact",
      "compact",
      "standard",
      "standard",
      "extended",
      "extended",
      "long",
      "long",
      "extra_long",
      "extra_long",
    ]);
    expect(() => methodEvidenceDurationBand(4)).toThrow(/valid active-session duration/i);
  });

  it("derives every required comparability dimension without learner or source prose", () => {
    const context = methodEvidenceComparisonContextForRoute(validRoute());

    expect(context).toEqual({
      policyVersion: METHOD_EVIDENCE_COMPARABILITY_POLICY_VERSION,
      taskFamily: "conceptual_learning",
      knowledgeStage: "novice",
      mode: "learn",
      executionEnvironment: "inside_yova",
      difficultyTier: "foundational",
      durationBand: "standard",
      initialSupport: "supported_start",
      targetRelationship: "multi_target_mixed_stage",
      assessmentType: "explanation",
    });
    expect(methodEvidenceComparisonKey(context)).not.toMatch(
      /mechanism|learner|source|11111111|22222222|55555555/i,
    );
  });

  it.each([
    ["task family", { taskFamily: "problem_solving" }],
    ["knowledge stage", { knowledgeStage: "developing" }],
    ["session mode", { mode: "practice" }],
    ["execution environment", { executionEnvironment: "outside_yova" }],
    ["difficulty", { difficultyTier: "stretch" }],
    ["duration", { durationBand: "extended" }],
    ["support", { initialSupport: "fading" }],
    ["target relationship", { targetRelationship: "single_target" }],
    ["assessment type", { assessmentType: "application" }],
  ] as const)("separates cohorts when %s changes", (_label, change) => {
    const baseline = methodEvidenceComparisonContextForRoute(validRoute());
    const changed = { ...baseline, ...change };

    expect(methodEvidenceComparisonKey(changed)).not.toBe(
      methodEvidenceComparisonKey(baseline),
    );
  });
});

function validRoute(): StudyRoute {
  return StudyRouteSchema.parse({
    identity: {
      routeLineageId: IDS.lineage,
      routeRevisionId: IDS.revision,
      revisionNumber: 1,
      schemaVersion: STUDY_ROUTE_SCHEMA_VERSION,
      lifecycleStatus: "committed",
      planId: IDS.plan,
      sessionId: IDS.session,
      createdAt: "2026-08-23T09:00:00.000Z",
      committedAt: "2026-08-23T09:01:00.000Z",
    },
    target: {
      taskFamily: "conceptual_learning",
      desiredOutcome: "Explain how the two mechanisms differ and apply the distinction.",
      targetStates: [{
        targetId: IDS.firstTarget,
        stage: "novice",
        uncertainty: "high",
        evidenceRefs: [],
      }, {
        targetId: IDS.secondTarget,
        stage: "developing",
        uncertainty: "medium",
        evidenceRefs: ["attempt:earlier-check"],
      }],
      sourceRequirements: {
        sourceType: "yova_generated",
        requiredSourceIds: [],
        groundingRequired: false,
        instructions: [],
      },
    },
    approach: {
      mode: "learn",
      executionEnvironment: "inside_yova",
      primaryMethodId: "self_explanation",
      visibleMethodName: "Feynman Technique",
      confidenceLevel: "medium",
    },
    timing: {
      activeMinutes: 25,
      elapsedMinutes: 25,
      durationSource: "router_default",
      hardMaximumMinutes: 30,
    },
    execution: {
      orderedPhases: [{
        phaseId: "model-1",
        methodPhase: "model",
        activeMinutes: 10,
        targetIds: [IDS.firstTarget, IDS.secondTarget],
      }, {
        phaseId: "explain-1",
        methodPhase: "explain",
        activeMinutes: 10,
        targetIds: [IDS.firstTarget, IDS.secondTarget],
      }, {
        phaseId: "independent-check-1",
        methodPhase: "independent_practice",
        activeMinutes: 5,
        targetIds: [IDS.firstTarget, IDS.secondTarget],
      }],
      difficultyTier: "foundational",
      initialSupport: "supported_start",
      activityLimit: 5,
      completionEvidence: [{
        evidenceId: "independent-explanation",
        targetIds: [IDS.firstTarget, IDS.secondTarget],
        kind: "explanation",
        description: "Explain both mechanisms without support and apply the distinction.",
        requiresIndependentAttempt: true,
      }],
      deferredTargets: [],
    },
    agency: {
      controlMode: "yova_decides",
      selectedBy: "yova",
      alternatives: [],
    },
    explanation: {
      shortReason: "This task needs an accurate model before an independent explanation.",
      taskRequirements: ["Build an accurate causal model."],
      learnerDeclarations: [],
      observations: [],
      uncertainties: [],
    },
    provenance: {
      routerVersion: "router-v1",
      profileVersion: "profile-v3",
      evidenceRefs: [],
      ruleTrace: [{
        ruleId: "task-stage-baseline",
        result: "selected",
        reason: "Conceptual learning with a novice target requires teaching first.",
        evidenceRefs: [],
      }],
    },
  });
}
