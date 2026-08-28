import { describe, expect, it } from "vitest";
import {
  STUDY_ROUTE_ROUTER_VERSION_MAX_LENGTH,
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
      targetStates: [
        {
          targetId: IDS.firstTarget,
          stage: "novice",
          uncertainty: "high",
          evidenceRefs: [],
        },
        {
          targetId: IDS.secondTarget,
          stage: "developing",
          uncertainty: "medium",
          evidenceRefs: ["attempt:earlier-check"],
          lastObservedAt: "2026-08-22T09:00:00.000Z",
          nextReview: {
            scheduledFor: "2026-08-25T09:00:00.000Z",
            reviewType: "retrieval_check",
            activeMinutes: 3,
            reason: "Return after a delay to check whether the distinction is retained.",
            evidenceRefs: ["attempt:earlier-check"],
          },
        },
      ],
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
      orderedPhases: [
        {
          phaseId: "model-1",
          methodPhase: "model",
          activeMinutes: 10,
          targetIds: [IDS.firstTarget, IDS.secondTarget],
        },
        {
          phaseId: "explain-1",
          methodPhase: "explain",
          activeMinutes: 10,
          targetIds: [IDS.firstTarget, IDS.secondTarget],
        },
        {
          phaseId: "independent-check-1",
          methodPhase: "independent_practice",
          activeMinutes: 5,
          targetIds: [IDS.firstTarget, IDS.secondTarget],
        },
      ],
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
      observations: ["The second target has one earlier attempt."],
      uncertainties: ["There is no independent evidence for the first target yet."],
    },
    provenance: {
      routerVersion: "router-v1",
      profileVersion: "profile-v3",
      evidenceRefs: ["attempt:earlier-check"],
      ruleTrace: [{
        ruleId: "task-stage-baseline",
        result: "selected",
        reason: "Conceptual learning with a novice target requires a teaching-first route.",
        evidenceRefs: ["attempt:earlier-check"],
      }],
    },
  });
}

describe("StudyRouteSchema", () => {
  it("accepts one strict canonical route with separate state for every target", () => {
    const parsed = StudyRouteSchema.parse(validRoute());

    expect(parsed.identity.schemaVersion).toBe(1);
    expect(parsed.target.targetStates).toMatchObject([
      { stage: "novice", uncertainty: "high" },
      { stage: "developing", uncertainty: "medium" },
    ]);
    expect(parsed.target.targetStates[1].nextReview?.activeMinutes).toBe(3);
  });

  it("keeps a bounded composite router history without widening other references", () => {
    const maximum = structuredClone(validRoute());
    maximum.provenance.routerVersion = "r".repeat(STUDY_ROUTE_ROUTER_VERSION_MAX_LENGTH);
    expect(StudyRouteSchema.safeParse(maximum).success).toBe(true);

    const tooLong = structuredClone(maximum);
    tooLong.provenance.routerVersion += "r";
    expect(StudyRouteSchema.safeParse(tooLong).success).toBe(false);

    const oversizedProfile = structuredClone(validRoute());
    oversizedProfile.provenance.profileVersion = "p".repeat(201);
    expect(StudyRouteSchema.safeParse(oversizedProfile).success).toBe(false);
  });

  it("requires five active minutes for the route without changing short target reviews", () => {
    const tooShort = structuredClone(validRoute());
    tooShort.timing.activeMinutes = 4;
    tooShort.timing.elapsedMinutes = 4;
    tooShort.execution.orderedPhases[0].activeMinutes = 2;
    tooShort.execution.orderedPhases[1].activeMinutes = 1;
    tooShort.execution.orderedPhases[2].activeMinutes = 1;

    const parsed = StudyRouteSchema.safeParse(tooShort);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(expect.objectContaining({
        code: "too_small",
        minimum: 5,
        path: ["timing", "activeMinutes"],
      }));
    }
    expect(validRoute().target.targetStates[1].nextReview?.activeMinutes).toBe(3);
  });

  it("rejects legacy mode and environment vocabulary at the canonical boundary", () => {
    const legacyMode = structuredClone(validRoute());
    (legacyMode.approach as { mode: string }).mode = "study";
    const legacyEnvironment = structuredClone(validRoute());
    (legacyEnvironment.approach as { executionEnvironment: string }).executionEnvironment = "inside";

    expect(StudyRouteSchema.safeParse(legacyMode).success).toBe(false);
    expect(StudyRouteSchema.safeParse(legacyEnvironment).success).toBe(false);
  });

  it("uses semantic unknown states instead of fabricated numeric precision", () => {
    const route = structuredClone(validRoute());
    route.target.targetStates[0].uncertainty = "unknown";
    route.approach.confidenceLevel = "unknown";
    expect(StudyRouteSchema.safeParse(route).success).toBe(true);

    const numeric = structuredClone(validRoute());
    (numeric.target.targetStates[0] as { uncertainty: unknown }).uncertainty = 0.72;
    expect(StudyRouteSchema.safeParse(numeric).success).toBe(false);
  });

  it("keeps missing legacy agency explicitly unknown during backfill", () => {
    const route = structuredClone(validRoute());
    route.agency.controlMode = "legacy_unknown";
    route.agency.selectedBy = "legacy_unknown";
    route.execution.difficultyTier = "unknown";
    route.execution.initialSupport = "unknown";

    expect(StudyRouteSchema.safeParse(route).success).toBe(true);
  });

  it("bounds override representation across all nine material route surfaces", () => {
    const route = structuredClone(validRoute());
    route.agency.selectedBy = "learner";
    route.agency.override = {
      requestedAt: "2026-08-23T09:00:30.000Z",
      changedFields: [
        "targets",
        "mode",
        "execution_environment",
        "primary_method",
        "method_recipe",
        "duration",
        "phase_order",
        "support_bounds",
        "review_contract",
      ],
      reason: "The learner changed every bounded route surface.",
    };

    expect(StudyRouteSchema.safeParse(route).success).toBe(true);

    route.agency.override.changedFields.push("method_recipe");
    expect(StudyRouteSchema.safeParse(route).success).toBe(false);
  });

  it("rejects unknown keys at both the route and nested-object boundaries", () => {
    const topLevel = { ...validRoute(), inventedScore: 0.8 };
    const nested = structuredClone(validRoute());
    (nested.approach as unknown as Record<string, unknown>).learningStyle = "visual";

    expect(StudyRouteSchema.safeParse(topLevel).success).toBe(false);
    expect(StudyRouteSchema.safeParse(nested).success).toBe(false);
  });

  it("enforces lifecycle predecessor and commit-time invariants", () => {
    const provisional = structuredClone(validRoute());
    provisional.identity.lifecycleStatus = "provisional";
    delete (provisional.identity as Partial<typeof provisional.identity>).committedAt;
    expect(StudyRouteSchema.safeParse(provisional).success).toBe(true);

    const missingPredecessor = structuredClone(provisional);
    missingPredecessor.identity.revisionNumber = 2;
    expect(StudyRouteSchema.safeParse(missingPredecessor).success).toBe(false);

    const committedWithoutTime = structuredClone(validRoute());
    delete (committedWithoutTime.identity as Partial<typeof committedWithoutTime.identity>).committedAt;
    expect(StudyRouteSchema.safeParse(committedWithoutTime).success).toBe(false);
  });

  it("requires exact phase budgets, valid target coverage, and a real break boundary", () => {
    const wrongBudget = structuredClone(validRoute());
    wrongBudget.execution.orderedPhases[0].activeMinutes = 9;
    expect(StudyRouteSchema.safeParse(wrongBudget).success).toBe(false);

    const unknownTarget = structuredClone(validRoute());
    unknownTarget.execution.orderedPhases[0].targetIds = [IDS.plan];
    expect(StudyRouteSchema.safeParse(unknownTarget).success).toBe(false);

    const breakAfterFinalPhase = structuredClone(validRoute());
    breakAfterFinalPhase.timing.elapsedMinutes = 30;
    breakAfterFinalPhase.timing.optionalTimedBreak = {
      minutes: 5,
      afterPhaseId: "independent-check-1",
    };
    expect(StudyRouteSchema.safeParse(breakAfterFinalPhase).success).toBe(false);
  });

  it("requires every target to be covered or explicitly deferred", () => {
    const uncovered = structuredClone(validRoute());
    for (const phase of uncovered.execution.orderedPhases) phase.targetIds = [IDS.firstTarget];
    uncovered.execution.completionEvidence[0].targetIds = [IDS.firstTarget];
    expect(StudyRouteSchema.safeParse(uncovered).success).toBe(false);

    uncovered.execution.deferredTargets = [{
      targetId: IDS.secondTarget,
      reason: "The available time cannot hold a coherent second-target sequence.",
    }];
    expect(StudyRouteSchema.safeParse(uncovered).success).toBe(true);
  });

  it("bounds one executable recipe to six active targets and four evidence checks", () => {
    const tooManyActive = structuredClone(validRoute());
    const extraTargets = Array.from({ length: 5 }, (_, index) => ({
      targetId: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      stage: "novice" as const,
      uncertainty: "high" as const,
      evidenceRefs: [],
    }));
    tooManyActive.target.targetStates.push(...extraTargets);
    tooManyActive.execution.orderedPhases[0].targetIds.push(...extraTargets.map((target) => target.targetId));
    expect(StudyRouteSchema.safeParse(tooManyActive).success).toBe(false);

    tooManyActive.execution.deferredTargets = extraTargets.map((target) => ({
      targetId: target.targetId,
      reason: "This target is tracked but deferred beyond the bounded active recipe.",
    }));
    tooManyActive.execution.orderedPhases[0].targetIds = [IDS.firstTarget, IDS.secondTarget];
    expect(StudyRouteSchema.safeParse(tooManyActive).success).toBe(true);

    const tooManyEvidenceChecks = structuredClone(validRoute());
    tooManyEvidenceChecks.execution.completionEvidence = Array.from({ length: 5 }, (_, index) => ({
      ...tooManyEvidenceChecks.execution.completionEvidence[0],
      evidenceId: `evidence-${index + 1}`,
    }));
    expect(StudyRouteSchema.safeParse(tooManyEvidenceChecks).success).toBe(false);
  });

  it("requires external routes to preserve a stable source reference", () => {
    const route = structuredClone(validRoute());
    route.target.sourceRequirements.sourceType = "trusted_external_source";
    route.target.sourceRequirements.groundingRequired = true;
    expect(StudyRouteSchema.safeParse(route).success).toBe(false);

    route.target.sourceRequirements.requiredSourceIds = ["workbook:chapter-4"];
    expect(StudyRouteSchema.safeParse(route).success).toBe(false);

    route.approach.executionEnvironment = "outside_yova";
    expect(StudyRouteSchema.safeParse(route).success).toBe(true);

    const inventedExternalIdentity = structuredClone(validRoute());
    inventedExternalIdentity.target.sourceRequirements.requiredSourceIds = ["material:not-actually-used"];
    expect(StudyRouteSchema.safeParse(inventedExternalIdentity).success).toBe(false);
  });
});
