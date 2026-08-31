import { describe, expect, it } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import { selectCanonicalStudyMethod } from "@/lib/learning/canonical-method-selection";
import {
  CORE_METHOD_CATALOG,
  METHOD_PRESENTATION_POLICY_VERSION,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import type { GenerationPersonalizationContext } from "@/lib/personalization/personalization-generation";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import {
  DRAFT_METHOD_CHOICE_POLICY_VERSION,
  DraftMethodChoiceError,
  reviseDraftSessionMethod,
} from "@/lib/study-route/draft-method-choice";
import {
  integrateInitialPlanMethodRoutes,
  type InitialPlanMethodRoutingContext,
} from "@/lib/study-route/initial-plan-method-routing";
import { methodSelectionContextForStudyRoute } from "@/lib/study-route/method-plan-integration";
import { resolvePersonalizationRollout } from "@/lib/study-route/personalization-rollout";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const FIRST_CHANGE = "2026-08-24T12:05:00.000Z";
const SECOND_CHANGE = "2026-08-24T12:06:00.000Z";
const THIRD_CHANGE = "2026-08-24T12:07:00.000Z";

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
  profileSummary: "Display prose must not control method routing.",
});

describe("normal-plan draft method choice", () => {
  it("replaces only the chosen provisional candidate and projects the exact route", () => {
    const plan = routedPlan(emptyContext());
    const original = structuredClone(plan);
    const sessionIndex = plan.sessions.findIndex((session) => (
      route(session.studyRoute).agency.alternatives.length > 0
    ));
    const session = plan.sessions[sessionIndex]!;
    const before = route(session.studyRoute);
    const methodId = before.agency.alternatives[0]!.primaryMethodId;

    const result = reviseDraftSessionMethod({
      plan,
      selection: {
        sessionId: session.id,
        expectedRouteRevisionId: before.identity.routeRevisionId,
        methodId,
      },
      changedAt: FIRST_CHANGE,
    });

    expect(result.status).toBe("updated");
    expect(plan).toEqual(original);
    const updatedSession = result.plan.sessions[sessionIndex]!;
    const updated = route(updatedSession.studyRoute);
    expect(updated.identity).toMatchObject({
      routeLineageId: before.identity.routeLineageId,
      revisionNumber: 1,
      lifecycleStatus: "provisional",
      planId: plan.id,
      sessionId: session.id,
      createdAt: FIRST_CHANGE,
    });
    expect(updated.identity.routeRevisionId).not.toBe(before.identity.routeRevisionId);
    expect(updated.identity.routeRevisionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(updated.identity).not.toHaveProperty("supersedesRevisionId");
    expect(updated.identity).not.toHaveProperty("committedAt");
    expect(updated.approach.primaryMethodId).toBe(methodId);
    expect(updated.agency).toMatchObject({
      controlMode: "learner_customizes",
      selectedBy: "learner",
      override: {
        requestedAt: FIRST_CHANGE,
        changedFields: ["primary_method"],
      },
    });
    expect(updated.explanation.shortReason).toMatch(/^You chose/u);
    expect(updatedSession).toMatchObject({
      method: updated.approach.visibleMethodName,
      methodReason: updated.explanation.shortReason,
      estimatedMinutes: updated.timing.activeMinutes,
      learningMode: updated.approach.mode === "learn" ? "learn" : "study",
    });
    expect(result.plan.sessions.filter((_, index) => index !== sessionIndex))
      .toEqual(plan.sessions.filter((_, index) => index !== sessionIndex));
    expect(updated.provenance.ruleTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: DRAFT_METHOD_CHOICE_POLICY_VERSION,
        result: `${before.approach.primaryMethodId}->${methodId}`,
      }),
      expect.objectContaining({
        ruleId: "canonical_method_selection_v1",
        result: `learner_choice:${methodId}`,
      }),
    ]));
  });

  it("authorizes a hidden eligible method only through I'll Customize Other methods", () => {
    const original = routedPlan(emptyContext());
    const originalSession = original.sessions.find((candidate) => (
      route(candidate.studyRoute).agency.alternatives.length > 0
    ))!;
    const originalRoute = route(originalSession.studyRoute);
    const hiddenMethodId = originalRoute.agency.alternatives[0]!.primaryMethodId;
    const customizeRoute = StudyRouteSchema.parse({
      ...originalRoute,
      agency: {
        ...originalRoute.agency,
        controlMode: "learner_customizes",
        alternatives: [],
      },
    });
    const customizePlan: LearningPlan = {
      ...original,
      sessions: original.sessions.map((candidate) => (
        candidate.id === originalSession.id
          ? { ...candidate, studyRoute: customizeRoute }
          : candidate
      )),
    };

    expectDraftChoiceError(() => reviseDraftSessionMethod({
      plan: customizePlan,
      selection: {
        sessionId: originalSession.id,
        expectedRouteRevisionId: customizeRoute.identity.routeRevisionId,
        methodId: hiddenMethodId,
      },
      changedAt: FIRST_CHANGE,
    }), "method_not_offered");

    const result = reviseDraftSessionMethod({
      plan: customizePlan,
      selection: {
        sessionId: originalSession.id,
        expectedRouteRevisionId: customizeRoute.identity.routeRevisionId,
        methodId: hiddenMethodId,
        choiceScope: "other_eligible_method",
      },
      changedAt: FIRST_CHANGE,
    });

    expect(result.status).toBe("updated");
    const chosen = route(
      result.plan.sessions.find((candidate) => candidate.id === originalSession.id)!
        .studyRoute,
    );
    expect(chosen.approach.primaryMethodId).toBe(hiddenMethodId);
    expect(chosen.agency.controlMode).toBe("learner_customizes");
    expect(chosen.provenance.ruleTrace).toContainEqual(expect.objectContaining({
      ruleId: DRAFT_METHOD_CHOICE_POLICY_VERSION,
      reason: "The learner requested an eligible, deliverable method through I'll Customize Other methods for this uncommitted session recipe.",
    }));
  });

  it("returns the same plan when the selected method is already current", () => {
    const plan = routedPlan(emptyContext());
    const session = plan.sessions[0]!;
    const current = route(session.studyRoute);

    const result = reviseDraftSessionMethod({
      plan,
      selection: {
        sessionId: session.id,
        expectedRouteRevisionId: current.identity.routeRevisionId,
        methodId: current.approach.primaryMethodId,
      },
      changedAt: FIRST_CHANGE,
    });

    expect(result).toEqual({ status: "unchanged", plan });
    expect(result.plan).toBe(plan);
  });

  it("records an override against the shown route even when the learner returns to the task baseline", () => {
    const personalized = routedPlan(memorySignalContext());
    const session = personalized.sessions.find((candidate) => {
      const current = route(candidate.studyRoute);
      const baseline = selectCanonicalStudyMethod(
        methodSelectionContextForStudyRoute(current),
      ).baselineMethodId;
      return current.approach.primaryMethodId !== baseline
        && current.agency.alternatives.some((alternative) => (
          alternative.primaryMethodId === baseline
        ));
    });
    expect(session).toBeDefined();
    const before = route(session!.studyRoute);
    const baselineMethodId = selectCanonicalStudyMethod(
      methodSelectionContextForStudyRoute(before),
    ).baselineMethodId;

    const result = reviseDraftSessionMethod({
      plan: personalized,
      selection: {
        sessionId: session!.id,
        expectedRouteRevisionId: before.identity.routeRevisionId,
        methodId: baselineMethodId,
      },
      changedAt: FIRST_CHANGE,
    });
    const updated = route(result.plan.sessions.find((candidate) => (
      candidate.id === session!.id
    ))!.studyRoute);

    expect(updated.approach.primaryMethodId).toBe(baselineMethodId);
    expect(updated.agency.override).toMatchObject({
      requestedAt: FIRST_CHANGE,
      changedFields: ["primary_method"],
    });
    expect(updated.agency.selectedBy).toBe("learner");
  });

  it("replaces prior draft-choice provenance instead of growing it on every choice", () => {
    const plan = routedPlan(emptyContext());
    const session = plan.sessions.find((candidate) => (
      route(candidate.studyRoute).agency.alternatives.length > 0
    ))!;
    const initialRoute = route(session.studyRoute);
    const firstMethod = initialRoute.agency.alternatives[0]!.primaryMethodId;
    const first = reviseDraftSessionMethod({
      plan,
      selection: {
        sessionId: session.id,
        expectedRouteRevisionId: initialRoute.identity.routeRevisionId,
        methodId: firstMethod,
      },
      changedAt: FIRST_CHANGE,
    });
    const firstRoute = selectedRoute(first.plan, session.id);
    const second = reviseDraftSessionMethod({
      plan: first.plan,
      selection: {
        sessionId: session.id,
        expectedRouteRevisionId: firstRoute.identity.routeRevisionId,
        methodId: initialRoute.approach.primaryMethodId,
      },
      changedAt: SECOND_CHANGE,
    });
    const secondRoute = selectedRoute(second.plan, session.id);
    const third = reviseDraftSessionMethod({
      plan: second.plan,
      selection: {
        sessionId: session.id,
        expectedRouteRevisionId: secondRoute.identity.routeRevisionId,
        methodId: firstMethod,
      },
      changedAt: THIRD_CHANGE,
    });
    const thirdRoute = selectedRoute(third.plan, session.id);

    expect(secondRoute.agency.override).toMatchObject({
      requestedAt: SECOND_CHANGE,
      changedFields: ["primary_method"],
    });
    expect(firstRoute.provenance.ruleTrace).toHaveLength(
      secondRoute.provenance.ruleTrace.length,
    );
    expect(secondRoute.provenance.ruleTrace).toHaveLength(
      thirdRoute.provenance.ruleTrace.length,
    );
    for (const candidate of [firstRoute, secondRoute, thirdRoute]) {
      expect(candidate.provenance.ruleTrace.filter((entry) => (
        entry.ruleId === DRAFT_METHOD_CHOICE_POLICY_VERSION
      ))).toHaveLength(1);
      expect(candidate.provenance.routerVersion.split("+").filter((component) => (
        component === METHOD_PRESENTATION_POLICY_VERSION
      ))).toHaveLength(1);
      expect(candidate.provenance.routerVersion.length).toBeLessThanOrEqual(256);
      expect(candidate.provenance.ruleTrace.filter((entry) => (
        entry.ruleId === METHOD_PRESENTATION_POLICY_VERSION
      ))).toHaveLength(1);
      expect(candidate.provenance.ruleTrace.filter((entry) => (
        entry.ruleId === "canonical_method_selection_v1"
        && entry.result.startsWith("learner_choice:")
      ))).toHaveLength(1);
      expect(candidate.provenance.evidenceRefs.filter((reference) => (
        reference.startsWith("learner-choice:plan-draft:")
      ))).toHaveLength(1);
      expect(candidate.explanation.learnerDeclarations.filter((declaration) => (
        declaration.startsWith("You chose ")
      ))).toHaveLength(1);
    }
  });

  it("rejects stale identities, hidden methods, committed routes, reviews, and non-plan drafts", () => {
    const plan = routedPlan(emptyContext());
    const session = plan.sessions.find((candidate) => (
      route(candidate.studyRoute).agency.alternatives.length > 0
    ))!;
    const current = route(session.studyRoute);
    const offeredIds = new Set(current.agency.alternatives.map((item) => item.primaryMethodId));
    const hiddenMethod = ([
      "retrieval_practice",
      "spaced_retrieval",
      "self_explanation",
      "worked_example_fading",
      "interleaved_practice",
      "read_recall_review",
      "retrieval_based_outlining",
      "scaffolded_coding",
      "practice_test_error_repair",
    ] as CoreMethodId[]).find((methodId) => (
      methodId !== current.approach.primaryMethodId && !offeredIds.has(methodId)
    ))!;
    const choose = (candidatePlan: LearningPlan, overrides: Partial<{
      sessionId: string;
      expectedRouteRevisionId: string;
      methodId: CoreMethodId;
      changedAt: string;
    }> = {}) => reviseDraftSessionMethod({
      plan: candidatePlan,
      selection: {
        sessionId: overrides.sessionId ?? session.id,
        expectedRouteRevisionId: overrides.expectedRouteRevisionId
          ?? current.identity.routeRevisionId,
        methodId: overrides.methodId ?? current.agency.alternatives[0]!.primaryMethodId,
      },
      changedAt: overrides.changedAt ?? FIRST_CHANGE,
    });

    expectDraftChoiceError(() => choose(plan, {
      expectedRouteRevisionId: "99999999-9999-4999-8999-999999999999",
    }), "stale_route_revision");
    expectDraftChoiceError(() => choose(plan, { methodId: hiddenMethod }), "method_not_offered");
    expectDraftChoiceError(() => choose({ ...plan, status: "active" }), "invalid_plan_state");
    expectDraftChoiceError(() => choose({ ...plan, creationIntent: "study_now" }), "invalid_plan_state");
    expectDraftChoiceError(() => choose(plan, {
      sessionId: "99999999-9999-4999-8999-999999999999",
    }), "session_not_found");
    expectDraftChoiceError(() => choose({
      ...plan,
      sessions: plan.sessions.map((candidate) => (
        candidate.id === session.id ? { ...candidate, studyRoute: undefined } : candidate
      )),
    }), "route_required");
    expectDraftChoiceError(() => choose({
      ...plan,
      sessions: plan.sessions.map((candidate) => (
        candidate.id === session.id
          ? {
              ...candidate,
              reviewType: "verify" as const,
              reviewConcept: "Product rule",
            }
          : candidate
      )),
    }), "invalid_route_state");
    const committed = StudyRouteSchema.parse({
      ...current,
      identity: {
        ...current.identity,
        lifecycleStatus: "committed",
        committedAt: FIRST_CHANGE,
      },
    });
    expectDraftChoiceError(() => choose({
      ...plan,
      sessions: plan.sessions.map((candidate) => (
        candidate.id === session.id ? { ...candidate, studyRoute: committed } : candidate
      )),
    }), "invalid_route_state");
    expectDraftChoiceError(() => choose(plan, {
      changedAt: "2026-08-24T11:59:00.000Z",
    }), "invalid_change_time");
  });
});

function routedPlan(context: InitialPlanMethodRoutingContext) {
  return integrateInitialPlanMethodRoutes({
    plan: generatePreviewPlan(request, NOW),
    request,
    context,
  });
}

function emptyContext(): InitialPlanMethodRoutingContext {
  return {
    profileVersion: "authorized_profile_context_v1+empty",
    personalization: personalization(),
    observedEvidence: [],
  };
}

function memorySignalContext(): InitialPlanMethodRoutingContext {
  return {
    profileVersion: "authorized_profile_context_v1+profile-revision-test",
    personalization: personalization({
      id: "signal:memory_breakdown",
      key: "memory_breakdown",
      title: "Memory breakdown",
      code: "similar_idea_confusion",
      evidenceLabel: "You told YOVA",
      paused: false,
    }),
    observedEvidence: [],
    rolloutDecision: resolvePersonalizationRollout({
      rolloutPercent: 100,
      subjectKey: "draft-method-choice-test",
    }),
  };
}

function personalization(
  signal?: GenerationPersonalizationContext["methodTie"]["signals"][number],
): GenerationPersonalizationContext {
  return {
    decisions: [],
    methodTie: {
      state: {
        controls: { experiments: false },
        activeExperiment: null,
        experimentHistory: [],
      },
      signals: signal ? [signal] : [],
    },
  };
}

function route(value: unknown): StudyRoute {
  return StudyRouteSchema.parse(value);
}

function selectedRoute(plan: LearningPlan, sessionId: string) {
  return route(plan.sessions.find((session) => session.id === sessionId)!.studyRoute);
}

function expectDraftChoiceError(
  operation: () => unknown,
  code: DraftMethodChoiceError["code"],
) {
  try {
    operation();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(DraftMethodChoiceError);
    expect(error).toMatchObject({ code });
  }
}
