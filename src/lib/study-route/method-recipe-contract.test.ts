import { describe, expect, it } from "vitest";
import {
  BLURTING_SUPPORTING_TECHNIQUE_ID,
  BLURTING_VISIBLE_METHOD_NAME,
  selectMethodRecipe,
} from "@/lib/learning/method-recipes";
import {
  BLURTING_PHASE_IDS,
  BLURTING_RECIPE_RUNTIME_REASONS,
  BLURTING_RECIPE_RUNTIME_RESULTS,
  BLURTING_RECIPE_RUNTIME_VERSION,
  allocateBlurtingPhaseMinutes,
  blurtingFinalCheckEvidenceId,
  blurtingMethodRecipeTrace,
  blurtingRecipeRuntimeTrace,
  blurtingStudyRouteIssue,
  isBlurtingStudyRoute,
} from "@/lib/study-route/method-recipe-contract";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

const IDS = {
  lineage: "11111111-1111-4111-8111-111111111111",
  revision: "22222222-2222-4222-8222-222222222222",
  plan: "33333333-3333-4333-8333-333333333333",
  session: "44444444-4444-4444-8444-444444444444",
  firstTarget: "55555555-5555-4555-8555-555555555555",
  secondTarget: "66666666-6666-4666-8666-666666666666",
} as const;

function validBlurtingRoute(
  executionEnvironment: "inside_yova" | "outside_yova" = "inside_yova",
  activeMinutes = 12,
): StudyRoute {
  const phaseMinutes = allocateBlurtingPhaseMinutes(activeMinutes);
  const decision = selectMethodRecipe({
    blurtingEnabled: true,
    learningMode: "study",
    primaryMethodId: "retrieval_practice",
    taskType: "conceptual_learning",
    knowledgeStage: "developing",
    isReview: false,
    activeMinutes,
    activeTargetCount: 2,
    comparisonSourceAvailable: true,
  });
  if (decision.kind !== "recipe") throw new Error("Expected eligible Blurting fixture.");

  return StudyRouteSchema.parse({
    identity: {
      routeLineageId: IDS.lineage,
      routeRevisionId: IDS.revision,
      revisionNumber: 1,
      schemaVersion: 1,
      lifecycleStatus: "committed",
      planId: IDS.plan,
      sessionId: IDS.session,
      createdAt: "2026-08-24T12:00:00.000Z",
      committedAt: "2026-08-24T12:01:00.000Z",
    },
    target: {
      taskFamily: "conceptual_learning",
      desiredOutcome: "Recall both mechanisms broadly, repair each gap, and verify them independently.",
      targetStates: [{
        targetId: IDS.firstTarget,
        stage: "developing",
        uncertainty: "medium",
        evidenceRefs: [],
      }, {
        targetId: IDS.secondTarget,
        stage: "retrieval_ready",
        uncertainty: "low",
        evidenceRefs: [],
      }],
      sourceRequirements: {
        sourceType: executionEnvironment === "outside_yova"
          ? "trusted_external_source"
          : "user_materials",
        requiredSourceIds: ["source:chapter-1"],
        groundingRequired: true,
        instructions: ["Compare the broad recall with the committed source before repairing gaps."],
      },
    },
    approach: {
      mode: "practice",
      executionEnvironment,
      primaryMethodId: "retrieval_practice",
      visibleMethodName: BLURTING_VISIBLE_METHOD_NAME,
      visibleSupportingTechniqueId: BLURTING_SUPPORTING_TECHNIQUE_ID,
      confidenceLevel: "medium",
    },
    timing: {
      activeMinutes,
      elapsedMinutes: activeMinutes,
      durationSource: "router_default",
    },
    execution: {
      orderedPhases: [{
        phaseId: BLURTING_PHASE_IDS[0],
        methodPhase: "retrieve",
        activeMinutes: phaseMinutes[0],
        targetIds: [IDS.firstTarget, IDS.secondTarget],
      }, {
        phaseId: BLURTING_PHASE_IDS[1],
        methodPhase: "repair",
        activeMinutes: phaseMinutes[1],
        targetIds: [IDS.firstTarget, IDS.secondTarget],
      }, {
        phaseId: BLURTING_PHASE_IDS[2],
        methodPhase: "transfer",
        activeMinutes: phaseMinutes[2],
        targetIds: [IDS.firstTarget, IDS.secondTarget],
      }],
      difficultyTier: "standard",
      initialSupport: "independent_start",
      activityLimit: 3,
      completionEvidence: [{
        evidenceId: blurtingFinalCheckEvidenceId(IDS.firstTarget),
        targetIds: [IDS.firstTarget],
        kind: "verification",
        description: "Answer a fresh closed-source check for the first target independently.",
        requiresIndependentAttempt: true,
      }, {
        evidenceId: blurtingFinalCheckEvidenceId(IDS.secondTarget),
        targetIds: [IDS.secondTarget],
        kind: "verification",
        description: "Answer a fresh closed-source check for the second target independently.",
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
      shortReason: "Broad recall followed by source comparison and a fresh check fits these targets.",
      taskRequirements: ["Recall broadly before comparing with the source."],
      learnerDeclarations: [],
      observations: [],
      uncertainties: [],
    },
    provenance: {
      routerVersion: `base-router-v1+${BLURTING_RECIPE_RUNTIME_VERSION}`,
      profileVersion: "profile-v1",
      evidenceRefs: [],
      ruleTrace: [
        blurtingMethodRecipeTrace(decision),
        blurtingRecipeRuntimeTrace(executionEnvironment),
      ],
    },
  });
}

describe("Blurting StudyRoute contract", () => {
  it("accepts exact inside- and outside-YOVA routes without consulting rollout state", () => {
    for (const environment of ["inside_yova", "outside_yova"] as const) {
      const route = validBlurtingRoute(environment);

      expect(blurtingStudyRouteIssue(route)).toBeNull();
      expect(isBlurtingStudyRoute(route)).toBe(true);
      expect(route.provenance.ruleTrace.at(-1)).toEqual({
        ruleId: BLURTING_RECIPE_RUNTIME_VERSION,
        result: BLURTING_RECIPE_RUNTIME_RESULTS[environment],
        reason: BLURTING_RECIPE_RUNTIME_REASONS[environment],
        evidenceRefs: [],
      });
    }

    expect(selectMethodRecipe({
      learningMode: "study",
      primaryMethodId: "retrieval_practice",
      taskType: "conceptual_learning",
      knowledgeStage: "developing",
      isReview: false,
      activeMinutes: 12,
      activeTargetCount: 2,
      comparisonSourceAvailable: true,
    })).toMatchObject({ kind: "baseline", recipeId: null });
  });

  it("freezes the exact recipe and environment-specific runtime traces", () => {
    const route = validBlurtingRoute();
    const decision = selectMethodRecipe({
      blurtingEnabled: true,
      learningMode: "study",
      primaryMethodId: "retrieval_practice",
      taskType: "conceptual_learning",
      knowledgeStage: "developing",
      isReview: false,
      activeMinutes: 12,
      activeTargetCount: 2,
      comparisonSourceAvailable: true,
    });
    if (decision.kind !== "recipe") throw new Error("Expected recipe decision.");
    const policyTrace = blurtingMethodRecipeTrace(decision);
    const runtimeTrace = blurtingRecipeRuntimeTrace("inside_yova");

    expect(policyTrace).toEqual(route.provenance.ruleTrace[0]);
    expect(policyTrace.result).toBe("recipe:blurting_v1");
    expect(Object.isFrozen(policyTrace)).toBe(true);
    expect(Object.isFrozen(policyTrace.evidenceRefs)).toBe(true);
    expect(Object.isFrozen(runtimeTrace)).toBe(true);
    expect(Object.isFrozen(runtimeTrace.evidenceRefs)).toBe(true);
    expect(allocateBlurtingPhaseMinutes(10)).toEqual([4, 3, 3]);
    expect(allocateBlurtingPhaseMinutes(11)).toEqual([4, 4, 3]);
    expect(allocateBlurtingPhaseMinutes(12)).toEqual([4, 4, 4]);
    expect(allocateBlurtingPhaseMinutes(60)).toEqual([20, 20, 20]);
    expect(() => allocateBlurtingPhaseMinutes(61)).toThrow(/between 3 and 60/i);
    expect(Object.isFrozen(allocateBlurtingPhaseMinutes(10))).toBe(true);
    expect(blurtingFinalCheckEvidenceId(IDS.firstTarget)).toBe(
      `blurting-final-check:${IDS.firstTarget}`,
    );
  });

  it("makes the technique, exact name, and one runtime router component bidirectional", () => {
    const unknownTechnique = structuredClone(validBlurtingRoute());
    unknownTechnique.approach.visibleMethodName = "Active Recall";
    unknownTechnique.approach.visibleSupportingTechniqueId = "unknown-recipe-v1";
    unknownTechnique.provenance.routerVersion = "base-router-v1";
    unknownTechnique.provenance.ruleTrace = [];
    expect(StudyRouteSchema.safeParse(unknownTechnique).success).toBe(false);

    const missingTechnique = structuredClone(validBlurtingRoute());
    delete missingTechnique.approach.visibleSupportingTechniqueId;
    expect(StudyRouteSchema.safeParse(missingTechnique).success).toBe(false);

    const wrongName = structuredClone(validBlurtingRoute());
    wrongName.approach.visibleMethodName = "Active Recall";
    expect(StudyRouteSchema.safeParse(wrongName).success).toBe(false);

    const missingComponent = structuredClone(validBlurtingRoute());
    missingComponent.provenance.routerVersion = "base-router-v1";
    expect(StudyRouteSchema.safeParse(missingComponent).success).toBe(false);

    const duplicateComponent = structuredClone(validBlurtingRoute());
    duplicateComponent.provenance.routerVersion += `+${BLURTING_RECIPE_RUNTIME_VERSION}`;
    expect(StudyRouteSchema.safeParse(duplicateComponent).success).toBe(false);

    const componentOnly = structuredClone(validBlurtingRoute());
    componentOnly.approach.visibleMethodName = "Active Recall";
    delete componentOnly.approach.visibleSupportingTechniqueId;
    expect(StudyRouteSchema.safeParse(componentOnly).success).toBe(false);
  });

  it("uses the latest append-only recipe and runtime-policy traces", () => {
    const withHistory = structuredClone(validBlurtingRoute());
    withHistory.provenance.ruleTrace.unshift({
      ruleId: "method_recipe_v1",
      result: "recipe:blurting_v1",
      reason: "Historical recipe facts may differ from the current route revision.",
      evidenceRefs: [],
    }, {
      ruleId: "method_runtime_capability_v1",
      result: "full:dedicated_runtime:recovery_candidate",
      reason: "This historical generic runtime trace predates the active Blurting recipe.",
      evidenceRefs: [],
    });
    expect(StudyRouteSchema.safeParse(withHistory).success).toBe(true);

    const genericRouter = structuredClone(withHistory);
    genericRouter.provenance.routerVersion += "+method_runtime_capability_v1";
    expect(StudyRouteSchema.safeParse(genericRouter).success).toBe(false);

    const latestGeneric = structuredClone(withHistory);
    latestGeneric.provenance.ruleTrace.push({
      ruleId: "method_runtime_capability_v1",
      result: "full:dedicated_runtime:recovery_none",
      reason: "A later generic trace cannot be current while Blurting remains active.",
      evidenceRefs: [],
    });
    expect(StudyRouteSchema.safeParse(latestGeneric).success).toBe(false);

    const staleRuntime = structuredClone(validBlurtingRoute());
    staleRuntime.provenance.ruleTrace.at(-1)!.result = "streamed:dedicated_runtime:recovery_none";
    expect(StudyRouteSchema.safeParse(staleRuntime).success).toBe(false);

    const stalePolicy = structuredClone(validBlurtingRoute());
    stalePolicy.provenance.ruleTrace[0]!.reason = "A stale or reconstructed policy reason.";
    expect(StudyRouteSchema.safeParse(stalePolicy).success).toBe(false);

    const ordinarySuccessor = structuredClone(withHistory);
    ordinarySuccessor.approach.visibleMethodName = "Active Recall";
    delete ordinarySuccessor.approach.visibleSupportingTechniqueId;
    ordinarySuccessor.provenance.routerVersion = ordinarySuccessor.provenance.routerVersion
      .split("+")
      .filter((component) => component !== BLURTING_RECIPE_RUNTIME_VERSION)
      .concat("method_runtime_capability_v1")
      .join("+");
    ordinarySuccessor.provenance.ruleTrace.push({
      ruleId: "method_runtime_capability_v1",
      result: "full:dedicated_runtime:recovery_candidate",
      reason: "The ordinary successor appends its current generic runtime trace.",
      evidenceRefs: [],
    });
    expect(StudyRouteSchema.safeParse(ordinarySuccessor).success).toBe(true);
    expect(isBlurtingStudyRoute(ordinarySuccessor)).toBe(false);
  });

  it("reuses the exact policy boundary for stage, review, duration, and source comparison", () => {
    const novice = structuredClone(validBlurtingRoute());
    novice.target.targetStates[0]!.stage = "novice";
    expect(StudyRouteSchema.safeParse(novice).success).toBe(false);

    const scheduled = structuredClone(validBlurtingRoute());
    scheduled.timing.durationSource = "scheduled_review";
    expect(StudyRouteSchema.safeParse(scheduled).success).toBe(false);

    const tooShort = structuredClone(validBlurtingRoute());
    tooShort.timing.activeMinutes = 9;
    tooShort.timing.elapsedMinutes = 9;
    tooShort.execution.orderedPhases.forEach((phase) => {
      phase.activeMinutes = 3;
    });
    expect(StudyRouteSchema.safeParse(tooShort).success).toBe(false);

    const atRepresentableLimit = validBlurtingRoute("inside_yova", 60);
    expect(atRepresentableLimit.execution.orderedPhases.map((phase) => (
      phase.activeMinutes
    ))).toEqual([20, 20, 20]);
    expect(blurtingStudyRouteIssue(atRepresentableLimit)).toBeNull();

    const aboveRepresentableLimit = structuredClone(atRepresentableLimit);
    aboveRepresentableLimit.timing.activeMinutes = 61;
    aboveRepresentableLimit.timing.elapsedMinutes = 61;
    aboveRepresentableLimit.execution.orderedPhases[0]!.activeMinutes = 21;
    expect(blurtingStudyRouteIssue(aboveRepresentableLimit)).toMatch(
      /61 active minutes exceed its 60-minute representable boundary/i,
    );
    expect(StudyRouteSchema.safeParse(aboveRepresentableLimit).success).toBe(false);

    const ordinaryLongRoute = structuredClone(aboveRepresentableLimit);
    ordinaryLongRoute.approach.visibleMethodName = "Active Recall";
    delete ordinaryLongRoute.approach.visibleSupportingTechniqueId;
    ordinaryLongRoute.provenance.routerVersion = "base-router-v1+method_runtime_capability_v1";
    expect(blurtingStudyRouteIssue(ordinaryLongRoute)).toBeNull();
    expect(StudyRouteSchema.safeParse(ordinaryLongRoute).success).toBe(true);

    const ungrounded = structuredClone(validBlurtingRoute());
    ungrounded.target.sourceRequirements.groundingRequired = false;
    expect(StudyRouteSchema.safeParse(ungrounded).success).toBe(false);

    const generatedSource = structuredClone(validBlurtingRoute());
    generatedSource.target.sourceRequirements.sourceType = "yova_generated";
    generatedSource.target.sourceRequirements.requiredSourceIds = [];
    expect(StudyRouteSchema.safeParse(generatedSource).success).toBe(false);

    const unidentifiedSource = structuredClone(validBlurtingRoute());
    unidentifiedSource.target.sourceRequirements.requiredSourceIds = [];
    expect(StudyRouteSchema.safeParse(unidentifiedSource).success).toBe(false);

    const supportedStart = structuredClone(validBlurtingRoute());
    supportedStart.execution.initialSupport = "supported_start";
    expect(StudyRouteSchema.safeParse(supportedStart).success).toBe(false);

    const insufficientActivityCapacity = structuredClone(validBlurtingRoute());
    insufficientActivityCapacity.execution.activityLimit = 2;
    expect(StudyRouteSchema.safeParse(insufficientActivityCapacity).success).toBe(false);
  });

  it("requires exact active-target phase coverage and one final verification per target", () => {
    const incompleteRepair = structuredClone(validBlurtingRoute());
    incompleteRepair.execution.orderedPhases[1]!.targetIds = [IDS.firstTarget];
    expect(StudyRouteSchema.safeParse(incompleteRepair).success).toBe(false);

    const wrongPhase = structuredClone(validBlurtingRoute());
    wrongPhase.execution.orderedPhases[2]!.methodPhase = "retrieve";
    expect(StudyRouteSchema.safeParse(wrongPhase).success).toBe(false);

    const wrongPhaseId = structuredClone(validBlurtingRoute());
    wrongPhaseId.execution.orderedPhases[0]!.phaseId = "blurting-retrieve";
    expect(StudyRouteSchema.safeParse(wrongPhaseId).success).toBe(false);

    const nondeterministicMinutes = structuredClone(validBlurtingRoute());
    nondeterministicMinutes.execution.orderedPhases[0]!.activeMinutes = 5;
    nondeterministicMinutes.execution.orderedPhases[1]!.activeMinutes = 3;
    expect(StudyRouteSchema.safeParse(nondeterministicMinutes).success).toBe(false);

    const combinedEvidence = structuredClone(validBlurtingRoute());
    combinedEvidence.execution.completionEvidence = [{
      ...combinedEvidence.execution.completionEvidence[0]!,
      targetIds: [IDS.firstTarget, IDS.secondTarget],
    }];
    expect(StudyRouteSchema.safeParse(combinedEvidence).success).toBe(false);

    const nonIndependent = structuredClone(validBlurtingRoute());
    nonIndependent.execution.completionEvidence[0]!.requiresIndependentAttempt = false;
    expect(StudyRouteSchema.safeParse(nonIndependent).success).toBe(false);

    const wrongEvidenceId = structuredClone(validBlurtingRoute());
    wrongEvidenceId.execution.completionEvidence[0]!.evidenceId = "blurting-final-check:wrong-target";
    expect(StudyRouteSchema.safeParse(wrongEvidenceId).success).toBe(false);
  });

  it("does not allow a method-only alternative to encode Blurting", () => {
    for (const alternative of [{
      alternativeId: "method-alternative:blurting_v1",
      visibleMethodName: "Active Recall",
    }, {
      alternativeId: "method-alternative:retrieval_practice",
      visibleMethodName: "Blurting",
    }]) {
      const route = structuredClone(validBlurtingRoute());
      route.agency.alternatives = [{
        ...alternative,
        mode: "practice",
        executionEnvironment: "inside_yova",
        primaryMethodId: "retrieval_practice",
        activeMinutes: 10,
        tradeoff: "This invalid alternative tries to encode a supporting recipe as a core method.",
      }];
      expect(StudyRouteSchema.safeParse(route).success).toBe(false);
    }
  });
});
