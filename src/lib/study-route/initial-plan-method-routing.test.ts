import { describe, expect, it } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import type { GenerationPersonalizationContext } from "@/lib/personalization/personalization-generation";
import { NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD } from "@/lib/plan-generation/normal-plan-provider-fill";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import {
  INITIAL_PLAN_METHOD_ROUTING_VERSION,
  integrateInitialPlanMethodRoutes,
  type InitialPlanMethodRoutingContext,
} from "@/lib/study-route/initial-plan-method-routing";
import { NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION } from "@/lib/study-route/normal-plan-envelope-integration";
import { StudyRouteSchema } from "@/lib/study-route/schema";

const NOW = new Date("2026-08-24T12:00:00.000Z");

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
  profileSummary: "This display-only prose must not control method routing.",
});

describe("initial multi-session method routing", () => {
  it("writes one canonical provisional method route for every ordinary draft session", () => {
    const plan = generatePreviewPlan(request, NOW);
    const before = structuredClone(plan);
    const integrated = integrateInitialPlanMethodRoutes({
      plan,
      request,
      context: emptyContext(),
    });

    expect(plan).toEqual(before);
    expect(integrated).not.toBe(plan);
    expect(integrated.sessions.length).toBeGreaterThan(1);
    for (const session of integrated.sessions) {
      const route = StudyRouteSchema.parse(session.studyRoute);
      expect(route.identity).toMatchObject({
        lifecycleStatus: "provisional",
        planId: integrated.id,
        sessionId: session.id,
      });
      expect(session).toMatchObject({
        method: route.approach.visibleMethodName,
        methodReason: route.explanation.shortReason,
        estimatedMinutes: route.timing.activeMinutes,
        learningMode: route.approach.mode === "learn" ? "learn" : "study",
      });
      expect(route.agency).toMatchObject({
        controlMode: "yova_decides",
        selectedBy: "yova",
      });
      expect(route.provenance.profileVersion).toContain("authorized_profile_context_v1+empty");
      expect(route.provenance.ruleTrace).toEqual(expect.arrayContaining([
        expect.objectContaining({ ruleId: INITIAL_PLAN_METHOD_ROUTING_VERSION }),
        expect.objectContaining({ ruleId: "method_eligibility_v1" }),
        expect.objectContaining({ ruleId: "canonical_method_selection_v1" }),
      ]));
      expect(route.provenance.ruleTrace.find(
        (entry) => entry.ruleId === INITIAL_PLAN_METHOD_ROUTING_VERSION,
      )?.reason).toMatch(/generated method prose was excluded/i);
    }
  });

  it("produces the same route decisions when provider method prose changes or is unrecognized", () => {
    const original = generatePreviewPlan(request, NOW);
    const providerVariant = withoutRoutes({
      ...original,
      sessions: original.sessions.map((session, index) => ({
        ...session,
        method: index % 2 === 0 ? "Feynman blurting mashup" : "Passive rereading",
        methodReason: "Provider prose that the canonical router must ignore completely.",
      })),
    });

    const baseline = integrateInitialPlanMethodRoutes({
      plan: original,
      request,
      context: emptyContext(),
    });
    const changed = integrateInitialPlanMethodRoutes({
      plan: providerVariant,
      request,
      context: emptyContext(),
    });

    expect(methodDecisions(changed)).toEqual(methodDecisions(baseline));
    expect(changed.sessions.every((session) => (
      !/Feynman|Passive rereading/i.test(session.method)
    ))).toBe(true);
  });

  it("preserves the envelope-owned conceptual task family against coding and essay provider prose", () => {
    const source = generatePreviewPlan(request, NOW);
    const codingPlan = withEnvelopeOwnedConceptualRoutes(source, "coding");
    const essayPlan = withEnvelopeOwnedConceptualRoutes(source, "essay");

    const coding = integrateInitialPlanMethodRoutes({
      plan: codingPlan,
      request,
      context: emptyContext(),
    });
    const essay = integrateInitialPlanMethodRoutes({
      plan: essayPlan,
      request,
      context: emptyContext(),
    });

    expect(envelopeMethodSnapshots(coding)).toEqual(envelopeMethodSnapshots(essay));
    for (const session of coding.sessions) {
      const route = StudyRouteSchema.parse(session.studyRoute);
      const routingTrace = route.provenance.ruleTrace.find(
        (entry) => entry.ruleId === INITIAL_PLAN_METHOD_ROUTING_VERSION,
      );
      expect(route.target.taskFamily).toBe("conceptual_learning");
      expect(routingTrace).toMatchObject({
        result: "conceptual_learning:normal_plan_envelope",
        reason: expect.stringMatching(/provider plan, session, evidence, and method prose were excluded/i),
      });
      expect(session.method).toBe(route.approach.visibleMethodName);
      expect(session.methodReason).toBe(route.explanation.shortReason);
      expect(session).not.toMatchObject(NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD);
    }
  });

  it("recognizes the envelope authority version only as an exact router component", () => {
    const source = withEnvelopeOwnedConceptualRoutes(
      generatePreviewPlan(request, NOW),
      "coding",
    );
    const shadowMarkerPlan: LearningPlan = {
      ...source,
      sessions: source.sessions.map((session) => {
        const route = StudyRouteSchema.parse(session.studyRoute);
        return {
          ...session,
          studyRoute: StudyRouteSchema.parse({
            ...route,
            provenance: {
              ...route.provenance,
              routerVersion: route.provenance.routerVersion.replace(
                NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION,
                `shadow_${NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION}_suffix`,
              ),
            },
          }),
        };
      }),
    };

    const integrated = integrateInitialPlanMethodRoutes({
      plan: shadowMarkerPlan,
      request,
      context: emptyContext(),
    });

    expect(integrated.sessions.every((session) => (
      StudyRouteSchema.parse(session.studyRoute).target.taskFamily === "programming"
    ))).toBe(true);
    expect(integrated.sessions.every((session) => (
      StudyRouteSchema.parse(session.studyRoute).provenance.ruleTrace.some((entry) => (
        entry.ruleId === INITIAL_PLAN_METHOD_ROUTING_VERSION
        && entry.result === "programming:clear"
      ))
    ))).toBe(true);
  });

  it("lets one authorized declaration change only eligible routes and records the exact signal", () => {
    const plan = generatePreviewPlan(request, NOW);
    const baseline = integrateInitialPlanMethodRoutes({
      plan,
      request,
      context: emptyContext(),
    });
    const declared = integrateInitialPlanMethodRoutes({
      plan,
      request,
      context: contextWithMemorySignal("similar_idea_confusion"),
    });
    const baselineMethods = methodDecisions(baseline);
    const declaredMethods = methodDecisions(declared);

    expect(declaredMethods).not.toEqual(baselineMethods);
    const changedSession = declared.sessions.find((session, index) => (
      session.method !== baseline.sessions[index]?.method
    ));
    expect(changedSession).toBeDefined();
    const route = StudyRouteSchema.parse(changedSession?.studyRoute);
    expect(route.explanation.shortReason).toMatch(/^You told YOVA/u);
    expect(route.explanation.learnerDeclarations[0]).toBe(route.explanation.shortReason);
    expect(route.provenance.evidenceRefs).toContain("signal:memory_breakdown");
    expect(route.provenance.ruleTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: "canonical_method_selection_v1",
        result: expect.stringContaining("authorized_declaration"),
      }),
    ]));
    expect(route.agency.alternatives).toHaveLength(1);
    expect(route.agency.alternatives.every((alternative) => (
      alternative.mode === route.approach.mode
      && alternative.executionEnvironment === route.approach.executionEnvironment
    ))).toBe(true);
  });

  it("rejects Study Now, activated plans, and scheduled-review contracts", () => {
    const plan = generatePreviewPlan(request, NOW);
    expect(() => integrateInitialPlanMethodRoutes({
      plan,
      request: PlanGenerationRequestSchema.parse({
        ...request,
        intent: "study_now",
        deadline: null,
        availability: [{ day: "Monday", window: "Now", minutes: 25 }],
      }),
      context: emptyContext(),
    })).toThrow(/ordinary plan drafts/i);
    expect(() => integrateInitialPlanMethodRoutes({
      plan: { ...plan, status: "active" },
      request,
      context: emptyContext(),
    })).toThrow(/before the plan is activated/i);
    expect(() => integrateInitialPlanMethodRoutes({
      plan: {
        ...plan,
        sessions: [{
          ...plan.sessions[0]!,
          reviewType: "verify",
          reviewConcept: "Product rule",
        }],
      },
      request,
      context: emptyContext(),
    })).toThrow(/scheduled review/i);
  });
});

function emptyContext(): InitialPlanMethodRoutingContext {
  return {
    profileVersion: "authorized_profile_context_v1+empty",
    personalization: personalization(),
    observedEvidence: [],
  };
}

function contextWithMemorySignal(
  code: string,
): InitialPlanMethodRoutingContext {
  return {
    profileVersion: "authorized_profile_context_v1+profile-revision-test",
    personalization: personalization({
      id: "signal:memory_breakdown",
      key: "memory_breakdown",
      title: "Memory breakdown",
      code,
      evidenceLabel: "You told YOVA",
      paused: false,
    }),
    observedEvidence: [],
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

function withoutRoutes(plan: LearningPlan): LearningPlan {
  return {
    ...plan,
    sessions: plan.sessions.map((session) => ({ ...session, studyRoute: undefined })),
  };
}

function withEnvelopeOwnedConceptualRoutes(
  plan: LearningPlan,
  providerProse: "coding" | "essay",
): LearningPlan {
  const copy = providerProse === "coding"
    ? {
        planTitle: "Implement and debug a TypeScript compiler",
        planTopic: "Programming algorithms, API code, and compiler debugging",
        sessionTitle: "Write and debug the TypeScript algorithm",
        objective: "Implement, run, test, and refactor a TypeScript compiler function.",
        target: "Build working code for a compiler algorithm.",
        evidence: "Implement and debug the TypeScript function without copied code.",
      }
    : {
        planTitle: "Draft a persuasive history essay",
        planTopic: "Argumentative writing, thesis development, and evidence paragraphs",
        sessionTitle: "Draft the claim and evidence paragraph",
        objective: "Write and revise an argumentative essay with a defensible thesis.",
        target: "Draft a claim, evidence, and reasoning paragraph.",
        evidence: "Write and revise the essay paragraph against the rubric.",
      };

  return {
    ...plan,
    title: copy.planTitle,
    topic: copy.planTopic,
    sessions: plan.sessions.map((session) => {
      const route = StudyRouteSchema.parse(session.studyRoute);
      const routerComponents = new Set([
        ...route.provenance.routerVersion.split("+"),
        NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION,
      ]);
      return {
        ...session,
        title: copy.sessionTitle,
        objective: copy.objective,
        contentTargets: [copy.target],
        completionEvidence: [copy.evidence],
        ...NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD,
        studyRoute: StudyRouteSchema.parse({
          ...route,
          target: {
            ...route.target,
            taskFamily: "conceptual_learning",
          },
          provenance: {
            ...route.provenance,
            routerVersion: [...routerComponents].join("+"),
          },
        }),
      };
    }),
  };
}

function envelopeMethodSnapshots(plan: LearningPlan) {
  return plan.sessions.map((session) => {
    const route = StudyRouteSchema.parse(session.studyRoute);
    return {
      taskFamily: route.target.taskFamily,
      methodId: route.approach.primaryMethodId,
      visibleMethodName: route.approach.visibleMethodName,
      shortReason: route.explanation.shortReason,
      ruleTrace: route.provenance.ruleTrace,
    };
  });
}

function methodDecisions(plan: LearningPlan) {
  return plan.sessions.map((session) => {
    const route = StudyRouteSchema.parse(session.studyRoute);
    return {
      methodId: route.approach.primaryMethodId,
      taskFamily: route.target.taskFamily,
      mode: route.approach.mode,
      reason: route.explanation.shortReason,
    };
  });
}
