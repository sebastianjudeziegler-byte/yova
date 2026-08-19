import { describe, expect, it } from "vitest";
import type { LearningPlanSession } from "@/lib/domain";
import {
  buildUnguidedVerificationSession,
  canLoadBuiltInFallbackWithCompletion,
  canScheduleUnguidedVerification,
} from "@/lib/learning/unguided-verification";
import { MAX_RUNTIME_PLAN_SESSIONS } from "@/lib/plan-generation/schema";

const completedSession: LearningPlanSession = {
  id: "6ce5ee69-03d5-4df9-8506-47bf3950eaa0",
  sequence: 4,
  title: "Trace thermohaline circulation",
  objective: "Explain how temperature and salinity drive deep-ocean circulation.",
  method: "Self-explanation",
  methodReason: "Explain the source in your own words.",
  scheduledFor: "2026-08-19T16:00:00.000Z",
  estimatedMinutes: 20,
  amountLabel: "One explanation · about 20 min",
  learningMode: "study",
  topicIds: [
    "9a87ade4-678a-4a60-934f-35dc05d08158",
    "45d0c6ae-e018-4edc-afac-aed35e8bc304",
  ],
  contentTargets: [
    "Density changes from temperature and salinity",
    "Deep-water formation and global circulation",
  ],
  completionEvidence: [
    "Explain how both temperature and salinity change seawater density.",
    "Apply the mechanism to a change in polar surface water.",
  ],
  status: "ready",
};

describe("buildUnguidedVerificationSession", () => {
  it("copies the exact topic and completion contract into the immediate guided check", () => {
    const result = buildUnguidedVerificationSession({
      completedSession,
      completedAt: "2026-08-19T16:20:00.000Z",
      verificationId: "f341ca07-ae20-488c-8b6f-f9fc861f0388",
      planSessionCount: 14,
    });

    expect(result).toMatchObject({
      sequence: 5,
      method: "Independent retrieval verification",
      learningMode: "study",
      estimatedMinutes: 10,
      reviewType: "verify",
      status: "ready",
      scheduledFor: "2026-08-20T16:20:00.000Z",
    });
    if (!result) throw new Error("Expected a verification session.");
    expect(result.topicIds).toEqual(completedSession.topicIds);
    expect(result.contentTargets).toEqual(completedSession.contentTargets);
    expect(result.completionEvidence).toEqual(completedSession.completionEvidence);
    expect(result.topicIds).not.toBe(completedSession.topicIds);
    expect(result.objective).toContain("every original target");
    expect(result.methodReason).toContain("practice, not proof");
  });

  it("fails closed for a legacy session without a topic mapping", () => {
    const result = buildUnguidedVerificationSession({
      completedSession: {
        ...completedSession,
        title: "Arbitrary legacy topic",
        topicIds: undefined,
        contentTargets: undefined,
        completionEvidence: undefined,
      },
      completedAt: "2026-08-19T16:20:00.000Z",
      verificationId: "f341ca07-ae20-488c-8b6f-f9fc861f0388",
      planSessionCount: 1,
    });

    expect(result).toBeNull();
  });

  it("rebuilds the same verification identity for a replayed completion", () => {
    const input = {
      completedSession,
      completedAt: "2026-08-19T16:20:00.000Z",
      verificationId: "f341ca07-ae20-488c-8b6f-f9fc861f0388",
      planSessionCount: 14,
    };

    expect(buildUnguidedVerificationSession(input))
      .toEqual(buildUnguidedVerificationSession({ ...input }));
  });

  it("fails closed for a verification replay or a plan at the runtime bound", () => {
    expect(canScheduleUnguidedVerification({ ...completedSession, reviewType: "verify" }, 2)).toBe(false);
    expect(canScheduleUnguidedVerification(completedSession, MAX_RUNTIME_PLAN_SESSIONS)).toBe(false);
    expect(buildUnguidedVerificationSession({
      completedSession: { ...completedSession, reviewType: "verify" },
      completedAt: "2026-08-19T16:20:00.000Z",
      verificationId: "f341ca07-ae20-488c-8b6f-f9fc861f0388",
      planSessionCount: 2,
    })).toBeNull();
  });

  it("requires the complete mapped target contract before offering ungraded completion", () => {
    expect(canScheduleUnguidedVerification({ ...completedSession, contentTargets: [] }, 14)).toBe(false);
    expect(canScheduleUnguidedVerification({ ...completedSession, completionEvidence: [] }, 14)).toBe(false);
    expect(canScheduleUnguidedVerification({ ...completedSession, topicIds: ["not-a-uuid"] }, 14)).toBe(false);
  });

  it("blocks only unguided built-in fallbacks when verification cannot be scheduled", () => {
    const capped = {
      session: completedSession,
      planSessionCount: MAX_RUNTIME_PLAN_SESSIONS,
    };

    expect(canLoadBuiltInFallbackWithCompletion({ fallbackKind: "generic_inside", ...capped })).toBe(false);
    expect(canLoadBuiltInFallbackWithCompletion({ fallbackKind: "outside_source", ...capped })).toBe(false);
    expect(canLoadBuiltInFallbackWithCompletion({ fallbackKind: "subject_specific", ...capped })).toBe(true);
    expect(canLoadBuiltInFallbackWithCompletion({
      fallbackKind: "outside_source",
      session: { ...completedSession, completionEvidence: [] },
      planSessionCount: 14,
    })).toBe(false);
  });
});
