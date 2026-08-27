import { describe, expect, it } from "vitest";
import type { GenerationPersonalizationContext } from "@/lib/personalization/personalization-generation";
import {
  composeNormalPlanEnvelopes,
  type NormalPlanDurationContext,
} from "@/lib/plan-generation/normal-plan-envelopes";
import {
  buildNormalPlanFallbackFill,
  normalPlanEvidenceSlotIds,
} from "@/lib/plan-generation/normal-plan-provider-fill";
import {
  buildNormalPlanFromFixedEnvelope,
} from "@/lib/plan-generation/normal-plan-pipeline";
import {
  GeneratedLearningPlanSchema,
  PlanGenerationRequestSchema,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";
import type { InitialPlanMethodRoutingContext } from "@/lib/study-route/initial-plan-method-routing";
import { NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION } from "@/lib/study-route/normal-plan-envelope-integration";
import { StudyRouteSchema } from "@/lib/study-route/schema";

const NOW = new Date("2026-08-24T08:00:00.000Z");
const TOPIC_IDS = [
  "50000000-5000-4000-8000-000000000001",
  "50000000-5000-4000-8000-000000000002",
  "50000000-5000-4000-8000-000000000003",
  "50000000-5000-4000-8000-000000000004",
];

describe("atomic normal-plan pipeline", () => {
  it("keeps task and method authority in code when provider wording says coding or essay", () => {
    const fixture = buildFixture();
    const fallbackPlan = buildNormalPlanFromFixedEnvelope({
      ...fixture,
      fill: fixture.fallback,
    });
    const codingPlan = buildNormalPlanFromFixedEnvelope({
      ...fixture,
      fill: providerVariant(fixture, "coding"),
    });
    const essayPlan = buildNormalPlanFromFixedEnvelope({
      ...fixture,
      fill: providerVariant(fixture, "essay"),
    });

    expect(authoritySnapshot(codingPlan)).toEqual(authoritySnapshot(fallbackPlan));
    expect(authoritySnapshot(essayPlan)).toEqual(authoritySnapshot(fallbackPlan));
    expect(codingPlan.title).toBe(fallbackPlan.title);
    expect(essayPlan.title).toBe(fallbackPlan.title);
    expect(codingPlan.sessions[0]!.objective).toBe(fallbackPlan.sessions[0]!.objective);
    expect(essayPlan.sessions[0]!.objective).toBe(fallbackPlan.sessions[0]!.objective);
    const foreignTaskLanguage = /typescript|compiler|program|debug|essay|argumentative/i;
    for (const plan of [codingPlan, essayPlan]) {
      expect([
        plan.title,
        plan.topic,
        plan.rationale,
        ...plan.sessions.flatMap((session) => [session.title, session.objective]),
      ].join(" ")).not.toMatch(foreignTaskLanguage);
    }
    for (const [index, envelope] of fixture.composition.envelopes.entries()) {
      expect(StudyRouteSchema.parse(codingPlan.sessions[index]!.studyRoute).target.taskFamily)
        .toBe(envelope.taskFamily);
      expect(StudyRouteSchema.parse(essayPlan.sessions[index]!.studyRoute).target.taskFamily)
        .toBe(envelope.taskFamily);
    }
  });

  it("returns only fully routed sessions with the exact envelope timing, mode, identity, targets, and provenance", () => {
    const fixture = buildFixture();
    const plan = buildNormalPlanFromFixedEnvelope({
      ...fixture,
      fill: fixture.fallback,
    });

    expect(() => GeneratedLearningPlanSchema.parse(plan)).not.toThrow();
    expect(plan.sessions).toHaveLength(fixture.composition.envelopes.length);
    plan.sessions.forEach((session, index) => {
      const envelope = fixture.composition.envelopes[index]!;
      const route = StudyRouteSchema.parse(session.studyRoute);
      expect(session).toMatchObject({
        sequence: envelope.sequence,
        scheduledFor: envelope.scheduledFor,
        estimatedMinutes: envelope.timing.activeMinutes,
        learningMode: envelope.learningMode,
        topicIds: envelope.topicIds,
      });
      expect(route.identity).toMatchObject({
        lifecycleStatus: "provisional",
        planId: plan.id,
        sessionId: session.id,
      });
      expect(route.target).toMatchObject({
        taskFamily: envelope.taskFamily,
        desiredOutcome: session.objective,
      });
      expect(route.target.targetStates.map((target) => target.targetId)).toEqual(
        envelope.topicIds,
      );
      expect(route.approach.mode).toBe(
        envelope.learningMode === "learn" ? "learn" : "practice",
      );
      expect(route.timing).toEqual(envelope.timing);
      expect(route.provenance.routerVersion.split("+")).toContain(
        NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION,
      );
      for (const trace of [...envelope.modeRuleTrace, ...envelope.durationRuleTrace]) {
        expect(route.provenance.ruleTrace).toContainEqual(trace);
      }
      for (const evidenceRef of envelope.prerequisiteEvidenceRefs) {
        expect(route.provenance.evidenceRefs).toContain(evidenceRef);
      }
      expect(route.provenance.profileVersion.split("+")).toEqual(
        expect.arrayContaining([
          ...fixture.composition.profileVersion.split("+"),
          ...fixture.methodContext.profileVersion.split("+"),
        ]),
      );
      expect(session.method).toBe(route.approach.visibleMethodName);
      expect(session.methodReason).toBe(route.explanation.shortReason);
      expect(session.completionEvidence).toEqual(
        route.execution.completionEvidence.map((evidence) => evidence.description),
      );
      expect(session.method).not.toBe("Pending code-owned method");
      expect(route.agency).toMatchObject({
        controlMode: "yova_decides",
        selectedBy: "yova",
      });
    });
  });

  it("rejects malformed or request-mismatched compositions before provider copy can be returned", () => {
    const fixture = buildFixture();
    const shiftedSchedule = {
      ...structuredClone(fixture.composition),
      envelopes: fixture.composition.envelopes.map((envelope, index) => (
        index === 0
          ? {
              ...structuredClone(envelope),
              scheduledFor: new Date(
                Date.parse(envelope.scheduledFor) + 5 * 60_000,
              ).toISOString(),
            }
          : structuredClone(envelope)
      )),
    };
    expect(() => buildNormalPlanFromFixedEnvelope({
      ...fixture,
      composition: shiftedSchedule,
      fill: fixture.fallback,
    })).toThrow(/schedule|availability/i);

    const providerTaskPatch = {
      ...structuredClone(fixture.composition),
      envelopes: fixture.composition.envelopes.map((envelope, index) => (
        index === 0
          ? {
              ...structuredClone(envelope),
              taskFamily: "programming" as const,
              taskClassification: {
                taskType: "programming" as const,
                confidence: "clear" as const,
                evidence: ["implementation language"],
              },
            }
          : structuredClone(envelope)
      )),
    };
    expect(() => buildNormalPlanFromFixedEnvelope({
      ...fixture,
      composition: providerTaskPatch,
      fill: fixture.fallback,
    })).toThrow(/task family/i);

    const changedAvailability = PlanGenerationRequestSchema.parse({
      ...fixture.request,
      availability: [{ day: "Every day", window: "Morning", minutes: 25 }],
    });
    expect(() => buildNormalPlanFromFixedEnvelope({
      ...fixture,
      request: changedAvailability,
      fill: fixture.fallback,
    })).toThrow(/availability|hard maximum/i);

    const missingCoverage = {
      ...structuredClone(fixture.composition),
      envelopes: fixture.composition.envelopes.slice(1),
    };
    expect(() => buildNormalPlanFromFixedEnvelope({
      ...fixture,
      composition: missingCoverage,
      fill: fixture.fallback,
    })).toThrow();
  });

  it("does not mutate inputs and deeply freezes the only plan it exposes", () => {
    const fixture = buildFixture();
    const requestBefore = structuredClone(fixture.request);
    const compositionBefore = structuredClone(fixture.composition);
    const fillBefore = structuredClone(fixture.fallback);
    const methodContextBefore = structuredClone(fixture.methodContext);
    const nowBefore = fixture.now.getTime();

    const plan = buildNormalPlanFromFixedEnvelope({
      ...fixture,
      fill: fixture.fallback,
    });

    expect(fixture.request).toEqual(requestBefore);
    expect(fixture.composition).toEqual(compositionBefore);
    expect(fixture.fallback).toEqual(fillBefore);
    expect(fixture.methodContext).toEqual(methodContextBefore);
    expect(fixture.now.getTime()).toBe(nowBefore);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.sessions)).toBe(true);
    expect(Object.isFrozen(plan.sessions[0])).toBe(true);
    expect(Object.isFrozen(plan.sessions[0]!.studyRoute)).toBe(true);
    expect(Object.isFrozen(plan.sessions[0]!.studyRoute!.provenance.ruleTrace)).toBe(true);
    expect(Reflect.set(plan.sessions[0]!, "method", "Provider override")).toBe(false);
    expect(Reflect.set(
      plan.sessions[0]!.studyRoute!.timing,
      "activeMinutes",
      180,
    )).toBe(false);
  });

  it("accepts an explicit map deferral with a prerequisite and an empty prerequisite list", () => {
    const prerequisite = deferralTopic(0);
    const explicitlyDeferred = deferralTopic(1, {
      prerequisiteTopicIds: [prerequisite.id],
      deferred: {
        reason: "This target is explicitly outside the accepted plan boundary.",
      },
    });
    const fixture = buildFixtureForRequest(deferralRequest([
      prerequisite,
      explicitlyDeferred,
    ]));

    expect(fixture.composition.deferrals).toContainEqual(expect.objectContaining({
      topicId: explicitlyDeferred.id,
      reasonCode: "accepted_map_deferral",
      prerequisiteTopicIds: [],
    }));
    expect(() => buildNormalPlanFromFixedEnvelope({
      ...fixture,
      fill: fixture.fallback,
    })).not.toThrow();
  });

  it("accepts a capacity-deferred dependent when its evidenced prerequisite is scheduled", () => {
    const prerequisite = deferralTopic(0, {
      status: "evidenced",
    });
    const dependent = deferralTopic(1, {
      title: "Solve unfamiliar equations",
      description: "Solve unfamiliar algebra equations accurately and explain each deciding step.",
      subtopics: ["Select and apply the correct algebra procedure"],
      prerequisiteTopicIds: [prerequisite.id],
    });
    const fixture = buildFixtureForRequest(deferralRequest([
      prerequisite,
      dependent,
    ]));

    expect(fixture.composition.envelopes[0]!.topicIds).toEqual([prerequisite.id]);
    expect(fixture.composition.deferrals).toContainEqual(expect.objectContaining({
      topicId: dependent.id,
      reasonCode: "session_cap",
      prerequisiteTopicIds: [],
    }));
    expect(() => buildNormalPlanFromFixedEnvelope({
      ...fixture,
      fill: fixture.fallback,
    })).not.toThrow();
  });

  it("stores only the blocked edge for a multi-prerequisite deferral in map order", () => {
    const observedAt = "2026-08-23T12:00:00.000Z";
    const staleGap = deferralTopic(0, {
      status: "secure",
      initialEvidence: {
        source: "placement_check",
        outcome: "gap",
        observedAt,
      },
      deferred: {
        reason: "This prerequisite is explicitly outside the accepted plan boundary.",
      },
    });
    const satisfied = deferralTopic(1, {
      status: "evidenced",
      initialEvidence: {
        source: "placement_check",
        outcome: "demonstrated",
        observedAt,
      },
    });
    const dependent = deferralTopic(2, {
      title: "Apply both foundations",
      description: "Apply both prerequisite ideas to explain the combined mechanism accurately.",
      prerequisiteTopicIds: [staleGap.id, satisfied.id],
    });
    const fixture = buildFixtureForRequest(deferralRequest(
      [staleGap, satisfied, dependent],
      {
        status: "completed",
        completedAt: observedAt,
        demonstratedTopicIds: [satisfied.id],
        gapTopicIds: [staleGap.id],
      },
    ));

    expect(fixture.composition.envelopes[0]!.topicIds).toEqual([satisfied.id]);
    expect(fixture.composition.deferrals).toContainEqual(expect.objectContaining({
      topicId: dependent.id,
      reasonCode: "prerequisite_deferred",
      prerequisiteTopicIds: [staleGap.id],
    }));
    expect(() => buildNormalPlanFromFixedEnvelope({
      ...fixture,
      fill: fixture.fallback,
    })).not.toThrow();
  });
});

function buildFixture() {
  const request = PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent: "learn",
    goal: "Learn the calculus product rule and solve unfamiliar derivative problems accurately.",
    startingContext: "This procedure is new, and I need to learn it before solving problems independently.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: "2026-09-20T20:00:00.000Z",
    timeZone: "UTC",
    diagnosticResponses: [],
    availability: [{ day: "Every day", window: "Morning", minutes: 60 }],
    profileSummary: "Use concise explanations and preserve an independent attempt after initial support.",
    knowledgeMap: {
      version: 1,
      scopeJudgment: {
        band: "focused_skill",
        label: "Focused calculus skill",
        minimumSessions: 2,
        recommendedSessions: 2,
        maximumSessions: 3,
        minimumTeachingSessions: 1,
        explanation: "One bounded lesson and one later independent application are required.",
      },
      topics: [
        {
          id: TOPIC_IDS[0],
          title: "Product rule structure",
          description: "Explain why a derivative of a product contains two derivative terms.",
          subtopics: ["Differentiate a product using both terms"],
          prerequisiteTopicIds: [],
          status: "not_started",
          initialEvidence: null,
          sourceReferences: [],
          origin: "ai_generated",
          deferred: null,
        },
        {
          id: TOPIC_IDS[1],
          title: "Product rule problem solving",
          description: "Solve unfamiliar derivative problems that require the product rule.",
          subtopics: ["Choose and apply the product rule independently"],
          prerequisiteTopicIds: [TOPIC_IDS[0]],
          status: "not_started",
          initialEvidence: null,
          sourceReferences: [],
          origin: "ai_generated",
          deferred: null,
        },
      ],
      placementCheck: {
        status: "skipped",
        completedAt: null,
        demonstratedTopicIds: [],
        gapTopicIds: [],
      },
      curriculum: null,
    },
  });
  const composition = composeNormalPlanEnvelopes({
    request,
    learningIntentRecommendation: {
      intent: "learn",
      basis: "The learner explicitly said this procedure is new.",
    },
    durationContext: durationContext(),
    now: NOW,
    searchDays: 7,
  });
  const fallback = buildNormalPlanFallbackFill({ request, composition });
  return {
    request,
    composition,
    fallback,
    now: new Date(NOW.getTime()),
    methodContext: methodContext(),
  };
}

type AcceptedTopic = NonNullable<PlanGenerationRequest["knowledgeMap"]>["topics"][number];
type PlacementCheck = NonNullable<PlanGenerationRequest["knowledgeMap"]>["placementCheck"];

function buildFixtureForRequest(request: PlanGenerationRequest) {
  const composition = composeNormalPlanEnvelopes({
    request,
    learningIntentRecommendation: {
      intent: request.learningIntent,
      basis: request.learningIntent === "learn"
        ? "The learner said these targets have not been learned yet."
        : "The learner said these accepted targets are ready for study.",
    },
    durationContext: durationContext(),
    now: NOW,
    searchDays: 7,
  });
  return {
    request,
    composition,
    fallback: buildNormalPlanFallbackFill({ request, composition }),
    now: new Date(NOW.getTime()),
    methodContext: methodContext(),
  };
}

function deferralRequest(
  topics: AcceptedTopic[],
  placementCheck: PlacementCheck = {
    status: "skipped",
    completedAt: null,
    demonstratedTopicIds: [],
    gapTopicIds: [],
  },
): PlanGenerationRequest {
  return PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent: "study",
    goal: "Study the accepted target map and produce accurate independent evidence for each target.",
    startingContext: "These targets have been encountered before and now need focused practice.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: "2026-09-20T20:00:00.000Z",
    timeZone: "UTC",
    diagnosticResponses: [],
    availability: [{ day: "Every day", window: "Morning", minutes: 60 }],
    profileSummary: "Use concise explanations and preserve an independent evidence-producing attempt.",
    knowledgeMap: {
      version: 1,
      scopeJudgment: {
        band: "focused_skill",
        label: "Bounded accepted targets",
        minimumSessions: 1,
        recommendedSessions: 1,
        maximumSessions: 1,
        minimumTeachingSessions: 0,
        explanation: "One bounded Practice session is available for the active accepted targets.",
      },
      topics,
      placementCheck,
      curriculum: null,
    },
  });
}

function deferralTopic(
  index: number,
  overrides: Partial<AcceptedTopic> = {},
): AcceptedTopic {
  return {
    id: TOPIC_IDS[index]!,
    title: `Explain foundation ${index + 1}`,
    description: `Explain how foundation ${index + 1} works and why its core relationship matters.`,
    subtopics: [],
    prerequisiteTopicIds: [],
    status: "not_started",
    initialEvidence: null,
    sourceReferences: [],
    origin: "ai_generated",
    deferred: null,
    ...overrides,
  };
}

function durationContext(): NormalPlanDurationContext {
  return {
    profileVersion: "authorized_duration_profile_v1+duration_outcomes_empty",
    profile: {
      sustainableMinutes: 25,
      startingFrictionRisk: null,
      fatigueRisk: null,
      preferredWindow: null,
      evidenceRefs: {
        sustainableMinutes: ["profile:sustainable-duration"],
        startingFrictionRisk: [],
        fatigueRisk: [],
        preferredWindow: [],
      },
    },
    recentOutcomes: [],
  };
}

function methodContext(): InitialPlanMethodRoutingContext {
  return {
    profileVersion: "authorized_method_profile_v1+method_outcomes_empty",
    personalization: personalization(),
    observedEvidence: [],
  };
}

function personalization(): GenerationPersonalizationContext {
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

function providerVariant(
  fixture: ReturnType<typeof buildFixture>,
  variant: "coding" | "essay",
) {
  const fill = structuredClone(fixture.fallback);
  const copy = variant === "coding"
    ? {
        title: "Implement and debug a TypeScript compiler",
        topic: "Programming algorithms and compiler debugging",
        rationale: "This provider copy describes a coding project, but it fills only the prose slots of the already fixed learning sequence.",
        sessionTitle: "Implement and debug the algorithm",
        objective: "Implement a complete program, run its tests, debug failures, and explain each decisive code change.",
        evidence: "Implement the program, run its tests, and explain the decisive debugging change",
      }
    : {
        title: "Draft a persuasive history essay",
        topic: "Argumentative writing and evidence paragraphs",
        rationale: "This provider copy describes an essay project, but it fills only the prose slots of the already fixed learning sequence.",
        sessionTitle: "Draft the claim and evidence paragraph",
        objective: "Draft and revise an argumentative paragraph with a defensible claim, evidence, and explicit reasoning.",
        evidence: "Draft one argument paragraph and match every claim to its supporting evidence",
      };
  fill.plan.title = copy.title;
  fill.plan.topic = copy.topic;
  fill.plan.rationale = copy.rationale;
  fixture.composition.envelopes.forEach((envelope, index) => {
    const session = fill.sessions[envelope.envelopeId]!;
    session.title = `${copy.sessionTitle} ${index + 1}`;
    session.objective = `${copy.objective} This is fixed session ${index + 1}.`;
    normalPlanEvidenceSlotIds(envelope).forEach((slotId, evidenceIndex) => {
      session.evidence[slotId] = `${copy.evidence} in evidence check ${evidenceIndex + 1}`;
    });
  });
  return fill;
}

function authoritySnapshot(plan: ReturnType<typeof buildNormalPlanFromFixedEnvelope>) {
  return plan.sessions.map((session) => {
    const route = StudyRouteSchema.parse(session.studyRoute);
    return {
      sequence: session.sequence,
      scheduledFor: session.scheduledFor,
      estimatedMinutes: session.estimatedMinutes,
      learningMode: session.learningMode,
      topicIds: session.topicIds,
      taskFamily: route.target.taskFamily,
      mode: route.approach.mode,
      timing: route.timing,
      methodId: route.approach.primaryMethodId,
      method: route.approach.visibleMethodName,
      methodReason: route.explanation.shortReason,
      profileVersion: route.provenance.profileVersion,
      routerVersion: route.provenance.routerVersion,
      evidenceRefs: route.provenance.evidenceRefs,
      ruleTrace: route.provenance.ruleTrace,
    };
  });
}
