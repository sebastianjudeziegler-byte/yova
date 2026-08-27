import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import {
  CORE_METHOD_CATALOG,
  CORE_METHOD_IDS,
  LEGACY_CORE_METHOD_NAMES,
  METHOD_PRESENTATION_POLICY_VERSION,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import {
  BLURTING_ORDERED_PHASES,
  BLURTING_SUPPORTING_TECHNIQUE_ID,
  BLURTING_VISIBLE_METHOD_NAME,
  selectMethodRecipe,
} from "@/lib/learning/method-recipes";
import type { GenerationPersonalizationContext } from "@/lib/personalization/personalization-generation";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { METHOD_RUNTIME_CAPABILITY_POLICY_VERSION } from "@/lib/session-generation/method-runtime-capability";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { studyRouteToLegacySessionProjection } from "@/lib/study-route/adapters";
import {
  COMMITTED_METHOD_CHOICE_POLICY_VERSION,
  CommittedMethodChoiceError,
  committedMethodChoiceErrorStatus,
  createCommittedMethodChoiceSuccessor,
} from "@/lib/study-route/committed-method-choice";
import {
  integrateInitialPlanMethodRoutes,
  type InitialPlanMethodRoutingContext,
} from "@/lib/study-route/initial-plan-method-routing";
import {
  BLURTING_PHASE_IDS,
  BLURTING_RECIPE_RUNTIME_VERSION,
  blurtingFinalCheckEvidenceId,
  blurtingMethodRecipeTrace,
  blurtingRecipeRuntimeTrace,
} from "@/lib/study-route/method-recipe-contract";
import { materialStudyRouteChanges } from "@/lib/study-route/revisions";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

const GENERATED_AT = new Date("2026-08-24T12:00:00.000Z");
const COMMITTED_AT = "2026-08-24T12:01:00.000Z";
const FIRST_CHANGE = "2026-08-24T12:05:00.000Z";
const SECOND_CHANGE = "2026-08-24T12:06:00.000Z";
const FIRST_SUCCESSOR_ID = "91000000-0000-4000-8000-000000000001";
const SECOND_SUCCESSOR_ID = "91000000-0000-4000-8000-000000000002";

const request = PlanGenerationRequestSchema.parse({
  intent: "plan",
  learningIntent: "learn",
  goal: "Learn why the calculus product rule has two derivative terms, then solve unfamiliar product-rule problems accurately.",
  startingContext: "I have not learned the product rule yet.",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: "2026-09-10T20:00:00.000Z",
  timeZone: "UTC",
  diagnosticResponses: [],
  availability: [{ day: "Every day", window: "Evening", minutes: 25 }],
  profileSummary: "The learner wants concise teaching followed by independent practice.",
});

describe("committed StudyRoute method choice", () => {
  it("commits one canonical direct successor and changes only method-owned route surfaces", () => {
    const plan = activeRoutedPlan();
    const session = readySessionWithAlternative(plan);
    const previous = route(session.studyRoute);
    const methodId = previous.agency.alternatives[0]!.primaryMethodId;
    const originalPlan = structuredClone(plan);

    const result = createCommittedMethodChoiceSuccessor({
      plan,
      session,
      previousRoute: previous,
      expectedRouteRevisionId: previous.identity.routeRevisionId,
      routeRevisionId: FIRST_SUCCESSOR_ID,
      methodId,
      changedAt: FIRST_CHANGE,
    });

    expect(result.status).toBe("updated");
    expect(plan).toEqual(originalPlan);
    const successor = result.session.studyRoute;
    expect(successor.identity).toMatchObject({
      routeLineageId: previous.identity.routeLineageId,
      routeRevisionId: FIRST_SUCCESSOR_ID,
      revisionNumber: previous.identity.revisionNumber + 1,
      lifecycleStatus: "committed",
      planId: plan.id,
      sessionId: session.id,
      createdAt: FIRST_CHANGE,
      committedAt: FIRST_CHANGE,
      supersedesRevisionId: previous.identity.routeRevisionId,
    });
    expect(successor.approach.primaryMethodId).toBe(methodId);
    expect(successor.agency).toMatchObject({
      controlMode: "learner_customizes",
      selectedBy: "learner",
      override: {
        requestedAt: FIRST_CHANGE,
        changedFields: ["primary_method"],
      },
    });
    expect(successor.explanation.shortReason).toMatch(/^You chose/u);
    expect(materialStudyRouteChanges(previous, successor)).toEqual([
      "primary_method",
      "phase_order",
    ]);
    expect(successor.target).toEqual(previous.target);
    expect(successor.timing).toEqual(previous.timing);
    expect(successor.approach).toMatchObject({
      mode: previous.approach.mode,
      executionEnvironment: previous.approach.executionEnvironment,
      confidenceLevel: previous.approach.confidenceLevel,
    });
    expect(successor.execution).toMatchObject({
      difficultyTier: previous.execution.difficultyTier,
      initialSupport: previous.execution.initialSupport,
      completionEvidence: previous.execution.completionEvidence,
      deferredTargets: previous.execution.deferredTargets,
    });
    expect(successor.provenance.profileVersion).toBe(
      previous.provenance.profileVersion,
    );
    expect(successor.provenance.evidenceRefs).toEqual(expect.arrayContaining([
      `route-revision:${previous.identity.routeRevisionId}`,
      expect.stringMatching(/^learner-choice:committed-route:/u),
    ]));
    expect(successor.provenance.ruleTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: COMMITTED_METHOD_CHOICE_POLICY_VERSION,
        result: `${previous.approach.primaryMethodId}->${methodId}`,
      }),
      expect.objectContaining({
        ruleId: "canonical_method_selection_v1",
        result: `learner_choice:${methodId}`,
      }),
      expect.objectContaining({
        ruleId: "study_route.material_successor",
      }),
    ]));
    expect(successor.provenance.ruleTrace.length).toBeLessThanOrEqual(200);
    expect(successor.provenance.evidenceRefs.length).toBeLessThanOrEqual(100);
    expect(successor.provenance.routerVersion.split("+").filter((component) => (
      component === METHOD_PRESENTATION_POLICY_VERSION
    ))).toHaveLength(1);
    expect(successor.provenance.routerVersion.length).toBeLessThanOrEqual(256);
    expect(successor.provenance.ruleTrace.filter((entry) => (
      entry.ruleId === METHOD_PRESENTATION_POLICY_VERSION
    ))).toHaveLength(1);
    expect(result.session).toEqual({
      id: session.id,
      method: successor.approach.visibleMethodName,
      methodReason: successor.explanation.shortReason,
      estimatedMinutes: successor.timing.activeMinutes,
      studyRoute: successor,
    });
  });

  it("returns the current narrow projection without creating a no-op revision", () => {
    const plan = activeRoutedPlan();
    const session = readySessionWithAlternative(plan);
    const previous = route(session.studyRoute);

    const result = createCommittedMethodChoiceSuccessor({
      plan,
      session,
      previousRoute: previous,
      expectedRouteRevisionId: previous.identity.routeRevisionId,
      routeRevisionId: FIRST_SUCCESSOR_ID,
      methodId: previous.approach.primaryMethodId,
      changedAt: FIRST_CHANGE,
    });

    expect(result.status).toBe("unchanged");
    expect(result.session.studyRoute).toEqual(previous);
    expect(result.session.studyRoute.identity.routeRevisionId).toBe(
      previous.identity.routeRevisionId,
    );
    expect(result.session.studyRoute.provenance.ruleTrace).toEqual(
      previous.provenance.ruleTrace,
    );
  });

  it("supports another exact learner choice as the next bounded revision", () => {
    const plan = activeRoutedPlan();
    const session = readySessionWithAlternative(plan);
    const previous = route(session.studyRoute);
    const firstMethod = previous.agency.alternatives[0]!.primaryMethodId;
    const first = createCommittedMethodChoiceSuccessor({
      plan,
      session,
      previousRoute: previous,
      expectedRouteRevisionId: previous.identity.routeRevisionId,
      routeRevisionId: FIRST_SUCCESSOR_ID,
      methodId: firstMethod,
      changedAt: FIRST_CHANGE,
    });
    const firstSession = applyProjection(session, first.session);
    const firstPlan = replaceSession(plan, firstSession);
    const firstRoute = first.session.studyRoute;
    const secondMethod = firstRoute.agency.alternatives[0]!.primaryMethodId;

    const second = createCommittedMethodChoiceSuccessor({
      plan: firstPlan,
      session: firstSession,
      previousRoute: firstRoute,
      expectedRouteRevisionId: firstRoute.identity.routeRevisionId,
      routeRevisionId: SECOND_SUCCESSOR_ID,
      methodId: secondMethod,
      changedAt: SECOND_CHANGE,
    });

    expect(second.status).toBe("updated");
    expect(second.session.studyRoute.identity).toMatchObject({
      routeLineageId: previous.identity.routeLineageId,
      routeRevisionId: SECOND_SUCCESSOR_ID,
      revisionNumber: previous.identity.revisionNumber + 2,
      supersedesRevisionId: FIRST_SUCCESSOR_ID,
    });
    expect(second.session.studyRoute.provenance.evidenceRefs).toContain(
      `route-revision:${FIRST_SUCCESSOR_ID}`,
    );
    expect(second.session.studyRoute.provenance.ruleTrace.filter((entry) => (
      entry.ruleId === COMMITTED_METHOD_CHOICE_POLICY_VERSION
    ))).toHaveLength(2);
    expect(second.session.studyRoute.provenance.ruleTrace.filter((entry) => (
      entry.ruleId === METHOD_PRESENTATION_POLICY_VERSION
    ))).toHaveLength(1);
    expect(second.session.studyRoute.provenance.routerVersion.split("+").filter((component) => (
      component === METHOD_PRESENTATION_POLICY_VERSION
    ))).toHaveLength(1);
    expect(second.session.studyRoute.provenance.ruleTrace.length)
      .toBeLessThanOrEqual(200);
  });

  it("leaves Blurting as one bounded successor and keeps recipe history through a later choice", () => {
    const { plan, session } = activePlanWithBlurtingChoice();
    const blurting = route(session.studyRoute);
    const methodId = blurting.agency.alternatives[0]!.primaryMethodId;
    const historicalRecipeTraces = blurting.provenance.ruleTrace.filter((entry) => (
      entry.ruleId === "method_recipe_v1"
      || entry.ruleId === BLURTING_RECIPE_RUNTIME_VERSION
    ));
    const preservedRouterComponents = blurting.provenance.routerVersion
      .split("+")
      .filter((component) => component !== BLURTING_RECIPE_RUNTIME_VERSION);

    expect(blurting.agency.alternatives.every((alternative) => (
      alternative.visibleMethodName !== BLURTING_VISIBLE_METHOD_NAME
      && alternative.alternativeId !== BLURTING_SUPPORTING_TECHNIQUE_ID
    ))).toBe(true);

    const first = createCommittedMethodChoiceSuccessor({
      plan,
      session,
      previousRoute: blurting,
      expectedRouteRevisionId: blurting.identity.routeRevisionId,
      routeRevisionId: FIRST_SUCCESSOR_ID,
      methodId,
      changedAt: FIRST_CHANGE,
    });
    const ordinary = first.session.studyRoute;

    expect(ordinary.approach).toMatchObject({
      primaryMethodId: methodId,
      visibleMethodName: CORE_METHOD_CATALOG[methodId].name,
    });
    expect(ordinary.approach).not.toHaveProperty("visibleSupportingTechniqueId");
    expect(ordinary.agency.alternatives).toEqual(expect.arrayContaining([
      expect.objectContaining({
        primaryMethodId: "retrieval_practice",
        visibleMethodName: CORE_METHOD_CATALOG.retrieval_practice.name,
      }),
    ]));
    expect(ordinary.agency.override?.changedFields).toEqual([
      "primary_method",
      "method_recipe",
    ]);
    expect(materialStudyRouteChanges(blurting, ordinary)).toEqual([
      "primary_method",
      "method_recipe",
      "phase_order",
    ]);
    expect(ordinary.provenance.routerVersion.split("+").filter((component) => (
      component === BLURTING_RECIPE_RUNTIME_VERSION
    ))).toHaveLength(0);
    expect(ordinary.provenance.routerVersion.split("+").filter((component) => (
      component === METHOD_RUNTIME_CAPABILITY_POLICY_VERSION
    ))).toHaveLength(1);
    expect(ordinary.provenance.routerVersion.split("+")).toEqual(
      expect.arrayContaining(preservedRouterComponents),
    );
    expect(ordinary.provenance.routerVersion.length).toBeLessThanOrEqual(256);
    expect(ordinary.provenance.ruleTrace.filter((entry) => (
      entry.ruleId === "method_recipe_v1"
      || entry.ruleId === BLURTING_RECIPE_RUNTIME_VERSION
    ))).toEqual(historicalRecipeTraces);
    expect(ordinary.provenance.ruleTrace.findLast((entry) => (
      entry.ruleId === METHOD_RUNTIME_CAPABILITY_POLICY_VERSION
      || entry.ruleId === BLURTING_RECIPE_RUNTIME_VERSION
    ))?.ruleId).toBe(METHOD_RUNTIME_CAPABILITY_POLICY_VERSION);

    const firstSession = applyProjection(session, first.session);
    const firstPlan = replaceSession(plan, firstSession);
    const returnAlternative = ordinary.agency.alternatives.find((alternative) => (
      alternative.primaryMethodId === "retrieval_practice"
    ));
    expect(returnAlternative).toBeDefined();
    const second = createCommittedMethodChoiceSuccessor({
      plan: firstPlan,
      session: firstSession,
      previousRoute: ordinary,
      expectedRouteRevisionId: ordinary.identity.routeRevisionId,
      routeRevisionId: SECOND_SUCCESSOR_ID,
      methodId: returnAlternative!.primaryMethodId,
      changedAt: SECOND_CHANGE,
    });
    const repeated = second.session.studyRoute;

    expect(repeated.approach).toMatchObject({
      primaryMethodId: "retrieval_practice",
      visibleMethodName: CORE_METHOD_CATALOG.retrieval_practice.name,
    });
    expect(repeated.approach).not.toHaveProperty("visibleSupportingTechniqueId");
    expect(repeated.agency.override?.changedFields).toEqual(["primary_method"]);
    expect(repeated.provenance.ruleTrace.filter((entry) => (
      entry.ruleId === "method_recipe_v1"
      || entry.ruleId === BLURTING_RECIPE_RUNTIME_VERSION
    ))).toEqual(historicalRecipeTraces);
    expect(repeated.provenance.routerVersion).not.toContain(
      BLURTING_RECIPE_RUNTIME_VERSION,
    );
    expect(repeated.provenance.routerVersion.length).toBeLessThanOrEqual(256);
  });

  it("upgrades a legacy stored alternative to the canonical name without losing exact choice provenance", () => {
    const plan = activeRoutedPlan();
    const session = readySessionWithAlternative(plan);
    const previous = route(session.studyRoute);
    const first = createCommittedMethodChoiceSuccessor({
      plan,
      session,
      previousRoute: previous,
      expectedRouteRevisionId: previous.identity.routeRevisionId,
      routeRevisionId: FIRST_SUCCESSOR_ID,
      methodId: previous.agency.alternatives[0]!.primaryMethodId,
      changedAt: FIRST_CHANGE,
    });
    const firstSession = applyProjection(session, first.session);
    const firstRoute = first.session.studyRoute;
    const offered = firstRoute.agency.alternatives.find((alternative) => (
      LEGACY_CORE_METHOD_NAMES[alternative.primaryMethodId]?.[0]
    ));
    if (!offered) throw new Error("The fixture needs a renamed method alternative.");
    const legacyName = LEGACY_CORE_METHOD_NAMES[offered.primaryMethodId]?.[0];
    if (!legacyName) throw new Error("The renamed alternative needs its legacy label.");
    const legacyRoute = StudyRouteSchema.parse({
      ...firstRoute,
      agency: {
        ...firstRoute.agency,
        alternatives: firstRoute.agency.alternatives.map((alternative) => (
          alternative.primaryMethodId === offered.primaryMethodId
            ? {
                ...alternative,
                visibleMethodName: legacyName,
                tradeoff: `${legacyName} also fits this task and stage, but it would use a different practice sequence.`,
              }
            : alternative
        )),
      },
      provenance: {
        ...firstRoute.provenance,
        routerVersion: firstRoute.provenance.routerVersion.split("+").filter((component) => (
          component !== METHOD_PRESENTATION_POLICY_VERSION
        )).join("+"),
        ruleTrace: firstRoute.provenance.ruleTrace.filter((entry) => (
          entry.ruleId !== METHOD_PRESENTATION_POLICY_VERSION
        )),
      },
    });
    const legacySession = { ...firstSession, studyRoute: legacyRoute };
    const result = createCommittedMethodChoiceSuccessor({
      plan: replaceSession(replaceSession(plan, firstSession), legacySession),
      session: legacySession,
      previousRoute: legacyRoute,
      expectedRouteRevisionId: legacyRoute.identity.routeRevisionId,
      routeRevisionId: SECOND_SUCCESSOR_ID,
      methodId: offered.primaryMethodId,
      changedAt: SECOND_CHANGE,
    });

    expect(result.status).toBe("updated");
    expect(result.session.studyRoute.approach.visibleMethodName).toBe(
      CORE_METHOD_CATALOG[offered.primaryMethodId].name,
    );
    expect(result.session.studyRoute.provenance.ruleTrace.filter((entry) => (
      entry.ruleId === METHOD_PRESENTATION_POLICY_VERSION
    ))).toHaveLength(1);
  });

  it("rejects stale, hidden, non-ready, review, and saved-work changes with conflict codes", () => {
    const plan = activeRoutedPlan();
    const session = readySessionWithAlternative(plan);
    const previous = route(session.studyRoute);
    const offered = previous.agency.alternatives[0]!.primaryMethodId;
    const hidden = CORE_METHOD_IDS.find((methodId) => (
      methodId !== previous.approach.primaryMethodId
      && !previous.agency.alternatives.some((alternative) => (
        alternative.primaryMethodId === methodId
      ))
    ))!;
    const choose = ({
      candidatePlan = plan,
      candidateSession = session,
      candidateRoute = previous,
      expectedRouteRevisionId = previous.identity.routeRevisionId,
      methodId = offered,
    }: Partial<{
      candidatePlan: LearningPlan;
      candidateSession: LearningPlanSession;
      candidateRoute: StudyRoute;
      expectedRouteRevisionId: string;
      methodId: CoreMethodId;
    }> = {}) => createCommittedMethodChoiceSuccessor({
      plan: candidatePlan,
      session: candidateSession,
      previousRoute: candidateRoute,
      expectedRouteRevisionId,
      routeRevisionId: FIRST_SUCCESSOR_ID,
      methodId,
      changedAt: FIRST_CHANGE,
    });

    expectChoiceError(() => choose({
      candidatePlan: { ...plan, status: "completed" },
    }), "invalid_plan_state", 409);
    expectChoiceError(() => choose({
      expectedRouteRevisionId: "99999999-9999-4999-8999-999999999999",
    }), "stale_route_revision", 409);
    expectChoiceError(() => choose({ methodId: hidden }), "method_not_offered", 409);

    const upcoming = { ...session, status: "upcoming" as const };
    expectChoiceError(() => choose({
      candidatePlan: replaceSession(plan, upcoming),
      candidateSession: upcoming,
    }), "invalid_session_state", 409);

    const review = {
      ...session,
      reviewConcept: "Product rule",
      reviewType: "verify" as const,
    };
    expectChoiceError(() => choose({
      candidatePlan: replaceSession(plan, review),
      candidateSession: review,
    }), "invalid_session_state", 409);

    const withResource = {
      ...session,
      resource: {} as LearningPlanSession["resource"],
    };
    expectChoiceError(() => choose({
      candidatePlan: replaceSession(plan, withResource),
      candidateSession: withResource,
    }), "saved_work_present", 409);

    const withProgress = {
      ...session,
      activityProgress: { ratings: [] },
    } as LearningPlanSession & { activityProgress: unknown };
    expectChoiceError(() => choose({
      candidatePlan: replaceSession(plan, withProgress),
      candidateSession: withProgress,
    }), "saved_work_present", 409);

    const withAdjustment = {
      ...session,
      sessionAdjustment: { familiarity: "as_planned" },
    } as LearningPlanSession & { sessionAdjustment: unknown };
    expectChoiceError(() => choose({
      candidatePlan: replaceSession(plan, withAdjustment),
      candidateSession: withAdjustment,
    }), "saved_work_present", 409);
  });

  it("fails closed if canonical integration would change support or another protected surface", () => {
    const plan = activeRoutedPlan();
    const session = readySessionWithAlternative(plan);
    const previous = route(session.studyRoute);
    const changedSupport = StudyRouteSchema.parse({
      ...previous,
      execution: {
        ...previous.execution,
        initialSupport: previous.execution.initialSupport === "fading"
          ? "supported_start"
          : "fading",
      },
    });
    const changedSession = {
      ...session,
      studyRoute: changedSupport,
    };
    const changedPlan = replaceSession(plan, changedSession);

    expectChoiceError(() => createCommittedMethodChoiceSuccessor({
      plan: changedPlan,
      session: changedSession,
      previousRoute: changedSupport,
      expectedRouteRevisionId: changedSupport.identity.routeRevisionId,
      routeRevisionId: FIRST_SUCCESSOR_ID,
      methodId: changedSupport.agency.alternatives[0]!.primaryMethodId,
      changedAt: FIRST_CHANGE,
    }), "route_invariant_violation", 409);
  });

  it("classifies malformed successor identity and time as unprocessable input", () => {
    const plan = activeRoutedPlan();
    const session = readySessionWithAlternative(plan);
    const previous = route(session.studyRoute);
    const methodId = previous.agency.alternatives[0]!.primaryMethodId;
    const choose = (routeRevisionId: string, changedAt: string) => (
      createCommittedMethodChoiceSuccessor({
        plan,
        session,
        previousRoute: previous,
        expectedRouteRevisionId: previous.identity.routeRevisionId,
        routeRevisionId,
        methodId,
        changedAt,
      })
    );

    expectChoiceError(
      () => choose("not-a-uuid", FIRST_CHANGE),
      "invalid_route_revision_id",
      422,
    );
    expectChoiceError(
      () => choose(FIRST_SUCCESSOR_ID, "2026-08-24T12:00:30.000Z"),
      "invalid_change_time",
      422,
    );
  });
});

function activeRoutedPlan(): LearningPlan {
  const routed = integrateInitialPlanMethodRoutes({
    plan: generatePreviewPlan(request, GENERATED_AT),
    request,
    context: emptyContext(),
  });
  return commitPlanStudyRoutes(
    { ...routed, status: "active" },
    COMMITTED_AT,
  );
}

function activePlanWithBlurtingChoice(): {
  plan: LearningPlan;
  session: LearningPlanSession;
} {
  const plan = activeRoutedPlan();
  const sessionIndex = plan.sessions.findIndex((session) => (
    session.status === "ready" && !session.reviewType
  ));
  const session = plan.sessions[sessionIndex]!;
  const blurting = blurtingChoiceRoute(route(session.studyRoute));
  const projection = studyRouteToLegacySessionProjection(blurting);
  const projectedSession = {
    ...session,
    ...projection,
    studyRoute: blurting,
    resource: undefined,
  };

  return {
    plan: {
      ...plan,
      sourceMode: "user_materials",
      sessions: plan.sessions.map((candidate, index) => (
        index === sessionIndex ? projectedSession : candidate
      )),
    },
    session: projectedSession,
  };
}

function blurtingChoiceRoute(base: StudyRoute): StudyRoute {
  const targetStates = base.target.targetStates.slice(0, 2).map((target) => ({
    ...target,
    stage: "developing" as const,
    uncertainty: "medium" as const,
  }));
  const targetIds = targetStates.map((target) => target.targetId);
  const decision = selectMethodRecipe({
    blurtingEnabled: true,
    learningMode: "study",
    primaryMethodId: "retrieval_practice",
    taskType: "conceptual_learning",
    knowledgeStage: "developing",
    isReview: false,
    activeMinutes: 12,
    activeTargetCount: targetIds.length,
    comparisonSourceAvailable: true,
  });
  if (decision.kind !== "recipe") throw new Error("Expected eligible Blurting fixture.");

  return StudyRouteSchema.parse({
    ...base,
    target: {
      ...base.target,
      taskFamily: "conceptual_learning",
      targetStates,
      sourceRequirements: {
        sourceType: "user_materials",
        requiredSourceIds: ["source:blurting-choice"],
        groundingRequired: true,
        instructions: ["Compare the broad recall with the committed source before repairing gaps."],
      },
    },
    approach: {
      mode: "practice",
      executionEnvironment: base.approach.executionEnvironment,
      primaryMethodId: "retrieval_practice",
      visibleMethodName: BLURTING_VISIBLE_METHOD_NAME,
      visibleSupportingTechniqueId: BLURTING_SUPPORTING_TECHNIQUE_ID,
      confidenceLevel: base.approach.confidenceLevel,
    },
    timing: {
      activeMinutes: 12,
      elapsedMinutes: 12,
      durationSource: "router_default",
    },
    execution: {
      ...base.execution,
      orderedPhases: BLURTING_PHASE_IDS.map((phaseId, index) => ({
        phaseId,
        methodPhase: BLURTING_ORDERED_PHASES[index],
        activeMinutes: 4,
        targetIds,
      })),
      initialSupport: "independent_start",
      activityLimit: Math.max(base.execution.activityLimit, 3),
      completionEvidence: targetIds.map((targetId) => ({
        evidenceId: blurtingFinalCheckEvidenceId(targetId),
        targetIds: [targetId],
        kind: "verification",
        description: "Answer one fresh final check without reopening the source.",
        requiresIndependentAttempt: true,
      })),
      deferredTargets: [],
    },
    agency: {
      controlMode: "yova_decides",
      selectedBy: "yova",
      alternatives: (["self_explanation", "spaced_retrieval"] as const).map((methodId) => ({
        alternativeId: `method-alternative:${methodId}`,
        mode: "practice",
        executionEnvironment: base.approach.executionEnvironment,
        primaryMethodId: methodId,
        visibleMethodName: CORE_METHOD_CATALOG[methodId].name,
        activeMinutes: 12,
        tradeoff: `${CORE_METHOD_CATALOG[methodId].name} also fits this task and stage, but it would use a different practice sequence.`,
      })),
    },
    explanation: {
      shortReason: "Blurting uses broad recall, source comparison, and a fresh transfer check.",
      taskRequirements: [
        "Blurting is eligible for this conceptual learning Practice route at the developing stage.",
      ],
      learnerDeclarations: [],
      observations: [],
      uncertainties: [],
    },
    provenance: {
      ...base.provenance,
      routerVersion: [
        ...new Set(base.provenance.routerVersion.split("+").filter((component) => (
          component !== METHOD_RUNTIME_CAPABILITY_POLICY_VERSION
          && component !== BLURTING_RECIPE_RUNTIME_VERSION
        ))),
        BLURTING_RECIPE_RUNTIME_VERSION,
      ].join("+"),
      ruleTrace: [
        ...base.provenance.ruleTrace,
        blurtingMethodRecipeTrace(decision),
        blurtingRecipeRuntimeTrace(base.approach.executionEnvironment),
      ],
    },
  });
}

function emptyContext(): InitialPlanMethodRoutingContext {
  return {
    profileVersion: "authorized_profile_context_v1+empty",
    personalization: emptyPersonalization(),
    observedEvidence: [],
  };
}

function emptyPersonalization(): GenerationPersonalizationContext {
  return {
    decisions: [],
    methodTie: {
      state: {
        controls: { experiments: false },
        activeExperiment: null,
        experimentHistory: [],
      },
      signals: [],
    },
  };
}

function readySessionWithAlternative(plan: LearningPlan) {
  const session = plan.sessions.find((candidate) => (
    candidate.status === "ready"
    && route(candidate.studyRoute).agency.alternatives.length > 0
  ));
  if (!session) throw new Error("The fixture needs one ready routed alternative.");
  return session;
}

function route(value: unknown): StudyRoute {
  return StudyRouteSchema.parse(value);
}

function replaceSession(plan: LearningPlan, session: LearningPlanSession): LearningPlan {
  return {
    ...plan,
    sessions: plan.sessions.map((candidate) => (
      candidate.id === session.id ? session : candidate
    )),
  };
}

function applyProjection(
  session: LearningPlanSession,
  projection: ReturnType<typeof createCommittedMethodChoiceSuccessor>["session"],
): LearningPlanSession {
  return {
    ...session,
    method: projection.method,
    methodReason: projection.methodReason,
    estimatedMinutes: projection.estimatedMinutes,
    studyRoute: projection.studyRoute,
    resource: undefined,
  };
}

function expectChoiceError(
  operation: () => unknown,
  code: CommittedMethodChoiceError["code"],
  status: 409 | 422,
) {
  try {
    operation();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(CommittedMethodChoiceError);
    expect(error).toMatchObject({ code });
    expect(committedMethodChoiceErrorStatus(code)).toBe(status);
  }
}
