import { describe, expect, it } from "vitest";
import type {
  LearningPlan,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import {
  defaultPersonalizationState,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";
import { adaptLegacySessionToStudyRoute } from "@/lib/study-route/adapters";
import { recommendNormalStudyDuration } from "@/lib/study-route/duration-recommendation";
import {
  DURATION_PROFILE_SIGNAL_IDS,
  buildAuthorizedNormalDurationOutcomes,
  buildAuthorizedNormalDurationProfile,
} from "@/lib/study-route/duration-signals";

const IDS = {
  plan: "11111111-1111-4111-8111-111111111111",
  learningItem: "22222222-2222-4222-8222-222222222222",
  session: "33333333-3333-4333-8333-333333333333",
  otherRoute: "44444444-4444-4444-8444-444444444444",
} as const;

describe("authorized normal-duration profile adapter", () => {
  it("uses stable onboarding IDs and paired Study Profile answers with signal-specific evidence", () => {
    const state = {
      ...defaultPersonalizationState(),
      studyProfile: {
        ...defaultPersonalizationState().studyProfile,
        answers: {
          q1: "d" as const,
          q2: "c" as const,
          q11: "c" as const,
          q12: "d" as const,
        },
      },
    };
    const answers = writePersonalizationStateToAnswers([
      "",
      "",
      "minutes_30_45",
      "",
      "",
      "",
      "evening",
    ], state);

    expect(buildAuthorizedNormalDurationProfile(answers)).toEqual({
      sustainableMinutes: 45,
      startingFrictionRisk: "high",
      fatigueRisk: "high",
      preferredWindow: "evening",
      evidenceRefs: {
        sustainableMinutes: ["profile:onboarding:2"],
        startingFrictionRisk: [
          "profile:study-profile:q1",
          "profile:study-profile:q2",
        ],
        fatigueRisk: [
          "profile:study-profile:q11",
          "profile:study-profile:q12",
        ],
        preferredWindow: ["profile:onboarding:6"],
      },
    });
  });

  it("falls back to bounded onboarding friction without turning unrelated answers into risk", () => {
    const high = writePersonalizationStateToAnswers([
      "overwhelmed",
      "",
      "",
      "",
      "",
      "varies",
    ], defaultPersonalizationState());
    const low = writePersonalizationStateToAnswers([
      "task_dependent",
      "",
      "",
      "",
      "",
      "on_time",
    ], defaultPersonalizationState());
    const unknown = writePersonalizationStateToAnswers([
      "distracted",
      "",
      "",
      "",
      "",
      "varies",
    ], defaultPersonalizationState());

    expect(buildAuthorizedNormalDurationProfile(high)).toMatchObject({
      startingFrictionRisk: "high",
      evidenceRefs: { startingFrictionRisk: ["profile:onboarding:0"] },
    });
    expect(buildAuthorizedNormalDurationProfile(low)).toMatchObject({
      startingFrictionRisk: "low",
      evidenceRefs: { startingFrictionRisk: ["profile:onboarding:5"] },
    });
    expect(buildAuthorizedNormalDurationProfile(unknown)).toMatchObject({
      startingFrictionRisk: null,
      evidenceRefs: { startingFrictionRisk: [] },
    });
  });

  it("honors self-report, timing, pause, correction, and do-not-infer controls", () => {
    const base = defaultPersonalizationState();
    const updatedAt = "2026-08-23T10:00:00.000Z";
    const answers = writePersonalizationStateToAnswers([
      "struggle_to_start",
      "",
      "minutes_45_60",
      "",
      "",
      "often_delay",
      "evening",
    ], {
      ...base,
      pausedSignalIds: [DURATION_PROFILE_SIGNAL_IDS.startingFrictionRisk],
      corrections: [
        {
          signalId: DURATION_PROFILE_SIGNAL_IDS.sustainableMinutes,
          correctedValue: "25 minutes",
          note: null,
          doNotInfer: false,
          updatedAt,
        },
        {
          signalId: DURATION_PROFILE_SIGNAL_IDS.fatigueRisk,
          correctedValue: null,
          note: "Do not use this for duration.",
          doNotInfer: true,
          updatedAt,
        },
        {
          signalId: DURATION_PROFILE_SIGNAL_IDS.preferredWindow,
          correctedValue: "Morning",
          note: null,
          doNotInfer: false,
          updatedAt,
        },
      ],
    });
    const controlled = buildAuthorizedNormalDurationProfile(answers);

    expect(controlled).toMatchObject({
      sustainableMinutes: 25,
      startingFrictionRisk: null,
      fatigueRisk: null,
      preferredWindow: "morning",
    });
    expect(controlled.evidenceRefs.sustainableMinutes[0])
      .toContain("profile:correction:sustainable_duration:");
    expect(controlled.evidenceRefs.preferredWindow[0])
      .toContain("profile:correction:energy_window:");

    const timingOff = writePersonalizationStateToAnswers(answers, {
      ...base,
      controls: { ...base.controls, timing: false },
    });
    expect(buildAuthorizedNormalDurationProfile(timingOff)).toMatchObject({
      sustainableMinutes: 60,
      preferredWindow: null,
      evidenceRefs: { preferredWindow: [] },
    });

    const selfReportOff = writePersonalizationStateToAnswers(answers, {
      ...base,
      controls: { ...base.controls, selfReport: false },
    });
    expect(buildAuthorizedNormalDurationProfile(selfReportOff)).toEqual({
      sustainableMinutes: null,
      startingFrictionRisk: null,
      fatigueRisk: null,
      preferredWindow: "evening",
      evidenceRefs: {
        sustainableMinutes: [],
        startingFrictionRisk: [],
        fatigueRisk: [],
        preferredWindow: ["profile:onboarding:6"],
      },
    });

    const bothOff = writePersonalizationStateToAnswers(answers, {
      ...base,
      controls: { ...base.controls, selfReport: false, timing: false },
    });
    expect(buildAuthorizedNormalDurationProfile(bothOff)).toEqual({
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
    });
  });

  it("fails closed for unsupported correction prose and excluded profile evidence", () => {
    const base = defaultPersonalizationState();
    const unsupported = writePersonalizationStateToAnswers([
      "",
      "",
      "minutes_45_60",
    ], {
      ...base,
      corrections: [{
        signalId: DURATION_PROFILE_SIGNAL_IDS.sustainableMinutes,
        correctedValue: "Whatever feels biologically optimal",
        note: null,
        doNotInfer: false,
        updatedAt: "2026-08-23T10:00:00.000Z",
      }],
    });
    const excluded = writePersonalizationStateToAnswers([
      "",
      "",
      "minutes_20_30",
    ], {
      ...base,
      excludedEvidenceRefs: ["profile:onboarding:2"],
    });

    expect(buildAuthorizedNormalDurationProfile(unsupported)).toMatchObject({
      sustainableMinutes: null,
      evidenceRefs: { sustainableMinutes: [] },
    });
    expect(buildAuthorizedNormalDurationProfile(excluded)).toMatchObject({
      sustainableMinutes: null,
      evidenceRefs: { sustainableMinutes: [] },
    });
  });

  it("is deterministic, non-mutating, and deeply immutable", () => {
    const answers = writePersonalizationStateToAnswers([
      "",
      "",
      "20 to 30 minutes",
      "",
      "",
      "",
      "Late night",
    ], defaultPersonalizationState());
    const before = structuredClone(answers);
    const first = buildAuthorizedNormalDurationProfile(answers);
    const second = buildAuthorizedNormalDurationProfile(answers);

    expect(first).toEqual(second);
    expect(answers).toEqual(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.evidenceRefs)).toBe(true);
    expect(Object.isFrozen(first.evidenceRefs.sustainableMinutes)).toBe(true);
  });
});

describe("authorized normal-duration outcome adapter", () => {
  it("normalizes exact committed route evidence without inferring task family or mode", () => {
    const plan = routedPlan();
    const completion = completionFor(plan, {
      id: "completion-older",
      completedAt: "2026-08-23T10:25:00.000Z",
    });
    const interruption = interruptionFor(plan, {
      id: "interruption-newer",
      startedAt: "2026-08-23T11:00:00.000Z",
      interruptedAt: "2026-08-23T11:08:00.000Z",
    });
    const input = {
      answers: writePersonalizationStateToAnswers([], defaultPersonalizationState()),
      plans: [plan],
      completions: [completion],
      interruptions: [interruption],
    };
    const before = structuredClone(input);
    const outcomes = buildAuthorizedNormalDurationOutcomes(input);
    const route = plan.sessions[0]!.studyRoute!;

    expect(outcomes).toEqual([
      {
        kind: "interruption",
        sessionClass: "normal",
        taskFamily: route.target.taskFamily,
        mode: route.approach.mode,
        occurredAt: interruption.interruptedAt,
        routeRevisionId: route.identity.routeRevisionId,
        plannedMinutes: 25,
        actualMinutes: 8,
        completedSteps: 1,
        totalSteps: 4,
        evidenceRef: "interruption-newer",
      },
      {
        kind: "completion",
        sessionClass: "normal",
        taskFamily: route.target.taskFamily,
        mode: route.approach.mode,
        occurredAt: completion.completedAt,
        routeRevisionId: route.identity.routeRevisionId,
        plannedMinutes: 25,
        actualMinutes: 25,
        correctAnswers: 4,
        totalAnswers: 5,
        feedback: "about_right",
        evidenceRef: "completion-older",
      },
    ]);
    expect(input).toEqual(before);
    expect(Object.isFrozen(outcomes)).toBe(true);
    expect(Object.isFrozen(outcomes[0])).toBe(true);
    expect(() => recommendNormalStudyDuration({
      context: {
        taskFamily: route.target.taskFamily,
        mode: route.approach.mode,
      },
      profile: buildAuthorizedNormalDurationProfile(input.answers),
      schedule: { window: null },
      recentOutcomes: outcomes,
    })).not.toThrow();
  });

  it("omits lightweight reviews even when they otherwise carry a committed route", () => {
    const plan = routedPlan();
    plan.sessions[0] = { ...plan.sessions[0]!, reviewType: "verify" };

    expect(buildAuthorizedNormalDurationOutcomes({
      answers: [],
      plans: [plan],
      completions: [completionFor(plan)],
      interruptions: [interruptionFor(plan)],
    })).toEqual([]);

    const durationMarkedReview = routedPlan();
    durationMarkedReview.sessions[0]!.studyRoute = {
      ...durationMarkedReview.sessions[0]!.studyRoute!,
      timing: {
        ...durationMarkedReview.sessions[0]!.studyRoute!.timing,
        durationSource: "scheduled_review",
      },
    };
    expect(buildAuthorizedNormalDurationOutcomes({
      answers: [],
      plans: [durationMarkedReview],
      completions: [completionFor(durationMarkedReview)],
      interruptions: [],
    })).toEqual([]);

    const partialReviewMetadata = routedPlan();
    partialReviewMetadata.sessions[0] = {
      ...partialReviewMetadata.sessions[0]!,
      reviewConcept: "Membrane transport",
    };
    expect(buildAuthorizedNormalDurationOutcomes({
      answers: [],
      plans: [partialReviewMetadata],
      completions: [completionFor(partialReviewMetadata)],
      interruptions: [],
    })).toEqual([]);
  });

  it("honors the behavior control, excluded evidence, and duplicate IDs", () => {
    const plan = routedPlan();
    const completion = completionFor(plan, { id: "completion-excluded" });
    const interruption = interruptionFor(plan, { id: "duplicate-evidence" });
    const excludedState = {
      ...defaultPersonalizationState(),
      excludedEvidenceRefs: [completion.id],
    };

    expect(buildAuthorizedNormalDurationOutcomes({
      answers: writePersonalizationStateToAnswers([], excludedState),
      plans: [plan],
      completions: [completion],
      interruptions: [],
    })).toEqual([]);

    const routeExcludedState = {
      ...defaultPersonalizationState(),
      excludedEvidenceRefs: [
        `route-revision:${plan.sessions[0]!.studyRoute!.identity.routeRevisionId}`,
      ],
    };
    expect(buildAuthorizedNormalDurationOutcomes({
      answers: writePersonalizationStateToAnswers([], routeExcludedState),
      plans: [plan],
      completions: [completionFor(plan)],
      interruptions: [],
    })).toEqual([]);
    expect(buildAuthorizedNormalDurationOutcomes({
      answers: [],
      plans: [plan],
      completions: [{ ...completionFor(plan), id: interruption.id }],
      interruptions: [interruption],
    })).toEqual([]);

    const behaviorOff = {
      ...defaultPersonalizationState(),
      controls: { ...defaultPersonalizationState().controls, behavior: false },
    };
    expect(buildAuthorizedNormalDurationOutcomes({
      answers: writePersonalizationStateToAnswers([], behaviorOff),
      plans: [plan],
      completions: [completionFor(plan)],
      interruptions: [interruptionFor(plan)],
    })).toEqual([]);
  });

  it("fails closed on route-free, provisional, identity-mismatched, or duplicated session authority", () => {
    const routeFree = basePlan();
    expect(outcomesFor(routeFree, completionFor(routedPlan()))).toEqual([]);

    const provisional = routedPlan();
    const provisionalRoute = structuredClone(provisional.sessions[0]!.studyRoute!);
    provisionalRoute.identity.lifecycleStatus = "provisional";
    delete (provisionalRoute.identity as Partial<typeof provisionalRoute.identity>).committedAt;
    provisional.sessions[0]!.studyRoute = provisionalRoute;
    expect(outcomesFor(provisional, completionFor(provisional))).toEqual([]);

    const mismatched = routedPlan();
    mismatched.sessions[0]!.studyRoute = {
      ...mismatched.sessions[0]!.studyRoute!,
      identity: {
        ...mismatched.sessions[0]!.studyRoute!.identity,
        planId: "55555555-5555-4555-8555-555555555555",
      },
    };
    expect(outcomesFor(mismatched, completionFor(mismatched))).toEqual([]);

    const duplicated = routedPlan();
    duplicated.sessions.push(structuredClone(duplicated.sessions[0]!));
    expect(outcomesFor(duplicated, completionFor(duplicated))).toEqual([]);
  });

  it("fails closed on route, planned-duration, resource, timestamp, and counter mismatches", () => {
    const routeMismatch = routedPlan();
    expect(outcomesFor(routeMismatch, completionFor(routeMismatch, {
      routeRevisionId: IDS.otherRoute,
    }))).toEqual([]);

    const eventDurationMismatch = routedPlan();
    expect(outcomesFor(eventDurationMismatch, completionFor(eventDurationMismatch, {
      plannedMinutes: 15,
    }))).toEqual([]);

    const sessionDurationMismatch = routedPlan();
    sessionDurationMismatch.sessions[0]!.estimatedMinutes = 15;
    expect(outcomesFor(sessionDurationMismatch, completionFor(sessionDurationMismatch)))
      .toEqual([]);

    const resourceMismatch = routedPlan();
    resourceMismatch.sessions[0]!.resource = {
      routeRevisionId: IDS.otherRoute,
      rationale: "This deliberately belongs to another route revision.",
      activities: [],
      generatedAt: "2026-08-23T09:30:00.000Z",
      origin: "built_in",
    };
    expect(outcomesFor(resourceMismatch, completionFor(resourceMismatch))).toEqual([]);

    const malformed = routedPlan();
    expect(outcomesFor(malformed, completionFor(malformed, {
      completedAt: "not-a-timestamp",
    }))).toEqual([]);
    expect(outcomesFor(malformed, completionFor(malformed, {
      correctAnswers: 6,
      totalAnswers: 5,
    }))).toEqual([]);
    expect(buildAuthorizedNormalDurationOutcomes({
      answers: [],
      plans: [malformed],
      completions: [],
      interruptions: [interruptionFor(malformed, {
        completedSteps: 5,
        totalSteps: 4,
      })],
    })).toEqual([]);
  });

  it("keeps an unscored completion as non-raising timing evidence without inventing answers", () => {
    const plan = routedPlan();
    const outcomes = buildAuthorizedNormalDurationOutcomes({
      answers: [],
      plans: [plan],
      completions: [completionFor(plan, { correctAnswers: 0, totalAnswers: 0 })],
      interruptions: [],
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).not.toHaveProperty("correctAnswers");
    expect(outcomes[0]).not.toHaveProperty("totalAnswers");
  });

  it("bounds the normalized history to the latest one hundred outcomes", () => {
    const plan = routedPlan();
    const completions = Array.from({ length: 101 }, (_, index) => completionFor(plan, {
      id: `completion-${String(index).padStart(3, "0")}`,
      completedAt: new Date(Date.parse("2026-08-23T10:25:00.000Z") + index * 60_000)
        .toISOString(),
    }));
    const outcomes = buildAuthorizedNormalDurationOutcomes({
      answers: [],
      plans: [plan],
      completions,
      interruptions: [],
    });

    expect(outcomes).toHaveLength(100);
    expect(outcomes[0]?.evidenceRef).toBe("completion-100");
    expect(outcomes.at(-1)?.evidenceRef).toBe("completion-001");
  });
});

function basePlan(): LearningPlan {
  return {
    id: IDS.plan,
    learningItemId: IDS.learningItem,
    title: "Cell biology foundations",
    topic: "How cell membranes regulate transport",
    kind: "topic",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Build an accurate model before independent explanation.",
    createdAt: "2026-08-23T09:00:00.000Z",
    materials: [],
    sessions: [{
      id: IDS.session,
      sequence: 1,
      title: "Explain membrane transport",
      objective: "Explain how concentration gradients affect transport across a membrane.",
      method: "Self-explanation",
      methodReason: "Explaining the causal relationship exposes gaps in the learner's model.",
      scheduledFor: "2026-08-23T10:00:00.000Z",
      estimatedMinutes: 25,
      amountLabel: "One concept · about 25 min",
      learningMode: "learn",
      topicIds: ["66666666-6666-4666-8666-666666666666"],
      contentTargets: ["Explain concentration gradients"],
      completionEvidence: ["Explain the relationship without support."],
      status: "ready",
    }],
  };
}

function routedPlan(): LearningPlan {
  const plan = basePlan();
  const session = plan.sessions[0]!;
  const route = adaptLegacySessionToStudyRoute({ plan, session }).route;
  if (!route) throw new Error("The test fixture must produce a committed route.");
  plan.sessions[0] = { ...session, studyRoute: route };
  return plan;
}

function completionFor(
  plan: LearningPlan,
  overrides: Partial<SessionCompletion> = {},
): SessionCompletion {
  const session = plan.sessions[0]!;
  return {
    id: "completion-default",
    planId: plan.id,
    planSessionId: session.id,
    routeRevisionId: session.studyRoute?.identity.routeRevisionId,
    startedAt: "2026-08-23T10:00:00.000Z",
    completedAt: "2026-08-23T10:25:00.000Z",
    plannedMinutes: session.studyRoute?.timing.activeMinutes ?? session.estimatedMinutes,
    actualMinutes: 25,
    correctAnswers: 4,
    totalAnswers: 5,
    feedback: "about_right",
    observedGap: "",
    conceptEvidence: [],
    confidenceEvidence: [],
    ...overrides,
  };
}

function interruptionFor(
  plan: LearningPlan,
  overrides: Partial<SessionInterruption> = {},
): SessionInterruption {
  const session = plan.sessions[0]!;
  return {
    id: "interruption-default",
    planId: plan.id,
    planSessionId: session.id,
    routeRevisionId: session.studyRoute?.identity.routeRevisionId,
    startedAt: "2026-08-23T10:00:00.000Z",
    interruptedAt: "2026-08-23T10:08:00.000Z",
    plannedMinutes: session.studyRoute?.timing.activeMinutes ?? session.estimatedMinutes,
    actualMinutes: 8,
    completedSteps: 1,
    totalSteps: 4,
    ...overrides,
  };
}

function outcomesFor(plan: LearningPlan, completion: SessionCompletion) {
  return buildAuthorizedNormalDurationOutcomes({
    answers: [],
    plans: [plan],
    completions: [completion],
    interruptions: [],
  });
}
