import { describe, expect, it } from "vitest";
import { StudyRouteTimingSchema } from "@/lib/study-route/schema";
import {
  NORMAL_STUDY_DURATION_LEVELS,
  resolveNormalStudyDurationPrecedence,
  type NormalStudyDurationPrecedenceInput,
} from "@/lib/study-route/duration-precedence";

function input(
  overrides: Partial<NormalStudyDurationPrecedenceInput> = {},
): NormalStudyDurationPrecedenceInput {
  return {
    systemRecommendation: {
      minutes: 25,
      source: "router_default",
      ruleTrace: [{
        ruleId: "duration.system_recommendation",
        result: "recommended_25_minutes",
        reason: "The deterministic router selected the ordinary 25-minute baseline.",
        evidenceRefs: [],
      }],
    },
    ...overrides,
  };
}

describe("normal StudyRoute duration precedence", () => {
  it("defines the frozen learner-facing levels, including the new ten-minute session", () => {
    expect(NORMAL_STUDY_DURATION_LEVELS).toEqual([10, 15, 25, 45, 60]);
  });

  it("passes through a deterministic system recommendation using StudyRoute timing", () => {
    const result = resolveNormalStudyDurationPrecedence(input());

    expect(result).toMatchObject({
      status: "resolved",
      timing: {
        activeMinutes: 25,
        elapsedMinutes: 25,
        durationSource: "router_default",
      },
    });
    expect(result.status === "resolved" && StudyRouteTimingSchema.safeParse(result.timing).success)
      .toBe(true);
  });

  it("preserves a profile recommendation when no stronger input changes it", () => {
    const result = resolveNormalStudyDurationPrecedence(input({
      systemRecommendation: {
        minutes: 15,
        source: "profile_recommendation",
        ruleTrace: input().systemRecommendation.ruleTrace,
      },
    }));

    expect(result).toMatchObject({
      status: "resolved",
      timing: { activeMinutes: 15, durationSource: "profile_recommendation" },
    });
  });

  it("lets a one-session learner override replace the system recommendation", () => {
    const result = resolveNormalStudyDurationPrecedence(input({
      learnerOverrideMinutes: 45,
    }));

    expect(result).toMatchObject({
      status: "resolved",
      timing: { activeMinutes: 45, elapsedMinutes: 45, durationSource: "learner_override" },
    });
    expect(result.ruleTrace.at(-1)).toMatchObject({
      ruleId: "duration.learner_override",
      result: "selected_45_minutes",
    });
  });

  it("keeps availability as a hard maximum even after a learner override", () => {
    const result = resolveNormalStudyDurationPrecedence(input({
      learnerOverrideMinutes: 60,
      hardMaximumMinutes: 20,
    }));

    expect(result).toMatchObject({
      status: "resolved",
      timing: {
        activeMinutes: 15,
        elapsedMinutes: 15,
        durationSource: "availability_cap",
        hardMaximumMinutes: 20,
      },
    });
    expect(result.ruleTrace.slice(-2).map((entry) => entry.ruleId)).toEqual([
      "duration.learner_override",
      "duration.availability_cap",
    ]);
  });

  it("floors an arbitrary cap to the largest normal duration that fits", () => {
    const result = resolveNormalStudyDurationPrecedence(input({
      hardMaximumMinutes: 20,
    }));

    expect(result).toMatchObject({
      status: "resolved",
      timing: {
        activeMinutes: 15,
        durationSource: "availability_cap",
        hardMaximumMinutes: 20,
      },
    });
  });

  it("records an exact cap without mislabeling it as the source of an unchanged duration", () => {
    const result = resolveNormalStudyDurationPrecedence(input({
      hardMaximumMinutes: 25,
    }));

    expect(result).toMatchObject({
      status: "resolved",
      timing: {
        activeMinutes: 25,
        durationSource: "router_default",
        hardMaximumMinutes: 25,
      },
    });
    expect(result.ruleTrace.at(-1)?.result).toBe("recommended_duration_fits");
  });

  it("never raises a shorter recommendation merely because more time is available", () => {
    const result = resolveNormalStudyDurationPrecedence(input({
      systemRecommendation: {
        minutes: 10,
        source: "profile_recommendation",
        ruleTrace: input().systemRecommendation.ruleTrace,
      },
      hardMaximumMinutes: 60,
    }));

    expect(result).toMatchObject({
      status: "resolved",
      timing: {
        activeMinutes: 10,
        durationSource: "profile_recommendation",
        hardMaximumMinutes: 60,
      },
    });
  });

  it("returns an explicit insufficient-time result below the normal-session minimum", () => {
    const result = resolveNormalStudyDurationPrecedence(input({
      hardMaximumMinutes: 9,
    }));

    expect(result).toMatchObject({
      status: "insufficient_time",
      minimumMinutes: 10,
      hardMaximumMinutes: 9,
    });
    expect(result).not.toHaveProperty("timing");
    expect(result.ruleTrace.at(-1)).toMatchObject({
      ruleId: "duration.availability_cap",
      result: "insufficient_normal_session_time",
    });
  });

  it("accepts truthful observed-outcome provenance from the system recommender", () => {
    const result = resolveNormalStudyDurationPrecedence(input({
      systemRecommendation: {
        minutes: 15,
        source: "observed_outcome_adjustment",
        ruleTrace: input().systemRecommendation.ruleTrace,
      },
    }));

    expect(result).toMatchObject({
      status: "resolved",
      timing: { activeMinutes: 15, durationSource: "observed_outcome_adjustment" },
    });
  });

  it("rejects noncanonical recommendations, overrides, sources, traces, and malformed caps", () => {
    const noncanonicalSystem = input();
    (noncanonicalSystem.systemRecommendation as { minutes: number }).minutes = 20;
    expect(() => resolveNormalStudyDurationPrecedence(noncanonicalSystem)).toThrow(/one of 10, 15, 25, 45, 60/i);

    const noncanonicalOverride = input();
    (noncanonicalOverride as { learnerOverrideMinutes: number }).learnerOverrideMinutes = 30;
    expect(() => resolveNormalStudyDurationPrecedence(noncanonicalOverride)).toThrow(/one of 10, 15, 25, 45, 60/i);

    const invalidSource = input();
    (invalidSource.systemRecommendation as { source: string }).source = "learner_override";
    expect(() => resolveNormalStudyDurationPrecedence(invalidSource))
      .toThrow(/router default, the learner profile, or comparable observed outcomes/i);

    const missingTrace = input({
      systemRecommendation: {
        ...input().systemRecommendation,
        ruleTrace: [],
      },
    });
    expect(() => resolveNormalStudyDurationPrecedence(missingTrace))
      .toThrow(/at least one rule-trace entry/i);

    expect(() => resolveNormalStudyDurationPrecedence(input({ hardMaximumMinutes: 20.5 })))
      .toThrow(/whole number from 1 to 240/i);
    expect(() => resolveNormalStudyDurationPrecedence(input({ hardMaximumMinutes: 241 })))
      .toThrow(/whole number from 1 to 240/i);
  });

  it("is deterministic, does not mutate its input, and returns deeply frozen results", () => {
    const currentInput = input({
      learnerOverrideMinutes: 45,
      hardMaximumMinutes: 20,
    });
    const before = structuredClone(currentInput);

    const first = resolveNormalStudyDurationPrecedence(currentInput);
    const second = resolveNormalStudyDurationPrecedence(currentInput);

    expect(first).toEqual(second);
    expect(currentInput).toEqual(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.ruleTrace)).toBe(true);
    expect(Object.isFrozen(first.ruleTrace[0])).toBe(true);
    if (first.status === "resolved") expect(Object.isFrozen(first.timing)).toBe(true);
  });

  it("keeps the original recommendation trace stable in a one-signal counterfactual", () => {
    const baseline = resolveNormalStudyDurationPrecedence(input());
    const overridden = resolveNormalStudyDurationPrecedence(input({
      learnerOverrideMinutes: 45,
    }));

    expect(overridden.ruleTrace.slice(0, baseline.ruleTrace.length)).toEqual(baseline.ruleTrace);
    expect(baseline).toMatchObject({
      status: "resolved",
      timing: { activeMinutes: 25, durationSource: "router_default" },
    });
    expect(overridden).toMatchObject({
      status: "resolved",
      timing: { activeMinutes: 45, durationSource: "learner_override" },
    });
  });
});
