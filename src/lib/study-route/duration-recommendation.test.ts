import { describe, expect, it } from "vitest";
import {
  recommendNormalStudyDuration,
  type NormalDurationOutcome,
  type NormalStudyDurationRecommendationInput,
} from "@/lib/study-route/duration-recommendation";

const ROUTE_IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
  "00000000-0000-4000-8000-000000000006",
] as const;

function profileEvidenceRefs(overrides: Partial<{
  sustainableMinutes: string[];
  startingFrictionRisk: string[];
  fatigueRisk: string[];
  preferredWindow: string[];
}> = {}) {
  return {
    sustainableMinutes: [],
    startingFrictionRisk: [],
    fatigueRisk: [],
    preferredWindow: [],
    ...overrides,
  };
}

function input(
  overrides: Partial<NormalStudyDurationRecommendationInput> = {},
): NormalStudyDurationRecommendationInput {
  return {
    context: { taskFamily: "conceptual_learning", mode: "learn" },
    profile: {
      sustainableMinutes: null,
      startingFrictionRisk: null,
      fatigueRisk: null,
      preferredWindow: null,
      evidenceRefs: profileEvidenceRefs(),
    },
    schedule: { window: null },
    recentOutcomes: [],
    ...overrides,
  };
}

function completion(
  index: number,
  overrides: Partial<NormalDurationOutcome> = {},
): NormalDurationOutcome {
  return {
    kind: "completion",
    sessionClass: "normal",
    taskFamily: "conceptual_learning",
    mode: "learn",
    occurredAt: `2026-08-${String(20 + index).padStart(2, "0")}T12:00:00.000Z`,
    routeRevisionId: ROUTE_IDS[index]!,
    plannedMinutes: 25,
    actualMinutes: 25,
    correctAnswers: 4,
    totalAnswers: 5,
    feedback: "about_right",
    evidenceRef: `completion:${index}`,
    ...overrides,
  };
}

function interruption(
  index: number,
  overrides: Partial<NormalDurationOutcome> = {},
): NormalDurationOutcome {
  return {
    kind: "interruption",
    sessionClass: "normal",
    taskFamily: "conceptual_learning",
    mode: "learn",
    occurredAt: `2026-08-${String(20 + index).padStart(2, "0")}T12:00:00.000Z`,
    routeRevisionId: ROUTE_IDS[index]!,
    plannedMinutes: 25,
    actualMinutes: 10,
    completedSteps: 1,
    totalSteps: 4,
    evidenceRef: `interruption:${index}`,
    ...overrides,
  };
}

describe("normal StudyRoute system duration recommendation", () => {
  it("uses a conservative 25-minute router baseline without authorized profile evidence", () => {
    expect(recommendNormalStudyDuration(input())).toMatchObject({
      minutes: 25,
      source: "router_default",
      ruleTrace: [{
        ruleId: "duration.recommendation.router_baseline",
        result: "baseline_25_minutes",
      }],
    });
  });

  it.each([10, 15, 25, 45, 60] as const)(
    "uses the learner's authorized %i-minute sustainable baseline",
    (minutes) => {
      const result = recommendNormalStudyDuration(input({
        profile: {
          sustainableMinutes: minutes,
          startingFrictionRisk: null,
          fatigueRisk: null,
          preferredWindow: null,
          evidenceRefs: profileEvidenceRefs({
            sustainableMinutes: ["profile:session-range"],
          }),
        },
      }));

      expect(result).toMatchObject({
        minutes,
        source: "profile_recommendation",
        ruleTrace: [{
          ruleId: "duration.recommendation.sustainable_baseline",
          evidenceRefs: ["profile:session-range"],
        }],
      });
    },
  );

  it("lowers one level after two comparable meaningful early interruptions", () => {
    const result = recommendNormalStudyDuration(input({
      recentOutcomes: [
        interruption(0, { actualMinutes: 23, completedSteps: 1, totalSteps: 4 }),
        interruption(1, { completedSteps: undefined, totalSteps: undefined, actualMinutes: 10 }),
      ],
    }));

    expect(result).toMatchObject({
      minutes: 15,
      source: "observed_outcome_adjustment",
    });
    expect(result.ruleTrace.at(-1)).toMatchObject({
      ruleId: "duration.recommendation.repeated_early_exits",
      result: "lowered_to_15_minutes",
    });
    expect(result.ruleTrace.at(-1)?.evidenceRefs).toEqual(expect.arrayContaining([
      "interruption:0",
      "interruption:1",
      `route-revision:${ROUTE_IDS[0]}`,
      `route-revision:${ROUTE_IDS[1]}`,
    ]));
  });

  it("does not lower for one early interruption or two interruptions that reached most work", () => {
    expect(recommendNormalStudyDuration(input({
      recentOutcomes: [interruption(0)],
    })).minutes).toBe(25);

    expect(recommendNormalStudyDuration(input({
      recentOutcomes: [
        interruption(0, { completedSteps: 3, totalSteps: 4, actualMinutes: 10 }),
        interruption(1, { completedSteps: undefined, totalSteps: undefined, actualMinutes: 19 }),
      ],
    })).minutes).toBe(25);
  });

  it("ignores otherwise qualifying outcomes from another task family or mode", () => {
    const result = recommendNormalStudyDuration(input({
      recentOutcomes: [
        interruption(0, { taskFamily: "memorization" }),
        interruption(1, { mode: "practice" }),
        interruption(2),
      ],
    }));

    expect(result.minutes).toBe(25);
    expect(result.ruleTrace).toHaveLength(1);
  });

  it("excludes lightweight reviews from normal-session duration history", () => {
    const result = recommendNormalStudyDuration(input({
      recentOutcomes: [
        interruption(0, { sessionClass: "lightweight_review", plannedMinutes: 5 }),
        interruption(1, { sessionClass: "lightweight_review", plannedMinutes: 5 }),
        completion(2, { sessionClass: "lightweight_review", plannedMinutes: 5, actualMinutes: 5 }),
        completion(3, { sessionClass: "lightweight_review", plannedMinutes: 5, actualMinutes: 5 }),
      ],
    }));

    expect(result.minutes).toBe(25);
    expect(result.ruleTrace).toHaveLength(1);
  });

  it("uses only the latest four comparable outcomes", () => {
    const result = recommendNormalStudyDuration(input({
      recentOutcomes: [
        interruption(0, { occurredAt: "2026-08-10T12:00:00.000Z" }),
        interruption(1, { occurredAt: "2026-08-11T12:00:00.000Z" }),
        completion(2, { occurredAt: "2026-08-20T12:00:00.000Z" }),
        completion(3, { occurredAt: "2026-08-21T12:00:00.000Z" }),
        completion(4, { occurredAt: "2026-08-22T12:00:00.000Z" }),
        completion(5, { occurredAt: "2026-08-23T12:00:00.000Z" }),
      ],
    }));

    expect(result.minutes).toBe(45);
    expect(result.ruleTrace.at(-1)?.ruleId)
      .toBe("duration.recommendation.repeated_stable_completions");
  });

  it("lowers one level for high declared fatigue risk", () => {
    const result = recommendNormalStudyDuration(input({
      profile: {
        sustainableMinutes: 45,
        startingFrictionRisk: null,
        fatigueRisk: "high",
        preferredWindow: null,
        evidenceRefs: profileEvidenceRefs({
          sustainableMinutes: ["profile:session-range"],
          fatigueRisk: ["profile:fatigue-risk"],
        }),
      },
    }));

    expect(result).toMatchObject({ minutes: 25, source: "profile_recommendation" });
    expect(result.ruleTrace.at(-1)?.ruleId)
      .toBe("duration.recommendation.declared_fatigue_risk");
  });

  it("lowers one level for high starting friction without stacking profile signals", () => {
    const result = recommendNormalStudyDuration(input({
      profile: {
        sustainableMinutes: 60,
        startingFrictionRisk: "high",
        fatigueRisk: "high",
        preferredWindow: "morning",
        evidenceRefs: profileEvidenceRefs({
          sustainableMinutes: ["profile:session-range"],
          startingFrictionRisk: ["profile:starting-friction"],
          fatigueRisk: ["profile:fatigue-risk"],
          preferredWindow: ["profile:planning-window"],
        }),
      },
      schedule: { window: "evening" },
    }));

    expect(result.minutes).toBe(45);
    expect(result.ruleTrace).toHaveLength(2);
    expect(result.ruleTrace.at(-1)?.ruleId)
      .toBe("duration.recommendation.declared_fatigue_risk");
  });

  it("uses an explicit planning-window mismatch but not a match, varies, or missing window", () => {
    const profile = {
      sustainableMinutes: 25 as const,
      startingFrictionRisk: null,
      fatigueRisk: null,
      preferredWindow: "morning" as const,
      evidenceRefs: profileEvidenceRefs({
        sustainableMinutes: ["profile:session-range"],
        preferredWindow: ["profile:energy-window"],
      }),
    };

    expect(recommendNormalStudyDuration(input({
      profile,
      schedule: { window: "evening" },
    })).minutes).toBe(15);
    expect(recommendNormalStudyDuration(input({
      profile,
      schedule: { window: "morning" },
    })).minutes).toBe(25);
    expect(recommendNormalStudyDuration(input({
      profile: {
        ...profile,
        preferredWindow: "varies",
      },
      schedule: { window: "evening" },
    })).minutes).toBe(25);
    expect(recommendNormalStudyDuration(input({
      profile,
      schedule: { window: null },
    })).minutes).toBe(25);
  });

  it("raises one level only after four comparable stable scored completions", () => {
    const three = recommendNormalStudyDuration(input({
      recentOutcomes: [completion(0), completion(1), completion(2)],
    }));
    const four = recommendNormalStudyDuration(input({
      recentOutcomes: [completion(0), completion(1), completion(2), completion(3)],
    }));

    expect(three.minutes).toBe(25);
    expect(four).toMatchObject({
      minutes: 45,
      source: "observed_outcome_adjustment",
    });
    expect(four.ruleTrace.at(-1)).toMatchObject({
      ruleId: "duration.recommendation.repeated_stable_completions",
      result: "raised_to_45_minutes",
    });
  });

  it.each([
    { label: "unscored", change: { correctAnswers: undefined, totalAnswers: undefined } },
    { label: "one scored answer", change: { correctAnswers: 1, totalAnswers: 1 } },
    { label: "two scored answers", change: { correctAnswers: 2, totalAnswers: 2 } },
    { label: "low accuracy", change: { correctAnswers: 3, totalAnswers: 5 } },
    { label: "too difficult", change: { feedback: "too_difficult" as const } },
    { label: "too easy", change: { feedback: "too_easy" as const } },
    { label: "timing overrun", change: { actualMinutes: 32 } },
    { label: "too little active time", change: { actualMinutes: 18 } },
  ])("does not raise from a $label completion", ({ change }) => {
    const result = recommendNormalStudyDuration(input({
      recentOutcomes: [
        completion(0, change),
        completion(1, change),
        completion(2, change),
        completion(3, change),
      ],
    }));

    expect(result.minutes).toBe(25);
  });

  it("gives a downward profile constraint precedence over stable completions", () => {
    const result = recommendNormalStudyDuration(input({
      profile: {
        sustainableMinutes: 25,
        startingFrictionRisk: "high",
        fatigueRisk: null,
        preferredWindow: null,
        evidenceRefs: profileEvidenceRefs({
          sustainableMinutes: ["profile:session-range"],
          startingFrictionRisk: ["profile:starting-friction"],
        }),
      },
      recentOutcomes: [completion(0), completion(1), completion(2), completion(3)],
    }));

    expect(result.minutes).toBe(15);
    expect(result.ruleTrace.at(-1)?.ruleId)
      .toBe("duration.recommendation.declared_starting_friction");
  });

  it("stays within the 10- and 60-minute boundaries", () => {
    const lower = recommendNormalStudyDuration(input({
      profile: {
        sustainableMinutes: 10,
        startingFrictionRisk: "high",
        fatigueRisk: null,
        preferredWindow: null,
        evidenceRefs: profileEvidenceRefs({
          sustainableMinutes: ["profile:session-range"],
          startingFrictionRisk: ["profile:starting-friction"],
        }),
      },
    }));
    const upper = recommendNormalStudyDuration(input({
      profile: {
        sustainableMinutes: 60,
        startingFrictionRisk: null,
        fatigueRisk: null,
        preferredWindow: null,
        evidenceRefs: profileEvidenceRefs({
          sustainableMinutes: ["profile:session-range"],
        }),
      },
      recentOutcomes: [completion(0), completion(1), completion(2), completion(3)],
    }));

    expect(lower.minutes).toBe(10);
    expect(lower.ruleTrace.at(-1)?.result).toBe("retained_10_minute_minimum");
    expect(upper.minutes).toBe(60);
    expect(upper.ruleTrace.at(-1)?.result).toBe("retained_60_minute_maximum");
  });

  it("rejects noncanonical duration, route-free evidence, malformed counters, and unbounded input", () => {
    const noncanonical = input();
    (noncanonical.profile as { sustainableMinutes: number | null }).sustainableMinutes = 20;
    expect(() => recommendNormalStudyDuration(noncanonical)).toThrow();

    const routeFree = input({ recentOutcomes: [completion(0)] });
    (routeFree.recentOutcomes[0] as { routeRevisionId: string }).routeRevisionId = "";
    expect(() => recommendNormalStudyDuration(routeFree)).toThrow();

    expect(() => recommendNormalStudyDuration(input({
      recentOutcomes: [completion(0, { correctAnswers: 3, totalAnswers: undefined })],
    }))).toThrow(/supplied together/i);
    expect(() => recommendNormalStudyDuration(input({
      recentOutcomes: [interruption(0, { completedSteps: 5, totalSteps: 4 })],
    }))).toThrow(/cannot exceed/i);
    expect(() => recommendNormalStudyDuration(input({
      recentOutcomes: [interruption(0, { plannedMinutes: 5 })],
    }))).toThrow(/normal session outcome must have at least ten/i);
    expect(() => recommendNormalStudyDuration(input({
      recentOutcomes: Array.from({ length: 101 }, (_, index) => completion(index % ROUTE_IDS.length)),
    }))).toThrow();
  });

  it("rejects duplicated outcome rows before thresholds can be reached", () => {
    expect(() => recommendNormalStudyDuration(input({
      recentOutcomes: [
        interruption(0),
        interruption(1, { evidenceRef: "interruption:0" }),
      ],
    }))).toThrow(/must be unique before duration scoring/i);
  });

  it("requires evidence references for each declared profile signal", () => {
    const missingSignalEvidence = input();
    missingSignalEvidence.profile.sustainableMinutes = 25;
    expect(() => recommendNormalStudyDuration(missingSignalEvidence))
      .toThrow(/requires its own evidence reference/i);

    const unrelatedEvidence = input();
    unrelatedEvidence.profile.evidenceRefs.fatigueRisk = ["profile:fatigue"];
    expect(() => recommendNormalStudyDuration(unrelatedEvidence))
      .toThrow(/must be empty when the signal is absent/i);
  });

  it("is deterministic, does not mutate inputs, and deeply freezes its result", () => {
    const currentInput = input({
      profile: {
        sustainableMinutes: 45,
        startingFrictionRisk: null,
        fatigueRisk: "high",
        preferredWindow: null,
        evidenceRefs: profileEvidenceRefs({
          sustainableMinutes: ["profile:session-range"],
          fatigueRisk: ["profile:fatigue"],
        }),
      },
      recentOutcomes: [completion(0)],
    });
    const before = structuredClone(currentInput);

    const first = recommendNormalStudyDuration(currentInput);
    const second = recommendNormalStudyDuration(currentInput);

    expect(first).toEqual(second);
    expect(currentInput).toEqual(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.ruleTrace)).toBe(true);
    expect(Object.isFrozen(first.ruleTrace[0])).toBe(true);
  });

  it("changes only the recommendation and trace in a one-signal counterfactual", () => {
    const baselineInput = input({
      profile: {
        sustainableMinutes: 25,
        startingFrictionRisk: null,
        fatigueRisk: null,
        preferredWindow: "morning",
        evidenceRefs: profileEvidenceRefs({
          sustainableMinutes: ["profile:session-range"],
          preferredWindow: ["profile:window"],
        }),
      },
      schedule: { window: "morning" },
    });
    const baseline = recommendNormalStudyDuration(baselineInput);
    const mismatch = recommendNormalStudyDuration({
      ...baselineInput,
      schedule: { window: "evening" },
    });

    expect(baseline).toMatchObject({ minutes: 25, source: "profile_recommendation" });
    expect(mismatch).toMatchObject({ minutes: 15, source: "profile_recommendation" });
    expect(baseline.ruleTrace[0]).toEqual(mismatch.ruleTrace[0]);
    expect(mismatch.ruleTrace.slice(1)).toHaveLength(1);
  });
});
