import { describe, expect, it } from "vitest";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import {
  INITIAL_PLAN_MODE_ROUTING_VERSION,
  InitialPlanModeRoutingError,
  resolveInitialPlanSessionModes,
} from "@/lib/plan-generation/initial-session-mode";

const TOPIC_A = "10000000-1000-4000-8000-000000000001";
const TOPIC_B = "10000000-1000-4000-8000-000000000002";
const OBSERVED_AT = "2026-08-24T09:00:00.000Z";

describe("initial plan session mode routing", () => {
  it("uses the explicit plan recommendation only for unobserved first encounters", () => {
    expect(resolve(map(), "learn", [{ key: 1, topicIds: [TOPIC_A] }])[0]).toMatchObject({
      learningMode: "learn",
      basisCode: "instruction_required",
      targetDecisions: [{ basisCode: "unobserved_learn_baseline" }],
    });
    expect(resolve(map(), "study", [{ key: 1, topicIds: [TOPIC_A] }])[0]).toMatchObject({
      learningMode: "study",
      basisCode: "independent_attempt",
      targetDecisions: [{ basisCode: "unobserved_practice_baseline" }],
    });
  });

  it("routes exact placement gaps to Learn and demonstrated targets to Practice", () => {
    const knowledgeMap = map({
      placementCheck: {
        status: "completed",
        completedAt: OBSERVED_AT,
        demonstratedTopicIds: [TOPIC_B],
        gapTopicIds: [TOPIC_A],
      },
      topicOverrides: {
        [TOPIC_A]: {
          initialEvidence: { source: "placement_check", outcome: "gap", observedAt: OBSERVED_AT },
        },
        [TOPIC_B]: {
          status: "evidenced",
          initialEvidence: { source: "placement_check", outcome: "demonstrated", observedAt: OBSERVED_AT },
        },
      },
    });
    const decisions = resolve(knowledgeMap, "study", [
      { key: "mixed", topicIds: [TOPIC_A, TOPIC_B] },
    ]);

    expect(decisions[0]).toMatchObject({
      learningMode: "learn",
      basisCode: "instruction_with_bounded_verification",
      targetDecisions: [
        { topicId: TOPIC_A, learningMode: "learn", basisCode: "placement_gap" },
        { topicId: TOPIC_B, learningMode: "study", basisCode: "placement_demonstrated" },
      ],
    });
    expect(decisions[0].ruleTrace).toEqual([
      expect.objectContaining({
        ruleId: INITIAL_PLAN_MODE_ROUTING_VERSION,
        result: "learn:instruction_with_bounded_verification",
        evidenceRefs: [
          `placement:${TOPIC_A}:${OBSERVED_AT}`,
          `placement:${TOPIC_B}:${OBSERVED_AT}`,
        ],
      }),
    ]);
    expect(decisions[0].ruleTrace[0]?.reason).toContain("confirmed placement gap");
    expect(decisions[0].ruleTrace[0]?.reason).not.toContain("Practice starting recommendation");
  });

  it("lets a current placement gap override stale secure status", () => {
    const knowledgeMap = map({
      placementCheck: {
        status: "completed",
        completedAt: OBSERVED_AT,
        demonstratedTopicIds: [],
        gapTopicIds: [TOPIC_A],
      },
      topicOverrides: {
        [TOPIC_A]: {
          status: "secure",
          initialEvidence: { source: "placement_check", outcome: "gap", observedAt: OBSERVED_AT },
        },
      },
    });
    const decision = resolve(knowledgeMap, "study", [
      { key: "gap-after-secure", topicIds: [TOPIC_A] },
    ])[0]!;

    expect(decision).toMatchObject({
      learningMode: "learn",
      basisCode: "instruction_required",
      targetDecisions: [{
        topicId: TOPIC_A,
        learningMode: "learn",
        basisCode: "placement_gap",
        evidenceRefs: [`placement:${TOPIC_A}:${OBSERVED_AT}`],
      }],
    });
    expect(decision.ruleTrace[0]).toMatchObject({
      result: "learn:instruction_required",
      evidenceRefs: [`placement:${TOPIC_A}:${OBSERVED_AT}`],
    });
    expect(decision.ruleTrace[0]?.reason).toContain("confirmed placement gap");
    expect(decision.ruleTrace[0]?.reason).not.toContain("recorded as previously encountered");
  });

  it.each(["taught", "evidenced", "secure"] as const)(
    "treats a %s target as already encountered",
    (status) => {
      const decision = resolve(map({
        topicOverrides: { [TOPIC_A]: { status } },
      }), "learn", [{ key: 1, topicIds: [TOPIC_A] }])[0];
      expect(decision.targetDecisions[0]).toMatchObject({
        learningMode: "study",
        basisCode: "recorded_encounter",
        evidenceRefs: [`knowledge-map-topic:${TOPIC_A}:status:${status}`],
      });
      expect(decision.ruleTrace[0]?.reason).toContain("recorded as previously encountered");
      expect(decision.ruleTrace[0]?.reason).not.toContain("Learn starting recommendation");
    },
  );

  it("turns a later occurrence into Practice without calling the planned encounter evidence", () => {
    const decisions = resolve(map(), "learn", [
      { key: "teach", topicIds: [TOPIC_A] },
      { key: "try", topicIds: [TOPIC_A] },
    ]);
    expect(decisions.map((decision) => decision.learningMode)).toEqual(["learn", "study"]);
    expect(decisions[1].targetDecisions[0]).toEqual({
      topicId: TOPIC_A,
      learningMode: "study",
      basisCode: "planned_later_attempt",
      evidenceRefs: ["planned-session:string:teach"],
      priorSessionKey: "teach",
    });
    expect(decisions[1].ruleTrace[0]).toMatchObject({
      evidenceRefs: ["planned-session:string:teach"],
    });
    expect(decisions[1].ruleTrace[0]?.reason).toContain("follows an earlier planned encounter");
  });

  it("does not generalize one demonstrated topic to an unchecked target", () => {
    const knowledgeMap = map({
      placementCheck: {
        status: "completed",
        completedAt: OBSERVED_AT,
        demonstratedTopicIds: [TOPIC_A],
        gapTopicIds: [],
      },
      topicOverrides: {
        [TOPIC_A]: {
          status: "evidenced",
          initialEvidence: { source: "placement_check", outcome: "demonstrated", observedAt: OBSERVED_AT },
        },
      },
    });
    const decisions = resolve(knowledgeMap, "learn", [
      { key: 1, topicIds: [TOPIC_A] },
      { key: 2, topicIds: [TOPIC_B] },
    ]);
    expect(decisions.map((decision) => decision.learningMode)).toEqual(["study", "learn"]);
  });

  it("is deterministic, deeply frozen, and does not mutate its input", () => {
    const knowledgeMap = map();
    const sessions = [{ key: 1, topicIds: [TOPIC_A, TOPIC_B] }] as const;
    const snapshot = structuredClone({ knowledgeMap, sessions });
    const first = resolve(knowledgeMap, "learn", sessions);
    const second = resolve(knowledgeMap, "learn", sessions);

    expect(first).toEqual(second);
    expect({ knowledgeMap, sessions }).toEqual(snapshot);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0].targetDecisions)).toBe(true);
    expect(Reflect.set(first[0], "learningMode", "study")).toBe(false);
  });

  it.each([
    {
      name: "duplicate map topic",
      expectedCode: "duplicate_topic_id",
      knowledgeMap: () => {
        const value = map();
        value.topics.push({ ...value.topics[0]! });
        return value;
      },
      sessions: [{ key: 1, topicIds: [TOPIC_A] }],
    },
    {
      name: "duplicate session key",
      expectedCode: "duplicate_session_key",
      knowledgeMap: map,
      sessions: [{ key: 1, topicIds: [TOPIC_A] }, { key: 1, topicIds: [TOPIC_B] }],
    },
    {
      name: "empty targets",
      expectedCode: "empty_session_targets",
      knowledgeMap: map,
      sessions: [{ key: 1, topicIds: [] }],
    },
    {
      name: "duplicate session target",
      expectedCode: "duplicate_session_target",
      knowledgeMap: map,
      sessions: [{ key: 1, topicIds: [TOPIC_A, TOPIC_A] }],
    },
    {
      name: "unknown target",
      expectedCode: "unknown_session_target",
      knowledgeMap: map,
      sessions: [{ key: 1, topicIds: ["10000000-1000-4000-8000-000000000099"] }],
    },
    {
      name: "scheduled deferred target",
      expectedCode: "deferred_session_target",
      knowledgeMap: () => map({
        topicOverrides: { [TOPIC_A]: { deferred: { reason: "This target is outside the current plan boundary." } } },
      }),
      sessions: [{ key: 1, topicIds: [TOPIC_A] }],
    },
  ])("rejects $name", ({ expectedCode, knowledgeMap, sessions }) => {
    expectRoutingError(() => resolve(knowledgeMap(), "learn", sessions), expectedCode);
  });

  it("rejects unbounded intent bases and invalid session keys through the typed boundary", () => {
    expectRoutingError(
      () => resolveInitialPlanSessionModes({
        learningIntentRecommendation: { intent: "learn", basis: "x".repeat(301) },
        knowledgeMap: map(),
        sessions: [{ key: 1, topicIds: [TOPIC_A] }],
      }),
      "invalid_learning_intent",
    );
    expectRoutingError(
      () => resolve(map(), "learn", [{ key: Number.NaN, topicIds: [TOPIC_A] }]),
      "invalid_session_key",
    );
  });

  it("rejects contradictory, stale, or incomplete placement ledgers", () => {
    const overlap = map({
      placementCheck: {
        status: "completed",
        completedAt: OBSERVED_AT,
        demonstratedTopicIds: [TOPIC_A],
        gapTopicIds: [TOPIC_A],
      },
      topicOverrides: {
        [TOPIC_A]: {
          status: "evidenced",
          initialEvidence: { source: "placement_check", outcome: "demonstrated", observedAt: OBSERVED_AT },
        },
      },
    });
    expectRoutingError(
      () => resolve(overlap, "learn", [{ key: 1, topicIds: [TOPIC_A] }]),
      "overlapping_placement_outcome",
    );

    const skippedWithEvidence = map({
      placementCheck: {
        status: "skipped",
        completedAt: null,
        demonstratedTopicIds: [TOPIC_A],
        gapTopicIds: [],
      },
    });
    expectRoutingError(
      () => resolve(skippedWithEvidence, "learn", [{ key: 1, topicIds: [TOPIC_A] }]),
      "invalid_placement_state",
    );

    const mismatched = map({
      placementCheck: {
        status: "completed",
        completedAt: OBSERVED_AT,
        demonstratedTopicIds: [TOPIC_A],
        gapTopicIds: [],
      },
    });
    expectRoutingError(
      () => resolve(mismatched, "learn", [{ key: 1, topicIds: [TOPIC_A] }]),
      "placement_evidence_mismatch",
    );
  });
});

function resolve(
  knowledgeMap: PlanKnowledgeMap,
  intent: "learn" | "study",
  sessions: ReadonlyArray<{ key: string | number; topicIds: readonly string[] }>,
) {
  return resolveInitialPlanSessionModes({
    learningIntentRecommendation: {
      intent,
      basis: intent === "learn" ? "learner said this is new" : "learner said this is review",
    },
    knowledgeMap,
    sessions,
  });
}

function map({
  placementCheck = {
    status: "skipped" as const,
    completedAt: null,
    demonstratedTopicIds: [],
    gapTopicIds: [],
  },
  topicOverrides = {},
}: {
  placementCheck?: PlanKnowledgeMap["placementCheck"];
  topicOverrides?: Partial<Record<string, Partial<PlanKnowledgeMap["topics"][number]>>>;
} = {}): PlanKnowledgeMap {
  const topic = (id: string, title: string): PlanKnowledgeMap["topics"][number] => ({
    id,
    title,
    description: `A bounded knowledge target for ${title}.`,
    subtopics: [],
    prerequisiteTopicIds: [],
    status: "not_started",
    initialEvidence: null,
    sourceReferences: [],
    origin: "ai_generated",
    deferred: null,
    ...topicOverrides[id],
  });
  return {
    version: 1,
    scopeJudgment: {
      band: "unit_or_exam",
      label: "Two topic plan",
      minimumSessions: 1,
      recommendedSessions: 2,
      maximumSessions: 4,
      minimumTeachingSessions: 0,
      explanation: "This fixture covers two bounded topics for deterministic routing tests.",
    },
    topics: [topic(TOPIC_A, "Topic A"), topic(TOPIC_B, "Topic B")],
    placementCheck,
    curriculum: null,
  };
}

function expectRoutingError(callback: () => unknown, code: string) {
  try {
    callback();
    throw new Error("Expected initial plan mode routing to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(InitialPlanModeRoutingError);
    expect((error as InitialPlanModeRoutingError).code).toBe(code);
  }
}
