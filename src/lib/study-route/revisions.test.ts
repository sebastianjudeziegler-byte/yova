import { describe, expect, it } from "vitest";
import { selectMethodRecipe } from "@/lib/learning/method-recipes";
import {
  commitStudyRouteRevision,
  createSuccessorStudyRoute,
  freezeStudyRoute,
  hasMaterialStudyRouteChange,
  materialStudyRouteChanges,
  supersedeStudyRouteRevision,
} from "@/lib/study-route/revisions";
import {
  BLURTING_PHASE_IDS,
  BLURTING_RECIPE_RUNTIME_VERSION,
  blurtingFinalCheckEvidenceId,
  blurtingMethodRecipeTrace,
  blurtingRecipeRuntimeTrace,
} from "@/lib/study-route/method-recipe-contract";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

const REVISION_1 = "22222222-2222-4222-8222-222222222222";
const REVISION_2 = "77777777-7777-4777-8777-777777777777";
const TARGET_ID = "55555555-5555-4555-8555-555555555555";

function route(): StudyRoute {
  return StudyRouteSchema.parse({
    identity: {
      routeLineageId: "11111111-1111-4111-8111-111111111111",
      routeRevisionId: REVISION_1,
      revisionNumber: 1,
      schemaVersion: 1,
      lifecycleStatus: "committed",
      planId: "33333333-3333-4333-8333-333333333333",
      sessionId: "44444444-4444-4444-8444-444444444444",
      createdAt: "2026-08-23T09:00:00.000Z",
      committedAt: "2026-08-23T09:01:00.000Z",
    },
    target: {
      taskFamily: "conceptual_learning",
      desiredOutcome: "Explain the mechanism independently.",
      targetStates: [{
        targetId: TARGET_ID,
        stage: "novice",
        uncertainty: "high",
        evidenceRefs: [],
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
      activeMinutes: 15,
      elapsedMinutes: 15,
      durationSource: "router_default",
      hardMaximumMinutes: 25,
    },
    execution: {
      orderedPhases: [
        { phaseId: "model", methodPhase: "model", activeMinutes: 8, targetIds: [TARGET_ID] },
        { phaseId: "explain", methodPhase: "explain", activeMinutes: 7, targetIds: [TARGET_ID] },
      ],
      difficultyTier: "foundational",
      initialSupport: "supported_start",
      activityLimit: 4,
      completionEvidence: [{
        evidenceId: "independent-explanation",
        targetIds: [TARGET_ID],
        kind: "explanation",
        description: "Explain the mechanism without looking at the model.",
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
      shortReason: "A model followed by self-explanation fits this new concept.",
      taskRequirements: ["Build an accurate causal model."],
      learnerDeclarations: [],
      observations: [],
      uncertainties: ["No independent target evidence exists yet."],
    },
    provenance: {
      routerVersion: "router-v1",
      profileVersion: "legacy_unknown",
      evidenceRefs: [],
      ruleTrace: [{
        ruleId: "task-stage-baseline",
        result: "selected",
        reason: "The novice conceptual target needs a teaching-first route.",
        evidenceRefs: [],
      }],
    },
  });
}

function clone(value: StudyRoute) {
  return structuredClone(value);
}

describe("StudyRoute material changes", () => {
  it("ignores explanation, confidence, duration provenance, identifiers, and set ordering", () => {
    const previous = route();
    const candidate = clone(previous);
    candidate.identity.routeRevisionId = REVISION_2;
    candidate.explanation.shortReason = "The same route can have refreshed display copy without changing the decision.";
    candidate.approach.visibleMethodName = "Self-explanation";
    candidate.approach.confidenceLevel = "high";
    candidate.timing.durationSource = "profile_recommendation";
    candidate.provenance.routerVersion = "router-v2";

    expect(materialStudyRouteChanges(previous, candidate)).toEqual([]);
    expect(hasMaterialStudyRouteChange(previous, candidate)).toBe(false);
  });

  it("classifies the exact material decision surfaces", () => {
    const previous = route();
    const candidate = clone(previous);
    candidate.target.targetStates[0].stage = "developing";
    candidate.approach.mode = "practice";
    candidate.approach.executionEnvironment = "outside_yova";
    candidate.approach.primaryMethodId = "retrieval_practice";
    candidate.timing.activeMinutes = 20;
    candidate.timing.elapsedMinutes = 20;
    candidate.execution.orderedPhases = [
      { phaseId: "retrieve", methodPhase: "retrieve", activeMinutes: 12, targetIds: [TARGET_ID] },
      { phaseId: "repair", methodPhase: "repair", activeMinutes: 8, targetIds: [TARGET_ID] },
    ];
    candidate.execution.initialSupport = "independent_start";
    candidate.execution.completionEvidence[0].kind = "retrieval";

    expect(materialStudyRouteChanges(previous, candidate)).toEqual([
      "targets",
      "mode",
      "execution_environment",
      "primary_method",
      "duration",
      "phase_order",
      "support_bounds",
      "review_contract",
    ]);
  });

  it("treats per-target review timing as review-contract change, not target-state drift", () => {
    const previous = route();
    const candidate = clone(previous);
    candidate.target.targetStates[0].nextReview = {
      scheduledFor: "2026-08-26T09:00:00.000Z",
      reviewType: "retrieval_check",
      activeMinutes: 3,
      reason: "Return after a delay to verify retention.",
      evidenceRefs: [],
    };

    expect(materialStudyRouteChanges(previous, candidate)).toEqual(["review_contract"]);
  });

  it("treats a supporting method recipe marker as its own material change", () => {
    const baseline = clone(route());
    baseline.target.targetStates[0].stage = "developing";
    baseline.target.sourceRequirements.sourceType = "user_materials";
    baseline.target.sourceRequirements.requiredSourceIds = ["source:chapter-1"];
    baseline.target.sourceRequirements.groundingRequired = true;
    baseline.approach = {
      ...baseline.approach,
      mode: "practice",
      primaryMethodId: "retrieval_practice",
      visibleMethodName: "Active Recall",
    };
    baseline.timing.activeMinutes = 12;
    baseline.timing.elapsedMinutes = 12;
    baseline.execution.orderedPhases = [{
      phaseId: "retrieve",
      methodPhase: "retrieve",
      activeMinutes: 6,
      targetIds: [TARGET_ID],
    }, {
      phaseId: "repair",
      methodPhase: "repair",
      activeMinutes: 6,
      targetIds: [TARGET_ID],
    }];
    baseline.execution.initialSupport = "independent_start";
    baseline.execution.completionEvidence = [{
      evidenceId: blurtingFinalCheckEvidenceId(TARGET_ID),
      targetIds: [TARGET_ID],
      kind: "verification",
      description: "Answer one fresh final check without reopening the source.",
      requiresIndependentAttempt: true,
    }];
    const previous = StudyRouteSchema.parse(baseline);
    const decision = selectMethodRecipe({
      blurtingEnabled: true,
      learningMode: "study",
      primaryMethodId: "retrieval_practice",
      taskType: "conceptual_learning",
      knowledgeStage: "developing",
      isReview: false,
      activeMinutes: 12,
      activeTargetCount: 1,
      comparisonSourceAvailable: true,
    });
    if (decision.kind !== "recipe") throw new Error("Expected eligible Blurting fixture.");
    const candidate = clone(previous);
    candidate.approach.visibleMethodName = "Blurting";
    candidate.approach.visibleSupportingTechniqueId = "blurting_v1";
    candidate.execution.orderedPhases = [{
      phaseId: BLURTING_PHASE_IDS[0],
      methodPhase: "retrieve",
      activeMinutes: 4,
      targetIds: [TARGET_ID],
    }, {
      phaseId: BLURTING_PHASE_IDS[1],
      methodPhase: "repair",
      activeMinutes: 4,
      targetIds: [TARGET_ID],
    }, {
      phaseId: BLURTING_PHASE_IDS[2],
      methodPhase: "transfer",
      activeMinutes: 4,
      targetIds: [TARGET_ID],
    }];
    candidate.provenance.routerVersion += `+${BLURTING_RECIPE_RUNTIME_VERSION}`;
    const recipeTrace = blurtingMethodRecipeTrace(decision);
    const runtimeTrace = blurtingRecipeRuntimeTrace("inside_yova");
    candidate.provenance.ruleTrace.push(
      { ...recipeTrace, evidenceRefs: [...recipeTrace.evidenceRefs] },
      { ...runtimeTrace, evidenceRefs: [...runtimeTrace.evidenceRefs] },
    );

    expect(materialStudyRouteChanges(previous, candidate)).toEqual([
      "method_recipe",
      "phase_order",
    ]);
  });
});

describe("StudyRoute immutable revision lifecycle", () => {
  it("creates an immutable provisional direct successor and records why", () => {
    const previous = freezeStudyRoute(route());
    const nextTarget = structuredClone(previous.target) as StudyRoute["target"];
    nextTarget.targetStates[0].stage = "developing";
    nextTarget.targetStates[0].uncertainty = "medium";

    const successor = createSuccessorStudyRoute({
      previous: previous as StudyRoute,
      routeRevisionId: REVISION_2,
      createdAt: "2026-08-24T09:00:00.000Z",
      changeReason: "A completed independent check changed the target snapshot.",
      changes: { target: nextTarget },
    });

    expect(successor.identity).toMatchObject({
      routeLineageId: previous.identity.routeLineageId,
      routeRevisionId: REVISION_2,
      revisionNumber: 2,
      lifecycleStatus: "provisional",
      supersedesRevisionId: REVISION_1,
    });
    expect(successor.identity).not.toHaveProperty("committedAt");
    expect(successor.provenance.ruleTrace.at(-1)).toMatchObject({
      ruleId: "study_route.material_successor",
      reason: "A completed independent check changed the target snapshot.",
    });
    expect(previous.target.targetStates[0].stage).toBe("novice");
    expect(Object.isFrozen(successor)).toBe(true);
    expect(Object.isFrozen(successor.target.targetStates)).toBe(true);
    expect(Object.isFrozen(successor.target.targetStates[0])).toBe(true);
  });

  it("refuses explanation-only revisions and non-committed predecessors", () => {
    expect(() => createSuccessorStudyRoute({
      previous: route(),
      routeRevisionId: REVISION_2,
      createdAt: "2026-08-24T09:00:00.000Z",
      changeReason: "Copy edit only.",
      changes: {
        explanation: {
          ...route().explanation,
          shortReason: "This changes copy but does not change the route itself.",
        },
      },
    })).toThrow("material route change");

    const provisional = clone(route());
    provisional.identity.lifecycleStatus = "provisional";
    delete provisional.identity.committedAt;
    expect(() => createSuccessorStudyRoute({
      previous: provisional,
      routeRevisionId: REVISION_2,
      createdAt: "2026-08-24T09:00:00.000Z",
      changeReason: "Invalid predecessor.",
      changes: { approach: { ...provisional.approach, mode: "practice" } },
    })).toThrow("committed revision");
  });

  it("refuses a successor timestamp that predates the committed predecessor", () => {
    const previous = route();
    expect(() => createSuccessorStudyRoute({
      previous,
      routeRevisionId: REVISION_2,
      createdAt: "2026-08-23T09:00:30.000Z",
      changeReason: "This timestamp is earlier than the predecessor commit.",
      changes: {
        approach: {
          ...previous.approach,
          mode: "practice",
        },
      },
    })).toThrow("before its predecessor was committed");
  });

  it("commits the successor before superseding the prior committed revision", () => {
    const previous = route();
    const successor = createSuccessorStudyRoute({
      previous,
      routeRevisionId: REVISION_2,
      createdAt: "2026-08-24T09:00:00.000Z",
      changeReason: "The next route begins with independent retrieval.",
      changes: {
        approach: {
          ...previous.approach,
          mode: "practice",
          primaryMethodId: "retrieval_practice",
          visibleMethodName: "Active Recall",
        },
      },
    });

    expect(() => supersedeStudyRouteRevision(previous, successor as StudyRoute)).toThrow("committed first");

    const committedSuccessor = commitStudyRouteRevision(
      successor as StudyRoute,
      "2026-08-24T09:01:00.000Z",
    );
    const superseded = supersedeStudyRouteRevision(previous, committedSuccessor as StudyRoute);

    expect(committedSuccessor.identity.lifecycleStatus).toBe("committed");
    expect(committedSuccessor.identity.committedAt).toBe("2026-08-24T09:01:00.000Z");
    expect(superseded.identity.lifecycleStatus).toBe("superseded");
    expect(superseded.identity.routeRevisionId).toBe(REVISION_1);
    expect(superseded.identity.committedAt).toBe(previous.identity.committedAt);
  });
});
