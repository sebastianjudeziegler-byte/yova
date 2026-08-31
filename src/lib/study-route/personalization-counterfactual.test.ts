import { describe, expect, it } from "vitest";
import {
  PERSONALIZATION_BASELINE_ROUTE_VERSION,
  PERSONALIZATION_ROLLOUT_POLICY_VERSION,
  PERSONALIZATION_ROUTE_VERSION,
} from "@/lib/study-route/personalization-rollout";
import {
  PERSONALIZATION_COUNTERFACTUAL_POLICY_VERSION,
  comparePersonalizationRouteCounterfactual,
} from "@/lib/study-route/personalization-counterfactual";
import {
  STUDY_ROUTE_SCHEMA_VERSION,
  StudyRouteSchema,
  type StudyRoute,
} from "@/lib/study-route/schema";

const IDS = {
  lineage: "11111111-1111-4111-8111-111111111111",
  baselineRevision: "22222222-2222-4222-8222-222222222221",
  personalizedRevision: "22222222-2222-4222-8222-222222222222",
  plan: "33333333-3333-4333-8333-333333333333",
  session: "44444444-4444-4444-8444-444444444444",
  target: "55555555-5555-4555-8555-555555555555",
} as const;

describe("personalization rollout counterfactual", () => {
  it("reports only privacy-safe route-decision differences", () => {
    const baseline = route(PERSONALIZATION_BASELINE_ROUTE_VERSION);
    const personalized = StudyRouteSchema.parse({
      ...route(PERSONALIZATION_ROUTE_VERSION),
      approach: {
        ...route(PERSONALIZATION_ROUTE_VERSION).approach,
        primaryMethodId: "retrieval_practice",
        visibleMethodName: "Active Recall",
      },
      execution: {
        ...route(PERSONALIZATION_ROUTE_VERSION).execution,
        orderedPhases: [{
          phaseId: "retrieve-1",
          methodPhase: "retrieve",
          activeMinutes: 15,
          targetIds: [IDS.target],
        }],
        initialSupport: "independent_start",
      },
      explanation: {
        ...route(PERSONALIZATION_ROUTE_VERSION).explanation,
        shortReason: "Active Recall fits the declared closed-note preference for this eligible task.",
      },
      provenance: {
        ...route(PERSONALIZATION_ROUTE_VERSION).provenance,
        evidenceRefs: ["canonical-profile:successful_approach"],
      },
    });
    const result = comparePersonalizationRouteCounterfactual({
      baseline,
      personalized,
    });

    expect(result).toEqual({
      policyVersion: PERSONALIZATION_COUNTERFACTUAL_POLICY_VERSION,
      baselineRouteVersion: PERSONALIZATION_BASELINE_ROUTE_VERSION,
      personalizedRouteVersion: PERSONALIZATION_ROUTE_VERSION,
      taskFamily: "memorization",
      mode: "practice",
      baselineMethodId: "spaced_retrieval",
      personalizedMethodId: "retrieval_practice",
      baselineActiveMinutes: 15,
      personalizedActiveMinutes: 15,
      differences: ["method", "support", "structure", "rationale"],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /cell cycle|closed-note|55555555|canonical-profile/i,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.differences)).toBe(true);
  });

  it("rejects scope drift before it can masquerade as personalization", () => {
    const baseline = route(PERSONALIZATION_BASELINE_ROUTE_VERSION);
    const changedTask = StudyRouteSchema.parse({
      ...route(PERSONALIZATION_ROUTE_VERSION),
      target: {
        ...route(PERSONALIZATION_ROUTE_VERSION).target,
        taskFamily: "problem_solving",
      },
    });

    expect(() => comparePersonalizationRouteCounterfactual({
      baseline,
      personalized: changedTask,
    })).toThrow(/task family fixed/i);
  });

  it("requires explicit baseline and personalized route versions", () => {
    const unversioned = route(PERSONALIZATION_BASELINE_ROUTE_VERSION);
    unversioned.provenance.routerVersion = "router-v1";

    expect(() => comparePersonalizationRouteCounterfactual({
      baseline: unversioned,
      personalized: route(PERSONALIZATION_ROUTE_VERSION),
    })).toThrow(/one baseline and one personalized route version/i);
  });
});

function route(
  routeVersion: typeof PERSONALIZATION_BASELINE_ROUTE_VERSION
    | typeof PERSONALIZATION_ROUTE_VERSION,
): StudyRoute {
  return StudyRouteSchema.parse({
    identity: {
      routeLineageId: IDS.lineage,
      routeRevisionId: routeVersion === PERSONALIZATION_BASELINE_ROUTE_VERSION
        ? IDS.baselineRevision
        : IDS.personalizedRevision,
      revisionNumber: 1,
      schemaVersion: STUDY_ROUTE_SCHEMA_VERSION,
      lifecycleStatus: "provisional",
      planId: IDS.plan,
      sessionId: IDS.session,
      createdAt: "2026-08-23T09:00:00.000Z",
    },
    target: {
      taskFamily: "memorization",
      desiredOutcome: "Recall and distinguish the main cell-cycle checkpoints.",
      targetStates: [{
        targetId: IDS.target,
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
      mode: "practice",
      executionEnvironment: "inside_yova",
      primaryMethodId: "spaced_retrieval",
      visibleMethodName: "Spaced Repetition",
      confidenceLevel: "medium",
    },
    timing: {
      activeMinutes: 15,
      elapsedMinutes: 15,
      durationSource: "router_default",
      hardMaximumMinutes: 25,
    },
    execution: {
      orderedPhases: [{
        phaseId: "retrieve-1",
        methodPhase: "retrieve",
        activeMinutes: 10,
        targetIds: [IDS.target],
      }, {
        phaseId: "repair-1",
        methodPhase: "repair",
        activeMinutes: 5,
        targetIds: [IDS.target],
      }],
      difficultyTier: "standard",
      initialSupport: "fading",
      activityLimit: 3,
      completionEvidence: [{
        evidenceId: "independent-retrieval",
        targetIds: [IDS.target],
        kind: "retrieval",
        description: "Recall the checkpoints independently before reviewing the source.",
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
      shortReason: "Spaced Repetition is the stable task-and-mastery baseline for this route.",
      taskRequirements: ["Retrieve the checkpoint sequence without support."],
      learnerDeclarations: [],
      observations: [],
      uncertainties: [],
    },
    provenance: {
      routerVersion: `router-v1+${PERSONALIZATION_ROLLOUT_POLICY_VERSION}+${routeVersion}`,
      profileVersion: "profile-v1",
      evidenceRefs: [],
      ruleTrace: [{
        ruleId: PERSONALIZATION_ROLLOUT_POLICY_VERSION,
        result: routeVersion,
        reason: "The server-owned rollout selected this version for new route issuance.",
        evidenceRefs: [],
      }],
    },
  });
}
