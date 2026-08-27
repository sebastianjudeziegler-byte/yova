import { describe, expect, it } from "vitest";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import { CORE_METHOD_CATALOG } from "@/lib/learning/method-catalog";
import { classifyLearningTask } from "@/lib/learning/method-router";
import {
  INITIAL_PLAN_MODE_ROUTING_VERSION,
} from "@/lib/plan-generation/initial-session-mode";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import {
  NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
  composeNormalPlanEnvelopes,
  type NormalPlanDurationContext,
} from "@/lib/plan-generation/normal-plan-envelopes";
import {
  NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD,
  bindNormalPlanProviderFill,
  buildNormalPlanFallbackFill,
} from "@/lib/plan-generation/normal-plan-provider-fill";
import {
  PlanActivationRequestSchema,
  PlanGenerationRequestSchema,
} from "@/lib/plan-generation/schema";
import {
  LEGACY_STUDY_ROUTE_ADAPTER_VERSION,
} from "@/lib/study-route/adapters";
import {
  NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION,
  NORMAL_PLAN_PREREQUISITE_BINDING_VERSION,
  NormalPlanEnvelopeRouteIntegrationError,
  integrateNormalPlanEnvelopeRoute,
} from "@/lib/study-route/normal-plan-envelope-integration";
import { methodSelectionContextForStudyRoute } from "@/lib/study-route/method-plan-integration";

const NOW = new Date("2026-08-24T08:00:00.000Z");
const OBSERVED_AT = "2026-08-23T10:00:00.000Z";
const IDS = Array.from({ length: 10 }, (_, index) => (
  `30000000-3000-4000-8000-${String(index + 1).padStart(12, "0")}`
));

describe("normal-plan envelope route integration", () => {
  it("binds the exact envelope facts and provenance without taking method authority", () => {
    const fixture = buildFixture({ prerequisiteEvidence: true });
    const session = fixture.plan.sessions[0]!;
    const envelope = fixture.composition.envelopes[0]!;
    expect(envelope.prerequisiteEvidenceRefs.length).toBeGreaterThan(0);
    expect(session.studyRoute).toBeUndefined();
    const result = integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session,
      composition: fixture.composition,
    });

    expect(result.route.identity).toMatchObject({
      lifecycleStatus: "provisional",
      planId: fixture.plan.id,
      sessionId: session.id,
      createdAt: fixture.plan.createdAt,
    });
    expect(result.route.target.targetStates.map((target) => target.targetId)).toEqual(
      envelope.topicIds,
    );
    expect(result.route.target.taskFamily).toBe(envelope.taskFamily);
    expect(result.route.approach).toMatchObject({
      mode: envelope.learningMode === "learn" ? "learn" : "practice",
      primaryMethodId: "self_explanation",
      visibleMethodName: CORE_METHOD_CATALOG.self_explanation.name,
    });
    expect(result.route.timing).toEqual(envelope.timing);
    expect(result.route.execution.orderedPhases.flatMap((phase) => phase.targetIds)).toEqual(
      expect.arrayContaining([...envelope.topicIds]),
    );
    expect(result.route.agency).toMatchObject({
      controlMode: "legacy_unknown",
      selectedBy: "legacy_unknown",
    });
    expect(result.route.provenance.profileVersion).toBe(
      fixture.composition.profileVersion,
    );
    expect(result.route.provenance.routerVersion).toContain(
      NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION,
    );
    expect(result.route.provenance.routerVersion).toContain(
      NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
    );
    expect(result.route.provenance.routerVersion).toContain(
      envelope.durationRouterVersion,
    );
    expect(result.route.provenance.ruleTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION }),
      expect.objectContaining({ ruleId: INITIAL_PLAN_MODE_ROUTING_VERSION }),
      ...envelope.durationRuleTrace.map((entry) => expect.objectContaining({
        ruleId: entry.ruleId,
        result: entry.result,
      })),
    ]));
    for (const entry of envelope.modeRuleTrace) {
      expect(result.route.provenance.ruleTrace).toContainEqual(entry);
    }
    for (const entry of envelope.durationRuleTrace) {
      expect(result.route.provenance.ruleTrace).toContainEqual(entry);
    }
    for (const evidenceRef of envelope.prerequisiteEvidenceRefs) {
      expect(result.route.provenance.evidenceRefs).toContain(evidenceRef);
    }
    if (envelope.prerequisiteEvidenceRefs.length > 0) {
      expect(result.route.provenance.ruleTrace).toContainEqual(
        expect.objectContaining({
          ruleId: NORMAL_PLAN_PREREQUISITE_BINDING_VERSION,
          evidenceRefs: envelope.prerequisiteEvidenceRefs,
        }),
      );
    }
    expect(result.route.explanation.uncertainties).not.toContain(
      "The duration is preserved, but the legacy record does not show how it was chosen.",
    );
    expect(result.route.explanation.uncertainties).not.toContain(
      "The task family is derived from legacy task text rather than a stored routing decision.",
    );
    expect(result.route.explanation.uncertainties).toContain(
      "The legacy record does not show who selected the route or which control mode was active.",
    );
    expect(result.route.explanation.uncertainties).toContain(
      "The legacy record does not contain a canonical difficulty decision.",
    );
  });

  it("rejects scalar, envelope, route-shell, and review mismatches instead of repairing structure", () => {
    const fixture = buildFixture();
    const session = fixture.plan.sessions[0]!;

    const changedSession = {
      ...structuredClone(session),
      scheduledFor: "2026-08-31T08:00:00.000Z",
    };
    expectIntegrationError(() => integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session: changedSession,
      composition: fixture.composition,
    }), "session_mismatch");

    const changedAmountSession = {
      ...structuredClone(session),
      amountLabel: "A provider-controlled amount",
    };
    const changedAmountPlan = {
      ...structuredClone(fixture.plan),
      sessions: [changedAmountSession, ...fixture.plan.sessions.slice(1)],
    };
    expectIntegrationError(() => integrateNormalPlanEnvelopeRoute({
      plan: changedAmountPlan,
      session: changedAmountSession,
      composition: fixture.composition,
    }), "session_mismatch");

    const changedComposition = {
      ...structuredClone(fixture.composition),
      envelopes: fixture.composition.envelopes.map((envelope, index) => (
        index === 0 ? { ...envelope, topicIds: [IDS[1]!] } : envelope
      )),
    };
    expectIntegrationError(() => integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session,
      composition: changedComposition,
    }), "session_mismatch");

    const changedEnvelopeIdentity = {
      ...structuredClone(fixture.composition),
      envelopes: fixture.composition.envelopes.map((envelope, index) => (
        index === 0 ? { ...envelope, envelopeId: "normal-plan-envelope-999" } : envelope
      )),
    };
    expectIntegrationError(() => integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session,
      composition: changedEnvelopeIdentity,
    }), "session_mismatch");

    const changedRoute = structuredClone(integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session,
      composition: fixture.composition,
    }).route);
    changedRoute.target.taskFamily = "programming";
    expectIntegrationError(() => integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session,
      route: changedRoute,
      composition: fixture.composition,
    }), "route_mismatch");

    const reviewSession = {
      ...structuredClone(session),
      reviewType: "verify" as const,
      reviewConcept: "Product rule",
    };
    const reviewPlan = {
      ...structuredClone(fixture.plan),
      sessions: [reviewSession, ...fixture.plan.sessions.slice(1)],
    };
    expectIntegrationError(() => integrateNormalPlanEnvelopeRoute({
      plan: reviewPlan,
      session: reviewSession,
      composition: fixture.composition,
    }), "review_not_supported");
  });

  it.each([
    {
      label: "profile recommendation",
      expected: "profile_recommendation" as const,
      durationContext: durationContext({ sustainableMinutes: 45 }),
      availabilityMinutes: 60,
    },
    {
      label: "observed outcome adjustment",
      expected: "observed_outcome_adjustment" as const,
      durationContext: durationContext({
        sustainableMinutes: 45,
        recentOutcomes: interruptionOutcomes(),
      }),
      availabilityMinutes: 60,
    },
    {
      label: "availability cap",
      expected: "availability_cap" as const,
      durationContext: durationContext({ sustainableMinutes: 60 }),
      availabilityMinutes: 25,
    },
  ])("preserves the exact $label timing source", ({
    expected,
    durationContext: currentDurationContext,
    availabilityMinutes,
  }) => {
    const fixture = buildFixture({
      durationContext: currentDurationContext,
      availabilityMinutes,
      oneSession: true,
    });
    const session = fixture.plan.sessions[0]!;
    const result = integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session,
      composition: fixture.composition,
    });

    expect(fixture.composition.envelopes[0]!.timing.durationSource).toBe(expected);
    expect(result.route.timing).toEqual(fixture.composition.envelopes[0]!.timing);
    expect(result.route.timing.durationSource).toBe(expected);
  });

  it("binds mixed Learn and Practice envelopes without changing either target snapshot", () => {
    const fixture = buildFixture();
    expect(fixture.composition.envelopes.map((envelope) => envelope.learningMode)).toEqual([
      "learn",
      "study",
    ]);

    const results = fixture.plan.sessions.map((session) => {
      return {
        session,
        binding: integrateNormalPlanEnvelopeRoute({
          plan: fixture.plan,
          session,
          composition: fixture.composition,
        }),
      };
    });

    expect(results.map(({ binding }) => binding.route.approach.mode)).toEqual([
      "learn",
      "practice",
    ]);
    results.forEach(({ session, binding }, index) => {
      expect(session.studyRoute).toBeUndefined();
      expect(binding.route.target.targetStates.map((target) => target.targetId)).toEqual(
        fixture.composition.envelopes[index]!.topicIds,
      );
    });
  });

  it("binds one deterministic completion check to each target in exact envelope order", () => {
    const fixture = buildFixture({
      learningIntent: "study",
      oneSession: true,
      independentTopics: true,
    });
    const envelope = fixture.composition.envelopes[0]!;
    const session = fixture.plan.sessions[0]!;
    expect(envelope.topicIds).toHaveLength(2);
    expect(session.completionEvidence).toHaveLength(2);

    const result = integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session,
      composition: fixture.composition,
    });

    expect(result.route.execution.completionEvidence.map((evidence) => (
      evidence.targetIds
    ))).toEqual(envelope.topicIds.map((topicId) => [topicId]));
    expect(result.route.execution.completionEvidence.map((evidence) => (
      evidence.description
    ))).toEqual(session.completionEvidence);
  });

  it("rejects completion-check count and target-decision order mismatches", () => {
    const fixture = buildFixture({
      learningIntent: "study",
      oneSession: true,
      independentTopics: true,
    });
    const shortSession = {
      ...structuredClone(fixture.plan.sessions[0]!),
      completionEvidence: fixture.plan.sessions[0]!.completionEvidence!.slice(0, 1),
    };
    const shortPlan = {
      ...structuredClone(fixture.plan),
      sessions: [shortSession],
    };
    expectIntegrationError(() => integrateNormalPlanEnvelopeRoute({
      plan: shortPlan,
      session: shortSession,
      composition: fixture.composition,
    }), "session_mismatch");

    const wrongDecisionOrder = {
      ...fixture.composition,
      envelopes: fixture.composition.envelopes.map((envelope, index) => (
        index === 0
          ? {
              ...envelope,
              targetModeDecisions: [...envelope.targetModeDecisions].reverse(),
            }
          : envelope
      )),
    };
    expectIntegrationError(() => integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session: fixture.plan.sessions[0]!,
      composition: wrongDecisionOrder,
    }), "session_mismatch");
  });

  it.each([
    {
      label: "outside work",
      taskFamily: "conceptual_learning" as const,
      learningIntent: "learn" as const,
      outside: true,
      expected: "artifact" as const,
    },
    {
      label: "writing",
      taskFamily: "writing_argumentation" as const,
      learningIntent: "learn" as const,
      outside: false,
      expected: "artifact" as const,
    },
    {
      label: "problem solving",
      taskFamily: "problem_solving" as const,
      learningIntent: "study" as const,
      outside: false,
      expected: "application" as const,
    },
    {
      label: "programming",
      taskFamily: "programming" as const,
      learningIntent: "learn" as const,
      outside: false,
      expected: "application" as const,
    },
    {
      label: "mixed assessment",
      taskFamily: "mixed_assessment" as const,
      learningIntent: "study" as const,
      outside: false,
      expected: "verification" as const,
    },
    {
      label: "conceptual Learn",
      taskFamily: "conceptual_learning" as const,
      learningIntent: "learn" as const,
      outside: false,
      expected: "explanation" as const,
    },
    {
      label: "conceptual Practice",
      taskFamily: "conceptual_learning" as const,
      learningIntent: "study" as const,
      outside: false,
      expected: "retrieval" as const,
    },
  ])("derives $label evidence kind without provider influence", ({
    taskFamily,
    learningIntent,
    outside,
    expected,
  }) => {
    const fixture = buildFixture({
      learningIntent,
      oneSession: true,
      independentTopics: true,
    });
    const composition = {
      ...fixture.composition,
      envelopes: fixture.composition.envelopes.map((envelope, index) => (
        index === 0 ? { ...envelope, taskFamily } : envelope
      )),
    };
    const plan = outside
      ? { ...fixture.plan, studyMode: "outside_yova" as const }
      : fixture.plan;

    const result = integrateNormalPlanEnvelopeRoute({
      plan,
      session: plan.sessions[0]!,
      composition,
    });

    expect(result.route.execution.completionEvidence.every((evidence) => (
      evidence.kind === expected
    ))).toBe(true);
  });

  it("turns a current placement gap with stale secure status into a Learn/novice route", () => {
    const fixture = buildFixture({
      oneSession: true,
      prerequisiteEvidence: true,
      gapStatus: "secure",
    });
    const envelope = fixture.composition.envelopes[0]!;
    const decision = envelope.targetModeDecisions[0]!;
    expect(decision).toMatchObject({
      topicId: IDS[1],
      learningMode: "learn",
      basisCode: "placement_gap",
    });

    const result = integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session: fixture.plan.sessions[0]!,
      composition: fixture.composition,
    });
    const state = result.route.target.targetStates[0]!;

    expect(result.route.approach.mode).toBe("learn");
    expect(state).toMatchObject({
      targetId: IDS[1],
      stage: "novice",
      uncertainty: "high",
      evidenceRefs: decision.evidenceRefs,
    });
    expect(state.evidenceRefs).toEqual(decision.evidenceRefs);
    expect(methodSelectionContextForStudyRoute(result.route)).toMatchObject({
      knowledgeStage: "novice",
      learningMode: "learn",
    });
  });

  it("turns one placement demonstration with not-started status into Practice/developing", () => {
    const fixture = buildFixture({
      topicCount: 1,
      oneSession: true,
      prerequisiteEvidence: true,
      demonstratedStatus: "not_started",
    });
    const envelope = fixture.composition.envelopes[0]!;
    const decision = envelope.targetModeDecisions[0]!;
    expect(decision).toMatchObject({
      topicId: IDS[0],
      learningMode: "study",
      basisCode: "placement_demonstrated",
      evidenceRefs: [`placement:${IDS[0]}:${OBSERVED_AT}`],
    });

    const result = integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session: fixture.plan.sessions[0]!,
      composition: fixture.composition,
    });
    const state = result.route.target.targetStates[0]!;

    expect(result.route.approach.mode).toBe("practice");
    expect(state).toMatchObject({
      targetId: IDS[0],
      stage: "developing",
      uncertainty: "medium",
      evidenceRefs: decision.evidenceRefs,
    });
    expect(state.evidenceRefs).toEqual(decision.evidenceRefs);
    expect(methodSelectionContextForStudyRoute(result.route)).toMatchObject({
      knowledgeStage: "developing",
      learningMode: "study",
    });
  });

  it("accepts a partial plan while keeping global deferrals out of the active session route", () => {
    const fixture = buildFixture({
      learningIntent: "study",
      topicCount: 7,
      oneSession: true,
      availabilityMinutes: 25,
    });
    expect(fixture.composition.status).toBe("partial");
    expect(fixture.composition.deferrals.length).toBeGreaterThan(0);
    const session = fixture.plan.sessions[0]!;
    const result = integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session,
      composition: fixture.composition,
    });

    expect(result.route.target.targetStates.map((target) => target.targetId)).toEqual(
      fixture.composition.envelopes[0]!.topicIds,
    );
    expect(result.route.execution.deferredTargets).toEqual([]);
    expect(fixture.plan.knowledgeMap?.topics.filter((topic) => topic.deferred)).toHaveLength(
      fixture.composition.deferrals.length,
    );
  });

  it("keeps the recognized method scaffold temporary for the later canonical method router", () => {
    const fixture = buildFixture({ oneSession: true });
    const session = fixture.plan.sessions[0]!;
    expect(session.method).toBe(NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD.method);
    expect(session.methodReason).toBe(NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD.methodReason);
    expect(session.studyRoute).toBeUndefined();
    const result = integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session,
      composition: fixture.composition,
    });

    expect(result.route.approach.primaryMethodId).toBe("self_explanation");
    expect(result.route.approach.visibleMethodName).toBe(
      CORE_METHOD_CATALOG.self_explanation.name,
    );
    expect(result.route.approach.visibleMethodName).not.toBe(session.method);
    expect(result.route.agency.selectedBy).toBe("legacy_unknown");
    expect(result.route.provenance.ruleTrace.some((entry) => (
      entry.ruleId === "canonical_method_selection_v1"
    ))).toBe(false);
    expect(result.route.provenance.routerVersion.split("+")).toContain(
      LEGACY_STUDY_ROUTE_ADAPTER_VERSION,
    );
    const pendingRoutedPlan = {
      ...fixture.plan,
      sessions: [{ ...session, studyRoute: result.route }],
    };
    const activation = PlanActivationRequestSchema.safeParse({
      plan: pendingRoutedPlan,
      generationRequest: fixture.request,
      draftReceipt: null,
    });
    expect(activation.success).toBe(false);
    if (!activation.success) {
      expect(activation.error.issues.some((issue) => (
        issue.message.includes("learner-visible draft promise")
      ))).toBe(true);
    }
  });

  it("never lets foreign provider prose reclassify the envelope's code-owned task family", () => {
    const fixture = buildFixture({ oneSession: true });
    const fill = structuredClone(buildNormalPlanFallbackFill({
      request: fixture.request,
      composition: fixture.composition,
    }));
    fill.plan.title = "Programming implementation pathway";
    fill.plan.topic = "Writing and debugging a complete software implementation";
    fill.plan.rationale = "The fixed sequence keeps the accepted targets and timing while the learner-facing copy describes a software implementation task.";
    for (const sessionFill of Object.values(fill.sessions)) {
      sessionFill.title = "Implement and debug the program";
      sessionFill.objective = "Implement a complete program, debug its failing tests, and explain the code decisions.";
      for (const slotId of Object.keys(sessionFill.evidence)) {
        sessionFill.evidence[slotId] = "Implement the program, run its tests, and explain the decisive debugging change";
      }
    }
    const draft = bindNormalPlanProviderFill({
      request: fixture.request,
      composition: fixture.composition,
      fill,
    });
    const plan = materializePlanDraft(draft, fixture.request, NOW);
    const session = plan.sessions[0]!;
    expect(classifyLearningTask([
      plan.kind,
      plan.topic,
      session.title,
      session.objective,
      CORE_METHOD_CATALOG.self_explanation.name,
    ].join(" ")).taskType).not.toBe("programming");
    expect(JSON.stringify(plan)).not.toMatch(/implement|program|debug|software/iu);

    const result = integrateNormalPlanEnvelopeRoute({
      plan,
      session,
      composition: fixture.composition,
    });

    expect(fixture.composition.envelopes[0]!.taskFamily).toBe("problem_solving");
    expect(result.route.target.taskFamily).toBe("problem_solving");
    expect(result.route.target.targetStates.map((target) => target.targetId)).toEqual(
      fixture.composition.envelopes[0]!.topicIds,
    );
    expect(result.route.timing).toEqual(fixture.composition.envelopes[0]!.timing);
  });

  it("is deterministic, deeply frozen, and does not mutate any input", () => {
    const fixture = buildFixture();
    const session = fixture.plan.sessions[0]!;
    const planBefore = structuredClone(fixture.plan);
    const compositionBefore = structuredClone(fixture.composition);
    const sessionBefore = structuredClone(session);

    const first = integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session,
      composition: fixture.composition,
    });
    const second = integrateNormalPlanEnvelopeRoute({
      plan: fixture.plan,
      session,
      composition: fixture.composition,
    });

    expect(first).toEqual(second);
    expect(fixture.plan).toEqual(planBefore);
    expect(fixture.composition).toEqual(compositionBefore);
    expect(session).toEqual(sessionBefore);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.route)).toBe(true);
    expect(Object.isFrozen(first.route.provenance.ruleTrace)).toBe(true);
    expect(Reflect.set(first.route.timing, "activeMinutes", 180)).toBe(false);
  });
});

function buildFixture({
  learningIntent = "learn",
  topicCount = 2,
  availabilityMinutes = 60,
  oneSession = false,
  prerequisiteEvidence = false,
  gapStatus = "not_started",
  demonstratedStatus = "evidenced",
  independentTopics = false,
  durationContext: currentDurationContext = durationContext(),
}: {
  learningIntent?: "learn" | "study";
  topicCount?: number;
  availabilityMinutes?: number;
  oneSession?: boolean;
  prerequisiteEvidence?: boolean;
  gapStatus?: "not_started" | "evidenced" | "secure";
  demonstratedStatus?: "not_started" | "evidenced" | "secure";
  independentTopics?: boolean;
  durationContext?: NormalPlanDurationContext;
} = {}) {
  const request = planRequest({
    learningIntent,
    topicCount,
    availabilityMinutes,
    oneSession,
    prerequisiteEvidence,
    gapStatus,
    demonstratedStatus,
    independentTopics,
  });
  const composition = composeNormalPlanEnvelopes({
    request,
    learningIntentRecommendation: {
      intent: learningIntent,
      basis: learningIntent === "learn"
        ? "The learner said this foundation is new."
        : "The learner said this material has already been encountered.",
    },
    durationContext: currentDurationContext,
    now: NOW,
    searchDays: 3,
  });
  const fill = buildNormalPlanFallbackFill({ request, composition });
  const draft = bindNormalPlanProviderFill({ request, composition, fill });
  const plan = materializePlanDraft(draft, request, NOW);
  return { request, composition, draft, plan };
}

function planRequest({
  learningIntent,
  topicCount,
  availabilityMinutes,
  oneSession,
  prerequisiteEvidence,
  gapStatus,
  demonstratedStatus,
  independentTopics,
}: {
  learningIntent: "learn" | "study";
  topicCount: number;
  availabilityMinutes: number;
  oneSession: boolean;
  prerequisiteEvidence: boolean;
  gapStatus: "not_started" | "evidenced" | "secure";
  demonstratedStatus: "not_started" | "evidenced" | "secure";
  independentTopics: boolean;
}) {
  const placementCompleted = prerequisiteEvidence;
  const topics = Array.from({ length: topicCount }, (_, index) => ({
    id: IDS[index]!,
    title: independentTopics
      ? `Product rule problem ${index + 1}`
      : index === 0
        ? "Product rule model"
        : `Product rule application ${index + 1}`,
    description: independentTopics
      ? `Calculate and solve product-rule derivative problem ${index + 1} independently.`
      : index === 0
        ? "Explain why differentiating a product requires both derivative terms."
        : `Solve the mapped product-rule application ${index + 1} independently.`,
    subtopics: [],
    prerequisiteTopicIds: index === 1 && !independentTopics ? [IDS[0]!] : [],
    status: prerequisiteEvidence && index === 0
      ? demonstratedStatus
      : prerequisiteEvidence && index === 1
        ? gapStatus
      : "not_started" as const,
    initialEvidence: prerequisiteEvidence && index === 0
      ? {
          source: "placement_check" as const,
          outcome: "demonstrated" as const,
          observedAt: OBSERVED_AT,
        }
      : prerequisiteEvidence && index === 1
        ? {
            source: "placement_check" as const,
            outcome: "gap" as const,
            observedAt: OBSERVED_AT,
          }
        : null,
    sourceReferences: [],
    origin: "ai_generated" as const,
    deferred: null,
  }));
  const currentScope = scope(oneSession ? {
    minimumSessions: 1,
    recommendedSessions: 1,
    maximumSessions: 1,
    minimumTeachingSessions: learningIntent === "learn" ? 1 : 0,
  } : {});
  return PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent,
    goal: learningIntent === "learn"
      ? "Learn the calculus product rule and then solve unfamiliar derivative problems accurately."
      : "Study the calculus product rule by solving unfamiliar derivative problems without notes.",
    startingContext: learningIntent === "learn"
      ? "This material is new and needs to be taught from the beginning."
      : "I have already learned this material and need focused retrieval practice.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: "2026-09-20T20:00:00.000Z",
    timeZone: "UTC",
    diagnosticResponses: [],
    availability: [{
      day: "Every day",
      window: "Morning",
      minutes: availabilityMinutes,
    }],
    profileSummary: "Use concise explanations, bounded tasks, and an independent check after support.",
    knowledgeMap: {
      version: 1,
      scopeJudgment: currentScope,
      topics,
      placementCheck: placementCompleted
        ? {
            status: "completed",
            completedAt: OBSERVED_AT,
            demonstratedTopicIds: [IDS[0]!],
            gapTopicIds: topicCount > 1 ? [IDS[1]!] : [],
          }
        : {
            status: "skipped",
            completedAt: null,
            demonstratedTopicIds: [],
            gapTopicIds: [],
          },
      curriculum: null,
    },
  });
}

function scope(overrides: Partial<PlanKnowledgeMap["scopeJudgment"]> = {}) {
  return {
    band: "focused_skill" as const,
    label: "Focused calculus skill",
    minimumSessions: 2,
    recommendedSessions: 2,
    maximumSessions: 3,
    minimumTeachingSessions: 1,
    explanation: "A bounded calculus skill needs instruction followed by independent practice.",
    ...overrides,
  };
}

function durationContext({
  sustainableMinutes = null,
  recentOutcomes = [],
}: {
  sustainableMinutes?: 10 | 15 | 25 | 45 | 60 | null;
  recentOutcomes?: NormalPlanDurationContext["recentOutcomes"];
} = {}): NormalPlanDurationContext {
  return {
    profileVersion: "authorized_profile_snapshot:normal-plan-envelope-test-v1",
    profile: {
      sustainableMinutes,
      startingFrictionRisk: null,
      fatigueRisk: null,
      preferredWindow: null,
      evidenceRefs: {
        sustainableMinutes: sustainableMinutes === null
          ? []
          : ["profile:sustainable-duration"],
        startingFrictionRisk: [],
        fatigueRisk: [],
        preferredWindow: [],
      },
    },
    recentOutcomes,
  };
}

function interruptionOutcomes(): NormalPlanDurationContext["recentOutcomes"] {
  return [0, 1].map((index) => ({
    kind: "interruption" as const,
    sessionClass: "normal" as const,
    taskFamily: "problem_solving" as const,
    mode: "learn" as const,
    occurredAt: `2026-08-${22 - index}T10:00:00.000Z`,
    routeRevisionId: `40000000-4000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    plannedMinutes: 45,
    actualMinutes: 10,
    completedSteps: 1,
    totalSteps: 4,
    evidenceRef: `outcome:early-interruption:${index + 1}`,
  }));
}

function expectIntegrationError(callback: () => unknown, code: string) {
  try {
    callback();
    throw new Error("Expected normal-plan envelope integration to reject the fixture.");
  } catch (error) {
    expect(error).toBeInstanceOf(NormalPlanEnvelopeRouteIntegrationError);
    expect((error as NormalPlanEnvelopeRouteIntegrationError).code).toBe(code);
  }
}
