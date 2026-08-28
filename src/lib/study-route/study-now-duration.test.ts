import { describe, expect, it, vi } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import type { NormalDurationOutcome } from "@/lib/study-route/duration-recommendation";
import {
  decideStudyNowDuration,
  reconcileStudyNowDuration,
  STUDY_NOW_DURATION_RECONCILIATION_MAX_BUILDS,
  type StudyNowDurationContext,
} from "@/lib/study-route/study-now-duration";

const NOW = new Date("2026-08-23T10:00:00.000Z");

function request(maximumMinutes = 60) {
  return PlanGenerationRequestSchema.parse({
    intent: "study_now",
    learningIntent: "learn",
    goal: "Understand how photosynthesis converts light energy into stored chemical energy.",
    startingContext: "I have not learned this process yet.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: null,
    timeZone: "UTC",
    diagnosticResponses: [],
    availability: [{ day: "Sunday", window: "Now", minutes: maximumMinutes }],
    profileSummary: "Use concise explanations with one concrete worked example.",
  });
}

function emptyProfile(): StudyNowDurationContext["profile"] {
  return {
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
  };
}

function context(
  overrides: Partial<StudyNowDurationContext> = {},
): StudyNowDurationContext {
  return {
    profileVersion: "duration_context_v1:empty",
    profile: emptyProfile(),
    recentOutcomes: [],
    ...overrides,
  };
}

function preliminary(maximumMinutes = 60) {
  return generatePreviewPlan(request(maximumMinutes), NOW);
}

function stableOutcome(
  index: number,
  plan: LearningPlan,
): NormalDurationOutcome {
  const route = plan.sessions[0]!.studyRoute!;
  return {
    kind: "completion",
    sessionClass: "normal",
    taskFamily: route.target.taskFamily,
    mode: route.approach.mode,
    occurredAt: `2026-08-${String(18 + index).padStart(2, "0")}T10:25:00.000Z`,
    routeRevisionId: `00000000-0000-4000-8000-00000000000${index}`,
    plannedMinutes: 25,
    actualMinutes: 25,
    correctAnswers: 4,
    totalAnswers: 5,
    feedback: "about_right",
    evidenceRef: `completion:${index}`,
  };
}

describe("Study Now duration decision composition", () => {
  it("uses the router default and treats the learner's time as a hard maximum", () => {
    const result = decideStudyNowDuration({
      preliminaryPlan: preliminary(20),
      context: context(),
      scheduledWindow: "morning",
      hardMaximumMinutes: 20,
    });

    expect(result).toMatchObject({
      status: "resolved",
      decision: {
        timing: {
          activeMinutes: 15,
          durationSource: "availability_cap",
          hardMaximumMinutes: 20,
        },
      },
    });
  });

  it("uses an authorized sustainable baseline without filling all available time", () => {
    const result = decideStudyNowDuration({
      preliminaryPlan: preliminary(60),
      context: context({
        profileVersion: "duration_context_v1:profile",
        profile: {
          ...emptyProfile(),
          sustainableMinutes: 10,
          evidenceRefs: {
            ...emptyProfile().evidenceRefs,
            sustainableMinutes: ["profile:onboarding:2"],
          },
        },
      }),
      scheduledWindow: "morning",
      hardMaximumMinutes: 60,
    });

    expect(result).toMatchObject({
      status: "resolved",
      decision: {
        timing: { activeMinutes: 10, durationSource: "profile_recommendation" },
      },
    });
  });

  it("uses only comparable normal outcome evidence and records its source truthfully", () => {
    const plan = preliminary(60);
    const result = decideStudyNowDuration({
      preliminaryPlan: plan,
      context: context({
        profileVersion: "duration_context_v1:history",
        recentOutcomes: [1, 2, 3, 4].map((index) => stableOutcome(index, plan)),
      }),
      scheduledWindow: "morning",
      hardMaximumMinutes: 60,
    });

    expect(result).toMatchObject({
      status: "resolved",
      decision: {
        timing: { activeMinutes: 45, durationSource: "observed_outcome_adjustment" },
      },
    });
  });

  it("returns an explicit insufficient result rather than creating a five-minute lesson", () => {
    const result = decideStudyNowDuration({
      preliminaryPlan: preliminary(5),
      context: context(),
      scheduledWindow: "morning",
      hardMaximumMinutes: 5,
    });

    expect(result).toMatchObject({
      status: "insufficient_time",
      minimumMinutes: 10,
      hardMaximumMinutes: 5,
    });
  });

  it("rejects normal plans, lightweight reviews, and non-provisional routes", () => {
    const normalPlan = structuredClone(preliminary());
    normalPlan.creationIntent = "plan";
    expect(() => decideStudyNowDuration({
      preliminaryPlan: normalPlan,
      context: context(),
      scheduledWindow: null,
      hardMaximumMinutes: 60,
    })).toThrow(/exactly one preliminary focused session/i);

    const review = structuredClone(preliminary());
    review.sessions[0]!.reviewType = "verify";
    expect(() => decideStudyNowDuration({
      preliminaryPlan: review,
      context: context(),
      scheduledWindow: null,
      hardMaximumMinutes: 60,
    })).toThrow(/lightweight review/i);

    const committed = structuredClone(preliminary());
    committed.sessions[0]!.studyRoute!.identity.lifecycleStatus = "committed";
    committed.sessions[0]!.studyRoute!.identity.committedAt = NOW.toISOString();
    expect(() => decideStudyNowDuration({
      preliminaryPlan: committed,
      context: context(),
      scheduledWindow: null,
      hardMaximumMinutes: 60,
    })).toThrow(/not an exact provisional/i);
  });

  it("is deterministic, non-mutating, and deeply freezes the decision", () => {
    const plan = preliminary(20);
    const currentContext = context();
    const before = structuredClone({ plan, currentContext });
    const first = decideStudyNowDuration({
      preliminaryPlan: plan,
      context: currentContext,
      scheduledWindow: "morning",
      hardMaximumMinutes: 20,
    });
    const second = decideStudyNowDuration({
      preliminaryPlan: plan,
      context: currentContext,
      scheduledWindow: "morning",
      hardMaximumMinutes: 20,
    });

    expect(first).toEqual(second);
    expect({ plan, currentContext }).toEqual(before);
    expect(Object.isFrozen(first)).toBe(true);
    if (first.status === "resolved") {
      expect(Object.isFrozen(first.decision)).toBe(true);
      expect(Object.isFrozen(first.decision.ruleTrace)).toBe(true);
    }
  });
});

describe("Study Now duration reconciliation", () => {
  it("returns one immutable final plan when the first canonical context is stable", () => {
    const initialPlan = preliminary(20);
    const currentContext = context();
    const before = structuredClone({ initialPlan, currentContext });
    let callbackPlan: LearningPlan | null = null;
    const buildPlan = vi.fn((decision) => {
      callbackPlan = generatePreviewPlan(request(20), NOW, {
        studyNowDurationDecision: decision,
      });
      return callbackPlan;
    });

    const result = reconcileStudyNowDuration({
      preliminaryPlan: initialPlan,
      context: currentContext,
      scheduledWindow: "morning",
      hardMaximumMinutes: 20,
      buildPlan,
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("The fixture must resolve.");
    expect(buildPlan).toHaveBeenCalledTimes(1);
    expect(result.plan.sessions[0]).toMatchObject({
      estimatedMinutes: 15,
      studyRoute: {
        timing: {
          activeMinutes: 15,
          durationSource: "availability_cap",
          hardMaximumMinutes: 20,
        },
      },
    });
    expect({ initialPlan, currentContext }).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.plan)).toBe(true);
    expect(Object.isFrozen(result.plan.sessions[0])).toBe(true);
    expect(callbackPlan).not.toBeNull();
    expect(Object.isFrozen(callbackPlan!)).toBe(false);
    expect(result.plan).not.toBe(callbackPlan);
  });

  it("recomputes once and returns only the plan matching the drifted mode", () => {
    const initialPlan = preliminary(60);
    const initialMode = initialPlan.sessions[0]!.studyRoute!.approach.mode;
    const driftedMode = initialMode === "learn" ? "practice" : "learn";
    let buildCount = 0;

    const result = reconcileStudyNowDuration({
      preliminaryPlan: initialPlan,
      context: context(),
      scheduledWindow: "morning",
      hardMaximumMinutes: 60,
      buildPlan: (decision) => {
        buildCount += 1;
        const candidate = generatePreviewPlan(request(60), NOW, {
          studyNowDurationDecision: decision,
        });
        candidate.sessions[0]!.learningMode = driftedMode === "learn" ? "learn" : "study";
        candidate.sessions[0]!.studyRoute!.approach.mode = driftedMode;
        return candidate;
      },
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("The fixture must resolve.");
    expect(buildCount).toBe(2);
    expect(result.recommendationContext.mode).toBe(driftedMode);
    expect(result.plan.sessions[0]!.studyRoute!.approach.mode).toBe(driftedMode);
  });

  it("fails after three builds when canonical task context oscillates", () => {
    const initialPlan = preliminary(60);
    const initialTaskFamily = initialPlan.sessions[0]!.studyRoute!.target.taskFamily;
    const otherTaskFamily = initialTaskFamily === "memorization"
      ? "conceptual_learning"
      : "memorization";
    let buildCount = 0;

    expect(() => reconcileStudyNowDuration({
      preliminaryPlan: initialPlan,
      context: context(),
      scheduledWindow: "morning",
      hardMaximumMinutes: 60,
      buildPlan: (decision) => {
        buildCount += 1;
        const candidate = generatePreviewPlan(request(60), NOW, {
          studyNowDurationDecision: decision,
        });
        candidate.sessions[0]!.studyRoute!.target.taskFamily = buildCount % 2 === 1
          ? otherTaskFamily
          : initialTaskFamily;
        return candidate;
      },
    })).toThrow(
      `did not converge after ${STUDY_NOW_DURATION_RECONCILIATION_MAX_BUILDS} bounded builds`,
    );
    expect(buildCount).toBe(STUDY_NOW_DURATION_RECONCILIATION_MAX_BUILDS);
  });

  it("returns insufficient time without invoking the plan builder", () => {
    const buildPlan = vi.fn();
    const result = reconcileStudyNowDuration({
      preliminaryPlan: preliminary(5),
      context: context(),
      scheduledWindow: "morning",
      hardMaximumMinutes: 5,
      buildPlan,
    });

    expect(result).toMatchObject({
      status: "insufficient_time",
      minimumMinutes: 10,
      hardMaximumMinutes: 5,
    });
    expect(buildPlan).not.toHaveBeenCalled();
  });
});
