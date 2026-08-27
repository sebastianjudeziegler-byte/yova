import { zodTextFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import {
  composeNormalPlanEnvelopes,
  type NormalPlanDurationContext,
  type NormalPlanEnvelopeComposition,
} from "@/lib/plan-generation/normal-plan-envelopes";
import {
  NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD,
  NormalPlanProviderFillError,
  assertNormalPlanMethodScaffoldReplaced,
  bindNormalPlanProviderFill,
  buildNormalPlanFallbackFill,
  buildNormalPlanProviderFillSchema,
  hasNormalPlanInternalMethodScaffold,
  normalPlanEvidenceSlotIds,
  resolveNormalPlanKind,
  type NormalPlanProviderFill,
} from "@/lib/plan-generation/normal-plan-provider-fill";
import { inspectGeneratedPlanQuality } from "@/lib/plan-generation/quality-gate";
import {
  PlanGenerationRequestSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";

const NOW = new Date("2026-08-10T08:00:00.000Z");
const IDS = Array.from({ length: 10 }, (_, index) => (
  `20000000-2000-4000-8000-${String(index + 1).padStart(12, "0")}`
));

describe("normal-plan provider-fill boundary", () => {
  it("builds an exact strict schema that is usable by zodTextFormat", () => {
    const contract = normalContract();
    const schema = buildNormalPlanProviderFillSchema(contract);
    const fallback = buildNormalPlanFallbackFill(contract);

    expect(schema.parse(fallback)).toEqual(fallback);
    expect(() => zodTextFormat(schema, "yova_normal_plan_fill")).not.toThrow();
    expect(Object.keys(fallback.sessions)).toEqual(
      contract.composition.envelopes.map((envelope) => envelope.envelopeId),
    );
    for (const envelope of contract.composition.envelopes) {
      expect(Object.keys(fallback.sessions[envelope.envelopeId]!.evidence)).toEqual(
        normalPlanEvidenceSlotIds(envelope),
      );
    }
  });

  it("rejects missing or extra slots and every attempted structural provider field", () => {
    const contract = normalContract();
    const fallback = buildNormalPlanFallbackFill(contract);
    const envelopeId = contract.composition.envelopes[0]!.envelopeId;
    const evidenceId = normalPlanEvidenceSlotIds(contract.composition.envelopes[0]!)[0]!;

    const missingEvidence = structuredClone(fallback);
    delete missingEvidence.sessions[envelopeId]!.evidence[evidenceId];
    expectFillError(() => bindNormalPlanProviderFill({
      ...contract,
      fill: missingEvidence,
    }), "invalid_fill");

    const extraEvidence = structuredClone(fallback);
    extraEvidence.sessions[envelopeId]!.evidence["evidence-999"] =
      "Solve one additional problem and explain the deciding step";
    expectFillError(() => bindNormalPlanProviderFill({
      ...contract,
      fill: extraEvidence,
    }), "invalid_fill");

    const missingSession = structuredClone(fallback);
    delete missingSession.sessions[envelopeId];
    expectFillError(() => bindNormalPlanProviderFill({
      ...contract,
      fill: missingSession,
    }), "invalid_fill");

    const extraSession = structuredClone(fallback) as NormalPlanProviderFill & {
      sessions: Record<string, NormalPlanProviderFill["sessions"][string] & {
        learningMode?: string;
      }>;
    };
    extraSession.sessions[envelopeId]!.learningMode = "study";
    expectFillError(() => bindNormalPlanProviderFill({
      ...contract,
      fill: extraSession,
    }), "invalid_fill");

    const unknownEnvelope = structuredClone(fallback);
    unknownEnvelope.sessions["normal-plan-envelope-999"] = structuredClone(
      unknownEnvelope.sessions[envelopeId]!,
    );
    expectFillError(() => bindNormalPlanProviderFill({
      ...contract,
      fill: unknownEnvelope,
    }), "invalid_fill");

    const extraRoot = { ...structuredClone(fallback), deadline: "2026-08-20T00:00:00.000Z" };
    expectFillError(() => bindNormalPlanProviderFill({
      ...contract,
      fill: extraRoot,
    }), "invalid_fill");

    const overGroupedComposition = {
      ...contract.composition,
      envelopes: contract.composition.envelopes.map((envelope, index) => (
        index === 0
          ? {
              ...envelope,
              contentBudget: {
                ...envelope.contentBudget,
                maximumCompletionChecks: 1,
              },
            }
          : envelope
      )),
    };
    expectFillError(() => bindNormalPlanProviderFill({
      request: contract.request,
      composition: overGroupedComposition,
      fill: fallback,
    }), "invalid_composition");
  });

  it("binds every structural field from code and every target label from the map", () => {
    const contract = normalContract();
    const fill = buildNormalPlanFallbackFill(contract);
    const draft = bindNormalPlanProviderFill({ ...contract, fill });

    expect(draft.kind).toBe("test");
    expect(draft.deadline).toBe(contract.request.deadline);
    expect(draft.sessions).toHaveLength(contract.composition.envelopes.length);
    contract.composition.envelopes.forEach((envelope, index) => {
      const session = draft.sessions[index]!;
      expect(session).toMatchObject({
        ...NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD,
        scheduledFor: envelope.scheduledFor,
        estimatedMinutes: envelope.timing.activeMinutes,
        learningMode: envelope.learningMode,
        topicIds: envelope.topicIds,
      });
      expect(session.contentTargets).toEqual(envelope.topicIds.map((topicId) => (
        contract.request.knowledgeMap!.topics.find((topic) => topic.id === topicId)!.title
      )));
      expect(session.contentTargets.length).toBeLessThanOrEqual(
        envelope.contentBudget.maximumContentTargets,
      );
      expect(session.completionEvidence).toHaveLength(
        envelope.topicIds.length,
      );
      expect(session.completionEvidence.length).toBeLessThanOrEqual(
        envelope.contentBudget.maximumCompletionChecks,
      );
      session.completionEvidence.forEach((evidence, targetIndex) => {
        const topicId = envelope.topicIds[targetIndex]!;
        const topicTitle = contract.request.knowledgeMap!.topics.find((topic) => (
          topic.id === topicId
        ))!.title;
        expect(evidence).toContain(topicTitle);
      });
    });
  });

  it("uses an unrouteable placeholder and requires deterministic routing before review", () => {
    const contract = normalContract();
    const draft = bindNormalPlanProviderFill({
      ...contract,
      fill: buildNormalPlanFallbackFill(contract),
    });

    expect(hasNormalPlanInternalMethodScaffold(draft)).toBe(true);
    expectFillError(() => assertNormalPlanMethodScaffoldReplaced(draft), "invalid_composition");

    const routed = structuredClone(draft);
    routed.sessions.forEach((session) => {
      session.method = "Retrieval practice";
      session.methodReason = "The fixed target state makes a closed-note attempt appropriate here.";
    });
    expect(hasNormalPlanInternalMethodScaffold(routed)).toBe(false);
    expect(() => assertNormalPlanMethodScaffoldReplaced(routed)).not.toThrow();
  });

  it("lets display prose vary while operational objectives and evidence stay code-owned", () => {
    const contract = normalContract();
    const fallback = buildNormalPlanFallbackFill(contract);
    const provider = structuredClone(fallback);
    provider.plan.title = "A provider-written calculus pathway";
    provider.plan.topic = "Using the product rule accurately";
    provider.plan.rationale = "This copy explains why the fixed progression first builds the rule and then checks whether it can be used independently.";
    Object.values(provider.sessions).forEach((session, index) => {
      session.title = `Provider session ${index + 1}`;
      session.objective = `Use the assigned calculus targets in fixed session ${index + 1} and produce the required evidence.`;
      Object.keys(session.evidence).forEach((slotId) => {
        session.evidence[slotId] = "Solve one representative product-rule problem and explain the deciding step";
      });
    });

    const fallbackDraft = bindNormalPlanProviderFill({ ...contract, fill: fallback });
    const providerDraft = bindNormalPlanProviderFill({ ...contract, fill: provider });

    expect(structuralProjection(providerDraft)).toEqual(structuralProjection(fallbackDraft));
    expect(providerDraft.title).not.toBe(fallbackDraft.title);
    expect(providerDraft.sessions.map((session) => session.objective)).toEqual(
      fallbackDraft.sessions.map((session) => session.objective),
    );
    expect(providerDraft.sessions.map((session) => session.completionEvidence)).toEqual(
      fallbackDraft.sessions.map((session) => session.completionEvidence),
    );
  });

  it("does not let one valid target anchor smuggle a foreign operational outcome", () => {
    const contract = normalContract();
    const fallback = buildNormalPlanFallbackFill(contract);
    const provider = structuredClone(fallback);
    for (const session of Object.values(provider.sessions)) {
      session.objective = "Explain a calculus poem about cats and compose three rhyming lines.";
      Object.keys(session.evidence).forEach((slotId, index) => {
        session.evidence[slotId] = index === 0
          ? "Draft a calculus poem about cats and explain why the rhyme works."
          : "Write a calculus cat limerick and label its rhyme scheme.";
      });
    }

    const draft = bindNormalPlanProviderFill({ ...contract, fill: provider });
    const fallbackDraft = bindNormalPlanProviderFill({ ...contract, fill: fallback });

    expect(draft.sessions.map((session) => session.objective)).toEqual(
      fallbackDraft.sessions.map((session) => session.objective),
    );
    expect(draft.sessions.map((session) => session.completionEvidence)).toEqual(
      fallbackDraft.sessions.map((session) => session.completionEvidence),
    );
    expect(JSON.stringify(draft.sessions)).not.toMatch(/\b(?:poem|cat|cats|rhyme|limerick)\b/iu);
  });

  it("replaces provider prose that claims a method, duration, mode, or foreign target", () => {
    const contract = normalContract();
    const fallback = buildNormalPlanFallbackFill(contract);
    const provider = structuredClone(fallback);
    provider.plan.title = "A 90 minute Feynman plan for React";
    provider.plan.topic = "Switch to programming mode and learn React instead";
    provider.plan.rationale = "Use blurting for 90 minutes on Tuesday regardless of the accepted calculus map.";
    for (const session of Object.values(provider.sessions)) {
      session.title = "Use the Feynman technique for React";
      session.objective = "Switch to study mode and implement React for 90 minutes instead of the fixed calculus target.";
      Object.keys(session.evidence).forEach((slotId) => {
        session.evidence[slotId] = "Implement React for 90 minutes and explain the finished program";
      });
    }

    const draft = bindNormalPlanProviderFill({ ...contract, fill: provider });
    const serialized = JSON.stringify(draft);

    expect(draft.title).toBe(fallback.plan.title);
    expect(draft.topic).toBe(fallback.plan.topic);
    expect(draft.rationale).toBe(fallback.plan.rationale);
    expect(draft.sessions[0]!.objective).toBe(
      fallback.sessions[contract.composition.envelopes[0]!.envelopeId]!.objective,
    );
    expect(serialized).not.toMatch(/feynman|blurting|90 minute|react|programming mode|study mode/iu);
  });

  it.each(["Active Recall", "Retrieval practice"])(
    "keeps the current and legacy %s labels out of provider-owned session titles",
    (methodName) => {
      const contract = normalContract();
      const fallback = buildNormalPlanFallbackFill(contract);
      const provider = structuredClone(fallback);
      const firstEnvelope = contract.composition.envelopes[0]!;
      provider.sessions[firstEnvelope.envelopeId]!.title = `${methodName} for derivatives`;

      const draft = bindNormalPlanProviderFill({ ...contract, fill: provider });

      expect(draft.sessions[0]!.title).toBe(
        fallback.sessions[firstEnvelope.envelopeId]!.title,
      );
    },
  );

  it("keeps the deterministic fallback usable when optional practice repeats a target group", () => {
    const request = planRequest({
      scope: scope({
        minimumSessions: 2,
        recommendedSessions: 3,
        maximumSessions: 3,
      }),
      availability: [{ day: "Monday", window: "Morning", minutes: 120 }],
    });
    const composition = compose(request);
    const fill = buildNormalPlanFallbackFill({ request, composition });
    const draft = bindNormalPlanProviderFill({ request, composition, fill });

    expect(composition.envelopes.map((envelope) => envelope.kind)).toContain(
      "additional_practice",
    );
    expect(new Set(draft.sessions.map((session) => session.objective))).toHaveLength(
      draft.sessions.length,
    );
    expect(inspectGeneratedPlanQuality(draft, request)).toBeNull();
  });

  it("replaces a repeated provider objective with the slot-specific fallback", () => {
    const contract = normalContract();
    const fallback = buildNormalPlanFallbackFill(contract);
    const provider = structuredClone(fallback);
    const repeated = "Retrieve the assigned targets independently and correct each exposed gap before finishing.";
    Object.values(provider.sessions).forEach((session) => {
      session.objective = repeated;
    });

    const draft = bindNormalPlanProviderFill({ ...contract, fill: provider });

    expect(draft.sessions[0]!.objective).toBe(
      fallback.sessions[contract.composition.envelopes[0]!.envelopeId]!.objective,
    );
    expect(draft.sessions[1]!.objective).toBe(
      fallback.sessions[contract.composition.envelopes[1]!.envelopeId]!.objective,
    );
  });

  it("replaces duplicate evidence wording with unique slot-specific checks", () => {
    const contract = normalContract();
    const fallback = buildNormalPlanFallbackFill(contract);
    const provider = structuredClone(fallback);
    const envelope = contract.composition.envelopes.find((candidate) => (
      normalPlanEvidenceSlotIds(candidate).length > 1
    ));
    expect(envelope).toBeDefined();
    const envelopeId = envelope!.envelopeId;
    Object.keys(provider.sessions[envelopeId]!.evidence).forEach((slotId) => {
      provider.sessions[envelopeId]!.evidence[slotId] =
        "Solve one representative problem and explain the deciding step";
    });

    const draft = bindNormalPlanProviderFill({ ...contract, fill: provider });
    const sessionIndex = contract.composition.envelopes.findIndex((candidate) => (
      candidate.envelopeId === envelopeId
    ));

    expect(new Set(draft.sessions[sessionIndex]!.completionEvidence)).toHaveLength(
      draft.sessions[sessionIndex]!.completionEvidence.length,
    );
  });

  it("normalizes raw formatting and replaces unsupported or passive prose with safe fallback copy", () => {
    const contract = normalContract();
    const fallback = buildNormalPlanFallbackFill(contract);
    const provider = structuredClone(fallback);
    const envelopeId = contract.composition.envelopes[0]!.envelopeId;
    const evidenceId = normalPlanEvidenceSlotIds(contract.composition.envelopes[0]!)[0]!;
    provider.plan.title = "**Derivative – pathway**";
    provider.plan.rationale = "Because you have ADHD, this fixed learning style is the only sequence that can work for you.";
    provider.sessions[envelopeId]!.objective = "You are a visual learner, so only diagrams can build an accurate product-rule model.";
    provider.sessions[envelopeId]!.evidence[evidenceId] = "Read the source carefully before moving to the next step";

    const draft = bindNormalPlanProviderFill({ ...contract, fill: provider });

    expect(draft.title).toBe("Derivative - pathway");
    expect(draft.rationale).toBe(fallback.plan.rationale);
    expect(draft.sessions[0]!.objective).toBe(fallback.sessions[envelopeId]!.objective);
    expect(draft.sessions[0]!.completionEvidence[0]).toBe(
      fallback.sessions[envelopeId]!.evidence[evidenceId],
    );
    expect(JSON.stringify(draft)).not.toMatch(/learning style|visual learner|ADHD|\*\*|[–—]/iu);
  });

  it("sanitizes unsafe map-authored target and deferral copy before it becomes learner-facing", () => {
    const base = planRequest({
      topicCount: 3,
      scope: scope({
        minimumSessions: 1,
        recommendedSessions: 1,
        maximumSessions: 1,
        minimumTeachingSessions: 0,
      }),
    });
    const topics = structuredClone(base.knowledgeMap!.topics);
    topics[0]!.title = "**Visual learner - model**";
    topics[0]!.description = "Because you have ADHD, this target should use only diagrams.";
    topics[2]!.deferred = {
      reason: "Because you are a visual learner - this target must be delayed.",
    };
    const request = PlanGenerationRequestSchema.parse({
      ...base,
      knowledgeMap: { ...base.knowledgeMap, topics },
    });
    const composition = compose(request);
    const draft = bindNormalPlanProviderFill({
      request,
      composition,
      fill: buildNormalPlanFallbackFill({ request, composition }),
    });
    const learnerFacing = JSON.stringify({
      contentTargets: draft.sessions.flatMap((session) => session.contentTargets),
      deferredTopics: draft.deferredTopics,
    });

    expect(learnerFacing).not.toMatch(/visual learner|ADHD|\*\*|[–—]/iu);
    expect(draft.sessions.flatMap((session) => session.contentTargets)).toContain(
      "Accepted learning target 1",
    );
  });

  it("preserves explicit partial-composition deferrals without asking the provider to report them", () => {
    const request = planRequest({
      learningIntent: "study",
      startingContext: "I have already learned this material and need focused review.",
      goal: "Review the mapped biology concepts and retrieve them without notes for an exam.",
      topicCount: 7,
      scope: scope({
        minimumSessions: 1,
        recommendedSessions: 1,
        maximumSessions: 1,
        minimumTeachingSessions: 0,
      }),
      availability: [{ day: "Monday", window: "Morning", minutes: 25 }],
    });
    const composition = compose(request);
    const contract = { request, composition };
    const fallback = buildNormalPlanFallbackFill(contract);
    const draft = bindNormalPlanProviderFill({ ...contract, fill: fallback });

    expect(composition.status).toBe("partial");
    expect(composition.deferrals.length).toBeGreaterThan(0);
    expect(draft.deferredTopics).toEqual(composition.deferrals.map((deferral) => ({
      topicId: deferral.topicId,
      reason: deferral.reason,
    })));
    expect(new Set([
      ...draft.sessions.flatMap((session) => session.topicIds),
      ...draft.deferredTopics.map((deferral) => deferral.topicId),
    ])).toEqual(new Set(request.knowledgeMap!.topics.map((topic) => topic.id)));
  });

  it("is deterministic, deeply frozen, and does not mutate request, composition, or fill", () => {
    const contract = normalContract();
    const contractSnapshot = structuredClone(contract);
    const fallback = buildNormalPlanFallbackFill(contract);
    const fillSnapshot = structuredClone(fallback);
    const first = bindNormalPlanProviderFill({ ...contract, fill: fallback });
    const second = bindNormalPlanProviderFill({ ...contract, fill: fallback });

    expect(first).toEqual(second);
    expect(contract).toEqual(contractSnapshot);
    expect(fallback).toEqual(fillSnapshot);
    expect(Object.isFrozen(fallback)).toBe(true);
    expect(Object.isFrozen(fallback.sessions)).toBe(true);
    expect(Object.isFrozen(Object.values(fallback.sessions)[0]!.evidence)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sessions)).toBe(true);
    expect(Object.isFrozen(first.sessions[0]!.topicIds)).toBe(true);
    expect(Reflect.set(first.sessions[0]!, "estimatedMinutes", 180)).toBe(false);
  });

  it("derives plan kind deterministically without a provider field", () => {
    expect(resolveNormalPlanKind(planRequest({ goal: "Prepare for a calculus final exam on derivatives." }))).toBe("test");
    expect(resolveNormalPlanKind(planRequest({ goal: "Read a history book chapter and explain its argument." }))).toBe("book");
    expect(resolveNormalPlanKind(planRequest({ goal: "Build the programming skill needed to write a Python function." }))).toBe("skill");
    expect(resolveNormalPlanKind(planRequest({ goal: "Complete an essay assignment about historical causation." }))).toBe("topic");
    expect(resolveNormalPlanKind(planRequest({
      goal: "Prepare for an exam covering the full calculus course.",
      scope: scope({ band: "broad_course" }),
    }))).toBe("course");
  });

  it("rejects Study Now at every request-aware entry point", () => {
    const contract = normalContract();
    const studyNow = PlanGenerationRequestSchema.parse({
      ...contract.request,
      intent: "study_now",
      deadline: null,
      availability: [{ day: "Today", window: "Now", minutes: 25 }],
    });

    expectFillError(() => buildNormalPlanProviderFillSchema({
      request: studyNow,
      composition: contract.composition,
    }), "not_normal_plan");
    expectFillError(() => buildNormalPlanFallbackFill({
      request: studyNow,
      composition: contract.composition,
    }), "not_normal_plan");
    expectFillError(() => bindNormalPlanProviderFill({
      request: studyNow,
      composition: contract.composition,
      fill: buildNormalPlanFallbackFill(contract),
    }), "not_normal_plan");
  });
});

function normalContract() {
  const request = planRequest();
  return { request, composition: compose(request) };
}

function compose(request: PlanGenerationRequest): NormalPlanEnvelopeComposition {
  return composeNormalPlanEnvelopes({
    request,
    learningIntentRecommendation: {
      intent: request.learningIntent,
      basis: request.learningIntent === "learn"
        ? "The learner said this foundation is new."
        : "The learner said this material has already been encountered.",
    },
    durationContext: durationContext(),
    now: NOW,
    searchDays: 1,
  });
}

function planRequest({
  goal = "Learn the product rule and explain how derivatives of products work for a calculus test.",
  learningIntent = "learn",
  startingContext = "This material is new and needs to be taught from the beginning.",
  topicCount = 2,
  scope: currentScope = scope(),
  availability = [{ day: "Monday", window: "Morning", minutes: 60 }],
}: {
  goal?: string;
  learningIntent?: "learn" | "study";
  startingContext?: string;
  topicCount?: number;
  scope?: PlanKnowledgeMap["scopeJudgment"];
  availability?: PlanGenerationRequest["availability"];
} = {}) {
  const topics = Array.from({ length: topicCount }, (_, index) => ({
    id: IDS[index]!,
    title: index === 0 ? "Product rule model" : `Product rule application ${index + 1}`,
    description: index === 0
      ? "Explain why differentiating a product requires both derivative terms."
      : `Apply the mapped product-rule target ${index + 1} accurately and independently.`,
    subtopics: [],
    prerequisiteTopicIds: index === 0 ? [] : [IDS[index - 1]!],
    status: "not_started" as const,
    initialEvidence: null,
    sourceReferences: [],
    origin: "ai_generated" as const,
    deferred: null,
  }));
  return PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent,
    goal,
    startingContext,
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: "2026-08-20T23:59:00.000Z",
    timeZone: "UTC",
    diagnosticResponses: [],
    availability,
    profileSummary: "Use concise explanations, bounded tasks, and one independent check after support.",
    knowledgeMap: {
      version: 1,
      scopeJudgment: currentScope,
      topics,
      placementCheck: {
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
    explanation: "A bounded calculus skill needs initial instruction followed by an independent evidence check.",
    ...overrides,
  };
}

function durationContext(): NormalPlanDurationContext {
  return {
    profileVersion: "authorized_profile_snapshot:provider-fill-test-v1",
    profile: {
      sustainableMinutes: null,
      startingFrictionRisk: null,
      fatigueRisk: null,
      preferredWindow: null,
      evidenceRefs: {
        sustainableMinutes: [],
        startingFrictionRisk: [],
        fatigueRisk: [],
        preferredWindow: [],
      },
    },
    recentOutcomes: [],
  };
}

function structuralProjection(draft: GeneratedPlanDraft) {
  return {
    kind: draft.kind,
    deadline: draft.deadline,
    deferredTopics: draft.deferredTopics,
    sessions: draft.sessions.map((session) => ({
      method: session.method,
      methodReason: session.methodReason,
      scheduledFor: session.scheduledFor,
      estimatedMinutes: session.estimatedMinutes,
      amountLabel: session.amountLabel,
      learningMode: session.learningMode,
      topicIds: session.topicIds,
      contentTargets: session.contentTargets,
    })),
  };
}

function expectFillError(callback: () => unknown, code: string) {
  try {
    callback();
    throw new Error("Expected the provider-fill boundary to reject the fixture.");
  } catch (error) {
    expect(error).toBeInstanceOf(NormalPlanProviderFillError);
    expect((error as NormalPlanProviderFillError).code).toBe(code);
  }
}
