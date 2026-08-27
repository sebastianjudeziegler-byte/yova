import { describe, expect, it } from "vitest";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import {
  NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
  NormalPlanEnvelopeComposerError,
  composeNormalPlanEnvelopes,
  type NormalPlanDurationContext,
} from "@/lib/plan-generation/normal-plan-envelopes";

const NOW = new Date("2026-08-10T08:00:00.000Z");
const OBSERVED_AT = "2026-08-09T12:00:00.000Z";
const IDS = Array.from({ length: 10 }, (_, index) => (
  `10000000-1000-4000-8000-${String(index + 1).padStart(12, "0")}`
));

describe("normal plan envelope composition", () => {
  it("builds Learn coverage followed by later Practice for every new target", () => {
    const result = compose(request({
      intent: "learn",
      topics: [topic(0), topic(1)],
      scope: scope({ recommendedSessions: 2, maximumSessions: 2 }),
    }));

    expect(result).toMatchObject({
      version: NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
      status: "complete",
      profileVersion: "authorized_profile_snapshot:test-v1",
    });
    expect(result.envelopes.map((envelope) => ({
      kind: envelope.kind,
      mode: envelope.learningMode,
      topics: envelope.topicIds,
    }))).toEqual([
      { kind: "initial_coverage", mode: "learn", topics: [IDS[0], IDS[1]] },
      { kind: "required_practice", mode: "study", topics: [IDS[0], IDS[1]] },
    ]);
    expect(result.envelopes[1]!.targetModeDecisions.every((decision) => (
      decision.basisCode === "planned_later_attempt"
    ))).toBe(true);
  });

  it("keeps an explicit study plan Practice-first without inventing teaching", () => {
    const result = compose(request({
      intent: "study",
      topics: [topic(0), topic(1)],
      scope: scope({ recommendedSessions: 1, maximumSessions: 2 }),
    }));

    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0]).toMatchObject({
      kind: "initial_coverage",
      learningMode: "study",
      modeBasisCode: "independent_attempt",
    });
  });

  it("honors exact placement gaps, demonstrations, and recorded encounter status per target", () => {
    const topics = [
      topic(0, {
        initialEvidence: { source: "placement_check", outcome: "gap", observedAt: OBSERVED_AT },
      }),
      topic(1, {
        status: "evidenced",
        initialEvidence: { source: "placement_check", outcome: "demonstrated", observedAt: OBSERVED_AT },
      }),
      topic(2, { status: "taught" }),
    ];
    const result = compose(request({
      intent: "study",
      topics,
      placementCheck: {
        status: "completed",
        completedAt: OBSERVED_AT,
        gapTopicIds: [IDS[0]!],
        demonstratedTopicIds: [IDS[1]!],
      },
      scope: scope({ recommendedSessions: 4, maximumSessions: 4 }),
      availability: [{ day: "Every day", window: "Morning", minutes: 120 }],
    }));

    expect(result.envelopes.slice(0, 3).map((envelope) => ({
      mode: envelope.learningMode,
      topics: envelope.topicIds,
      basis: envelope.targetModeDecisions[0]!.basisCode,
    }))).toEqual([
      { mode: "learn", topics: [IDS[0]], basis: "placement_gap" },
      { mode: "study", topics: [IDS[1], IDS[2]], basis: "placement_demonstrated" },
      { mode: "study", topics: [IDS[0]], basis: "planned_later_attempt" },
    ]);
  });

  it("prioritizes confirmed gaps, then unobserved Learn, before independent Practice", () => {
    const demonstrated = topic(0, {
      status: "evidenced",
      initialEvidence: { source: "placement_check", outcome: "demonstrated", observedAt: OBSERVED_AT },
    });
    const unobserved = topic(1);
    const gap = topic(2, {
      initialEvidence: { source: "placement_check", outcome: "gap", observedAt: OBSERVED_AT },
    });
    const result = compose(request({
      intent: "learn",
      topics: [demonstrated, unobserved, gap],
      placementCheck: {
        status: "completed",
        completedAt: OBSERVED_AT,
        demonstratedTopicIds: [IDS[0]!],
        gapTopicIds: [IDS[2]!],
      },
      scope: scope({ recommendedSessions: 3, maximumSessions: 3 }),
      availability: [{ day: "Monday", window: "Morning", minutes: 90 }],
    }));

    expect(result.envelopes
      .filter((envelope) => envelope.kind === "initial_coverage")
      .flatMap((envelope) => envelope.topicIds))
      .toEqual([IDS[2], IDS[1], IDS[0]]);
  });

  it("uses exact prerequisite evidence to unlock a gap without spending a session on the prerequisite", () => {
    const prerequisite = topic(0, {
      status: "evidenced",
      initialEvidence: { source: "placement_check", outcome: "demonstrated", observedAt: OBSERVED_AT },
    });
    const gap = topic(1, {
      prerequisiteTopicIds: [IDS[0]!],
      initialEvidence: { source: "placement_check", outcome: "gap", observedAt: OBSERVED_AT },
    });
    const result = compose(request({
      intent: "learn",
      topics: [prerequisite, gap],
      placementCheck: {
        status: "completed",
        completedAt: OBSERVED_AT,
        demonstratedTopicIds: [IDS[0]!],
        gapTopicIds: [IDS[1]!],
      },
      scope: scope({
        recommendedSessions: 2,
        maximumSessions: 2,
        minimumTeachingSessions: 1,
      }),
    }));
    const prerequisiteRef = `placement:${IDS[0]}:${OBSERVED_AT}`;

    expect(result.envelopes.map((envelope) => ({
      kind: envelope.kind,
      topics: envelope.topicIds,
      prerequisites: envelope.prerequisiteEvidenceRefs,
    }))).toEqual([
      { kind: "initial_coverage", topics: [IDS[1]], prerequisites: [prerequisiteRef] },
      { kind: "required_practice", topics: [IDS[1]], prerequisites: [prerequisiteRef] },
    ]);
    expect(result.envelopes[0]!.modeRuleTrace).toContainEqual(expect.objectContaining({
      ruleId: "normal_plan_prerequisite_evidence_v1",
      evidenceRefs: [prerequisiteRef],
    }));
    expect(result.envelopes[1]!.targetModeDecisions[0]).toMatchObject({
      priorSessionKey: "normal-plan-envelope-001",
      evidenceRefs: ["planned-session:string:normal-plan-envelope-001"],
    });
    expect(result.deferrals).toContainEqual(expect.objectContaining({
      topicId: IDS[0],
      reasonCode: "session_cap",
    }));
  });

  it.each(["evidenced", "secure"] as const)(
    "uses recorded %s prerequisite status as explicit dependency evidence",
    (status) => {
      const prerequisite = topic(0, { status });
      const gap = topic(1, {
        prerequisiteTopicIds: [IDS[0]!],
        initialEvidence: { source: "placement_check", outcome: "gap", observedAt: OBSERVED_AT },
      });
      const result = compose(request({
        intent: "learn",
        topics: [prerequisite, gap],
        placementCheck: {
          status: "completed",
          completedAt: OBSERVED_AT,
          demonstratedTopicIds: [],
          gapTopicIds: [IDS[1]!],
        },
        scope: scope({
          recommendedSessions: 2,
          maximumSessions: 2,
          minimumTeachingSessions: 1,
        }),
      }));
      const prerequisiteRef = `knowledge-map-topic:${IDS[0]}:status:${status}`;

      expect(result.envelopes).toHaveLength(2);
      expect(result.envelopes.every((envelope) => (
        envelope.topicIds.length === 1
        && envelope.topicIds[0] === IDS[1]
        && envelope.prerequisiteEvidenceRefs[0] === prerequisiteRef
      ))).toBe(true);
      expect(result.deferrals).toContainEqual(expect.objectContaining({
        topicId: IDS[0],
        reasonCode: "session_cap",
      }));
    },
  );

  it("does not let stale evidenced status satisfy a prerequisite with a current placement gap", () => {
    const prerequisite = topic(0, {
      status: "evidenced",
      initialEvidence: { source: "placement_check", outcome: "gap", observedAt: OBSERVED_AT },
    });
    const dependent = topic(1, {
      prerequisiteTopicIds: [IDS[0]!],
    });
    const result = compose(request({
      intent: "learn",
      topics: [dependent, prerequisite],
      placementCheck: {
        status: "completed",
        completedAt: OBSERVED_AT,
        demonstratedTopicIds: [],
        gapTopicIds: [IDS[0]!],
      },
      scope: scope({
        minimumSessions: 3,
        recommendedSessions: 3,
        maximumSessions: 3,
        minimumTeachingSessions: 2,
      }),
      availability: [{ day: "Monday", window: "Morning", minutes: 90 }],
    }));

    expect(result.envelopes.map((envelope) => ({
      kind: envelope.kind,
      mode: envelope.learningMode,
      topics: envelope.topicIds,
      prerequisites: envelope.prerequisiteEvidenceRefs,
    }))).toEqual([
      { kind: "initial_coverage", mode: "learn", topics: [IDS[0]], prerequisites: [] },
      { kind: "initial_coverage", mode: "learn", topics: [IDS[1]], prerequisites: [] },
      { kind: "required_practice", mode: "study", topics: [IDS[0], IDS[1]], prerequisites: [] },
    ]);
    expect(result.envelopes[0]!.targetModeDecisions[0]).toEqual({
      topicId: IDS[0],
      learningMode: "learn",
      basisCode: "placement_gap",
      evidenceRefs: [`placement:${IDS[0]}:${OBSERVED_AT}`],
    });
    expect(result.envelopes.every((envelope) => (
      !envelope.modeRuleTrace.some((entry) => (
        entry.ruleId === "normal_plan_prerequisite_evidence_v1"
      ))
    ))).toBe(true);
  });

  it("keeps an unobserved prerequisite before its confirmed-gap dependent", () => {
    const prerequisite = topic(0);
    const gap = topic(1, {
      prerequisiteTopicIds: [IDS[0]!],
      initialEvidence: { source: "placement_check", outcome: "gap", observedAt: OBSERVED_AT },
    });
    const result = compose(request({
      intent: "learn",
      topics: [gap, prerequisite],
      placementCheck: {
        status: "completed",
        completedAt: OBSERVED_AT,
        demonstratedTopicIds: [],
        gapTopicIds: [IDS[1]!],
      },
      scope: scope({
        minimumSessions: 3,
        recommendedSessions: 3,
        maximumSessions: 3,
        minimumTeachingSessions: 2,
      }),
      availability: [{ day: "Monday", window: "Morning", minutes: 90 }],
    }));

    expect(result.envelopes.map((envelope) => ({
      kind: envelope.kind,
      topics: envelope.topicIds,
    }))).toEqual([
      { kind: "initial_coverage", topics: [IDS[0]] },
      { kind: "initial_coverage", topics: [IDS[1]] },
      { kind: "required_practice", topics: [IDS[0], IDS[1]] },
    ]);
    expect(result.envelopes.every((envelope) => (
      envelope.prerequisiteEvidenceRefs.length === 0
    ))).toBe(true);
  });

  it("packs multiple canonical sessions into one total-capacity occurrence and does not double-count overlaps", () => {
    const result = compose(request({
      intent: "study",
      topics: [
        topic(0, { title: "Understand causes", description: "Explain why the mechanism changes over time." }),
        topic(1, { title: "Write Python code", description: "Implement and debug a Python function correctly." }),
        topic(2, { title: "Vocabulary facts", description: "Memorize vocabulary definitions and exact facts." }),
        topic(3, { title: "Solve equations", description: "Calculate and solve algebra equations independently." }),
      ],
      scope: scope({ recommendedSessions: 4, maximumSessions: 4 }),
      availability: [
        { day: "Monday", window: "Morning", minutes: 60 },
        { day: "Monday", window: "Morning", minutes: 60 },
      ],
    }));

    expect(result.envelopes.map((envelope) => ({
      at: envelope.scheduledFor,
      minutes: envelope.timing.activeMinutes,
      hardMaximum: envelope.hardMaximumMinutes,
      sourceWindow: envelope.availabilityWindowIndex,
    }))).toEqual([
      { at: "2026-08-10T09:00:00.000Z", minutes: 25, hardMaximum: 60, sourceWindow: 0 },
      { at: "2026-08-10T09:25:00.000Z", minutes: 25, hardMaximum: 35, sourceWindow: 0 },
      { at: "2026-08-10T09:50:00.000Z", minutes: 10, hardMaximum: 10, sourceWindow: 0 },
    ]);
    expect(result.deferrals).toEqual([
      expect.objectContaining({ topicId: IDS[3], reasonCode: "availability_capacity" }),
    ]);
    expect(result.status).toBe("partial");
  });

  it("uses the actual local window, canonical levels, and exact remaining hard cap", () => {
    const result = compose(request({
      intent: "study",
      topics: [topic(0)],
      scope: scope({ recommendedSessions: 1, maximumSessions: 1 }),
      availability: [{ day: "Monday", window: "Evening", minutes: 35 }],
    }), durationContext({
      sustainableMinutes: 60,
      preferredWindow: "morning",
    }));
    const envelope = result.envelopes[0]!;

    expect(envelope.scheduledFor).toBe("2026-08-10T19:00:00.000Z");
    expect(envelope.hardMaximumMinutes).toBe(35);
    expect(envelope.timing).toMatchObject({
      activeMinutes: 25,
      hardMaximumMinutes: 35,
      durationSource: "availability_cap",
    });
    expect(envelope.durationRuleTrace.map((entry) => entry.ruleId)).toEqual([
      "duration.recommendation.sustainable_baseline",
      "duration.recommendation.declared_window_fit",
      "duration.availability_cap",
    ]);
  });

  it("clips a session to the deadline without scheduling before now or past the deadline", () => {
    // The shared enumerator intentionally keeps a one-minute legacy grace.
    // The composer must clip that occurrence so its own timestamp is current.
    const current = new Date("2026-08-10T19:00:30.000Z");
    const result = compose(request({
      intent: "study",
      topics: [topic(0)],
      deadline: "2026-08-10T19:11:00.000Z",
      scope: scope({ recommendedSessions: 1, maximumSessions: 1 }),
      availability: [{ day: "Monday", window: "Evening", minutes: 45 }],
    }), durationContext(), current);
    const envelope = result.envelopes[0]!;

    expect(Date.parse(envelope.scheduledFor)).toBeGreaterThanOrEqual(current.getTime());
    expect(envelope.timing.activeMinutes).toBe(10);
    expect(Date.parse(envelope.scheduledFor) + 10 * 60_000)
      .toBeLessThanOrEqual(Date.parse("2026-08-10T19:11:00.000Z"));
  });

  it("uses preferred target capacity normally and maximum capacity only to fit the scope cap", () => {
    const preferred = compose(request({
      intent: "study",
      topics: [topic(0), topic(1), topic(2), topic(3)],
      scope: scope({ recommendedSessions: 2, maximumSessions: 2 }),
    }));
    expect(preferred.envelopes.map((envelope) => envelope.topicIds.length)).toEqual([2, 2]);

    const packed = compose(request({
      intent: "study",
      topics: [topic(0), topic(1), topic(2), topic(3), topic(4), topic(5), topic(6)],
      scope: scope({ recommendedSessions: 2, maximumSessions: 2 }),
    }));
    expect(packed.envelopes.map((envelope) => envelope.topicIds.length)).toEqual([3, 3]);
    expect(packed.deferrals).toEqual([
      expect.objectContaining({ topicId: IDS[6], reasonCode: "session_cap" }),
    ]);
  });

  it("never groups more targets than the session can give individual completion checks", () => {
    const result = compose(request({
      intent: "study",
      topics: [topic(0), topic(1), topic(2), topic(3), topic(4)],
      scope: scope({
        minimumSessions: 1,
        recommendedSessions: 1,
        maximumSessions: 1,
      }),
      availability: [{ day: "Monday", window: "Morning", minutes: 60 }],
    }), durationContext({ sustainableMinutes: 60 }));
    const envelope = result.envelopes[0]!;

    expect(envelope.timing.activeMinutes).toBe(60);
    expect(envelope.contentBudget.maximumContentTargets).toBe(5);
    expect(envelope.contentBudget.maximumCompletionChecks).toBe(4);
    expect(envelope.topicIds).toEqual([IDS[0], IDS[1], IDS[2], IDS[3]]);
    expect(envelope.topicIds).toHaveLength(
      envelope.contentBudget.maximumCompletionChecks,
    );
    expect(result.deferrals).toContainEqual(expect.objectContaining({
      topicId: IDS[4],
      reasonCode: "session_cap",
    }));
  });

  it("stably topologically orders prerequisites and preserves direct and transitive map deferrals", () => {
    const independent = topic(2);
    const prerequisite = topic(0, {
      deferred: { reason: "This prerequisite is explicitly outside the accepted plan scope." },
    });
    const dependent = topic(1, { prerequisiteTopicIds: [IDS[0]!] });
    const result = compose(request({
      intent: "study",
      topics: [dependent, independent, prerequisite],
      scope: scope({ recommendedSessions: 1, maximumSessions: 2 }),
    }));

    expect(result.envelopes[0]!.topicIds).toEqual([IDS[2]]);
    expect(result.deferrals).toEqual([
      expect.objectContaining({ topicId: IDS[0], reasonCode: "accepted_map_deferral" }),
      expect.objectContaining({
        topicId: IDS[1],
        reasonCode: "prerequisite_deferred",
        prerequisiteTopicIds: [IDS[0]],
      }),
    ]);
    expect(result.status).toBe("complete");
  });

  it("rejects duplicate or unknown prerequisites and prerequisite cycles with stable codes", () => {
    expectComposerError(() => compose(request({
      intent: "study",
      topics: [
        topic(0),
        topic(1, { prerequisiteTopicIds: [IDS[0]!, IDS[0]!] }),
      ],
    })), "duplicate_prerequisite");

    expectComposerError(() => compose(request({
      intent: "study",
      topics: [topic(0, { prerequisiteTopicIds: [IDS[9]!] })],
    })), "unknown_prerequisite");

    expectComposerError(() => compose(request({
      intent: "study",
      topics: [
        topic(0, { prerequisiteTopicIds: [IDS[1]!] }),
        topic(1, { prerequisiteTopicIds: [IDS[0]!] }),
      ],
    })), "prerequisite_cycle");
  });

  it("rejects an intent authority mismatch and maps with no runnable target", () => {
    const currentRequest = request({
      intent: "learn",
      topics: [topic(0)],
    });
    expectComposerError(() => composeNormalPlanEnvelopes({
      request: currentRequest,
      learningIntentRecommendation: {
        intent: "study",
        basis: "This stale recommendation disagrees with the resolved request.",
      },
      durationContext: durationContext(),
      now: NOW,
      searchDays: 1,
    }), "invalid_learning_intent");

    expectComposerError(() => compose(request({
      intent: "study",
      topics: [topic(0, {
        deferred: { reason: "This is explicitly outside the accepted active plan scope." },
      })],
    })), "empty_active_target_set");
  });

  it("rejects zero capacity, an unreachable scope minimum, and an unreachable teaching minimum", () => {
    expectComposerError(() => compose(request({
      intent: "study",
      topics: [topic(0)],
      availability: [{ day: "Monday", window: "Morning", minutes: 5 }],
    })), "no_normal_session_capacity");

    expectComposerError(() => compose(request({
      intent: "study",
      topics: [topic(0)],
      scope: scope({ minimumSessions: 2, recommendedSessions: 2, maximumSessions: 2 }),
      availability: [{ day: "Monday", window: "Morning", minutes: 25 }],
    })), "scope_minimum_unreachable");

    expectComposerError(() => compose(request({
      intent: "learn",
      topics: [topic(0), topic(1)],
      scope: scope({
        minimumSessions: 2,
        recommendedSessions: 3,
        maximumSessions: 3,
        minimumTeachingSessions: 2,
      }),
      availability: [{ day: "Monday", window: "Morning", minutes: 25 }],
    })), "minimum_teaching_unreachable");
  });

  it("splits Learn coverage to honor minimum teaching sessions without losing later Practice", () => {
    const result = compose(request({
      intent: "learn",
      topics: [topic(0), topic(1)],
      scope: scope({
        minimumSessions: 3,
        recommendedSessions: 3,
        maximumSessions: 3,
        minimumTeachingSessions: 2,
      }),
      availability: [{ day: "Every day", window: "Morning", minutes: 90 }],
    }));

    expect(result.envelopes.map((envelope) => ({
      kind: envelope.kind,
      mode: envelope.learningMode,
      topics: envelope.topicIds,
    }))).toEqual([
      { kind: "initial_coverage", mode: "learn", topics: [IDS[0]] },
      { kind: "initial_coverage", mode: "learn", topics: [IDS[1]] },
      { kind: "required_practice", mode: "study", topics: [IDS[0], IDS[1]] },
    ]);
  });

  it("caps the teaching minimum at the exact number of Learn targets", () => {
    const demonstrated = topic(0, {
      status: "secure",
      initialEvidence: { source: "placement_check", outcome: "demonstrated", observedAt: OBSERVED_AT },
    });
    const result = compose(request({
      intent: "learn",
      topics: [demonstrated],
      placementCheck: {
        status: "completed",
        completedAt: OBSERVED_AT,
        demonstratedTopicIds: [IDS[0]!],
        gapTopicIds: [],
      },
      scope: scope({
        recommendedSessions: 1,
        maximumSessions: 1,
        minimumTeachingSessions: 2,
      }),
    }));

    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0]).toMatchObject({
      learningMode: "study",
      modeBasisCode: "independent_attempt",
    });
  });

  it("classifies from the authoritative request goal and starting context plus the accepted topic", () => {
    const result = compose(request({
      intent: "study",
      topics: [topic(0, {
        title: "Assigned response",
        description: "Complete the assigned response using the accepted source material.",
      })],
      goal: "Draft a persuasive essay with a clear thesis statement and evidence paragraphs.",
      startingContext: "I need to revise my argument before submitting the paper.",
      scope: scope({ recommendedSessions: 1, maximumSessions: 1 }),
    }));

    expect(result.envelopes[0]!.taskClassification).toMatchObject({
      taskType: "writing_argumentation",
      confidence: "clear",
    });
  });

  it("attributes deferral to the horizon when a distant deadline does not restrict it", () => {
    const result = compose(request({
      intent: "study",
      topics: [
        topic(0, { title: "Write Python code", description: "Implement and debug a Python function correctly." }),
        topic(1, { title: "Vocabulary facts", description: "Memorize vocabulary definitions and exact facts." }),
      ],
      deadline: "2026-08-20T12:00:00.000Z",
      scope: scope({ recommendedSessions: 2, maximumSessions: 2 }),
      availability: [{ day: "Monday", window: "Morning", minutes: 25 }],
    }));

    expect(result.deferrals).toEqual([
      expect.objectContaining({ topicId: IDS[1], reasonCode: "availability_capacity" }),
    ]);
  });

  it("does not blame a deadline when it only lengthens the post-placement tail from zero to four minutes", () => {
    // The deadline clips a 19-minute occurrence to 15 minutes. The actual
    // canonical session consumes those 15 minutes, so removing the deadline
    // reveals only four minutes - still short of another normal session.
    const result = compose(request({
      intent: "study",
      topics: [
        topic(0, { title: "Write Python code", description: "Implement and debug a Python function correctly." }),
        topic(1, { title: "Vocabulary facts", description: "Memorize vocabulary definitions and exact facts." }),
      ],
      deadline: "2026-08-10T09:15:00.000Z",
      scope: scope({ recommendedSessions: 2, maximumSessions: 2 }),
      availability: [{ day: "Monday", window: "Morning", minutes: 19 }],
    }));

    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0]!.timing.activeMinutes).toBe(15);
    expect(result.deferrals).toEqual([
      expect.objectContaining({ topicId: IDS[1], reasonCode: "availability_capacity" }),
    ]);
  });

  it("keeps deadline attribution when removing it reveals another schedulable ten-minute session", () => {
    const result = compose(request({
      intent: "study",
      topics: [
        topic(0, { title: "Write Python code", description: "Implement and debug a Python function correctly." }),
        topic(1, { title: "Vocabulary facts", description: "Memorize vocabulary definitions and exact facts." }),
      ],
      deadline: "2026-08-10T09:15:00.000Z",
      scope: scope({ recommendedSessions: 2, maximumSessions: 2 }),
      availability: [{ day: "Monday", window: "Morning", minutes: 25 }],
    }));

    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0]!.timing.activeMinutes).toBe(15);
    expect(result.deferrals).toEqual([
      expect.objectContaining({ topicId: IDS[1], reasonCode: "deadline_capacity" }),
    ]);
  });

  it("is deterministic, deeply frozen, and does not mutate any input", () => {
    const currentRequest = request({
      intent: "learn",
      topics: [topic(0), topic(1)],
      scope: scope({ recommendedSessions: 2, maximumSessions: 2 }),
    });
    const context = durationContext();
    const snapshot = structuredClone({ request: currentRequest, context });
    const first = compose(currentRequest, context);
    const second = compose(currentRequest, context);

    expect(first).toEqual(second);
    expect({ request: currentRequest, context }).toEqual(snapshot);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.envelopes)).toBe(true);
    expect(Object.isFrozen(first.envelopes[0]!.timing)).toBe(true);
    expect(Object.isFrozen(first.deferrals)).toBe(true);
    expect(Reflect.set(first.envelopes[0]!, "learningMode", "study")).toBe(false);
  });
});

function compose(
  currentRequest: PlanGenerationRequest,
  context = durationContext(),
  now = NOW,
) {
  return composeNormalPlanEnvelopes({
    request: currentRequest,
    learningIntentRecommendation: {
      intent: currentRequest.learningIntent,
      basis: currentRequest.learningIntent === "learn"
        ? "The learner said the material is new."
        : "The learner said this is review.",
    },
    durationContext: context,
    now,
    searchDays: 1,
  });
}

function request({
  intent,
  topics,
  scope: currentScope = scope(),
  placementCheck = {
    status: "skipped" as const,
    completedAt: null,
    demonstratedTopicIds: [],
    gapTopicIds: [],
  },
  availability = [{ day: "Monday", window: "Morning", minutes: 60 }],
  deadline = null,
  goal = "Build a reliable understanding of the accepted knowledge-map scope.",
  startingContext = intent === "learn" ? "This material is new to me." : "I have learned this before.",
}: {
  intent: "learn" | "study";
  topics: PlanKnowledgeMap["topics"];
  scope?: PlanKnowledgeMap["scopeJudgment"];
  placementCheck?: PlanKnowledgeMap["placementCheck"];
  availability?: PlanGenerationRequest["availability"];
  deadline?: string | null;
  goal?: string;
  startingContext?: string;
}): PlanGenerationRequest {
  const knowledgeMap: PlanKnowledgeMap = {
    version: 1,
    scopeJudgment: currentScope,
    topics,
    placementCheck,
  };
  return {
    intent: "plan",
    learningIntent: intent,
    goal,
    startingContext,
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline,
    timeZone: "UTC",
    diagnosticResponses: [],
    availability,
    profileSummary: "Use a clear ordinary plan while evidence is still limited.",
    knowledgeMap,
  };
}

function topic(
  index: number,
  overrides: Partial<PlanKnowledgeMap["topics"][number]> = {},
): PlanKnowledgeMap["topics"][number] {
  return {
    id: IDS[index]!,
    title: `Concept ${index + 1}`,
    description: `Understand and explain the relationship for concept ${index + 1}.`,
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

function scope(
  overrides: Partial<PlanKnowledgeMap["scopeJudgment"]> = {},
): PlanKnowledgeMap["scopeJudgment"] {
  return {
    band: "unit_or_exam",
    label: "Bounded test scope",
    minimumSessions: 1,
    recommendedSessions: 2,
    maximumSessions: 4,
    minimumTeachingSessions: 0,
    explanation: "This accepted fixture defines a bounded scope for deterministic composition.",
    ...overrides,
  };
}

function durationContext({
  sustainableMinutes = null,
  preferredWindow = null,
}: {
  sustainableMinutes?: 10 | 15 | 25 | 45 | 60 | null;
  preferredWindow?: "morning" | "afternoon" | "evening" | "late_night" | "varies" | null;
} = {}): NormalPlanDurationContext {
  return {
    profileVersion: "authorized_profile_snapshot:test-v1",
    profile: {
      sustainableMinutes,
      startingFrictionRisk: null,
      fatigueRisk: null,
      preferredWindow,
      evidenceRefs: {
        sustainableMinutes: sustainableMinutes === null ? [] : ["profile:sustainable"],
        startingFrictionRisk: [],
        fatigueRisk: [],
        preferredWindow: preferredWindow === null ? [] : ["profile:window"],
      },
    },
    recentOutcomes: [],
  };
}

function expectComposerError(callback: () => unknown, code: string) {
  try {
    callback();
    throw new Error("Expected the composer to reject the fixture.");
  } catch (error) {
    expect(error).toBeInstanceOf(NormalPlanEnvelopeComposerError);
    expect((error as NormalPlanEnvelopeComposerError).code).toBe(code);
  }
}
