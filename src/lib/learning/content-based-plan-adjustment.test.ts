import { describe, expect, it } from "vitest";
import {
  buildContentBasedReplacementSessions,
  buildProtectedPlanAdjustmentSessions,
  learningPlanSessionToAdjustableRow,
  mergeAuthoritativeProtectedPlanAdjustmentSession,
  PlanAdjustmentPartLimitError,
  sessionStepDataHasSavedWork,
} from "@/lib/learning/content-based-plan-adjustment";
import { recoverySessionMinutes } from "@/lib/scheduling/recovery";

const originalSession = {
  id: "10000000-1000-4000-8000-100000000001",
  sequence: 1,
  title: "Build the cellular respiration model",
  objective: "Understand glycolysis, the Krebs cycle, and the electron transport chain.",
  method: "Guided concept repair",
  method_rationale: "A complete model comes before independent retrieval.",
  scheduled_for: "2026-08-07T18:00:00.000Z",
  estimated_minutes: 45,
  status: "ready" as const,
  step_data: {
    learningMode: "learn",
    contentTargets: ["Glycolysis", "Krebs cycle", "Electron transport chain"],
    completionEvidence: ["Explain each stage", "Connect the stages in order"],
  },
};

function adjustableRow(
  session: ReturnType<typeof buildContentBasedReplacementSessions>[number],
  status?: "ready" | "upcoming",
) {
  return learningPlanSessionToAdjustableRow({
    ...session,
    status: status ?? session.status,
  });
}

describe("content-based plan adjustment", () => {
  it("turns one 45-minute content block into three 15-minute slices", () => {
    const sessions = buildContentBasedReplacementSessions([originalSession], 15, 1);

    expect(sessions).toHaveLength(3);
    expect(sessions.map((session) => session.estimatedMinutes)).toEqual([15, 15, 15]);
    expect(sessions[0].status).toBe("ready");
    expect(sessions[1].status).toBe("upcoming");
    expect(sessions.flatMap((session) => session.contentTargets)).toEqual([
      "Glycolysis",
      "Krebs cycle",
      "Electron transport chain",
    ]);
  });

  it("gives every split part the requested window instead of creating a short remainder", () => {
    const sessions = buildContentBasedReplacementSessions([
      { ...originalSession, estimated_minutes: 20 },
    ], 15, 1);

    expect(sessions.map((session) => session.estimatedMinutes)).toEqual([15, 15]);
  });

  it("keeps the shortest recovery split runnable and matches its advertised duration", () => {
    const advertisedMinutes = recoverySessionMinutes(15);
    const sessions = buildContentBasedReplacementSessions([
      { ...originalSession, estimated_minutes: 15 },
    ], advertisedMinutes, 1);

    expect(advertisedMinutes).toBe(10);
    expect(sessions.map((session) => session.estimatedMinutes)).toEqual([advertisedMinutes, advertisedMinutes]);
    expect(Math.min(...sessions.map((session) => session.estimatedMinutes))).toBe(10);
  });

  it("uses persisted content minutes when the same split is rebuilt", () => {
    const split = buildContentBasedReplacementSessions([
      { ...originalSession, estimated_minutes: 15 },
    ], 10, 1);
    const rebuilt = buildContentBasedReplacementSessions(
      split.map((session) => adjustableRow(session)),
      10,
      1,
    );

    expect(split.map((session) => session.estimatedMinutes)).toEqual([10, 10]);
    expect(adjustableRow(split[0]).step_data).toMatchObject({
      originSessionId: originalSession.id,
      originalContentMinutes: 15,
      segmentIndex: 1,
      segmentCount: 2,
    });
    expect(rebuilt.map((session) => session.estimatedMinutes)).toEqual([10, 10]);
    expect(rebuilt.map((session) => session.originalContentMinutes)).toEqual([15, 15]);
  });

  it("keeps one remaining split part at the runnable window without losing its content metadata", () => {
    const split = buildContentBasedReplacementSessions([
      { ...originalSession, estimated_minutes: 15 },
    ], 10, 1);
    const priorRemainder = split[1];
    const rebuilt = buildContentBasedReplacementSessions([
      adjustableRow(priorRemainder, "ready"),
    ], 10, 1);

    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]).toMatchObject({
      estimatedMinutes: 10,
      originSessionId: originalSession.id,
      originalContentMinutes: 7,
      segmentIndex: 1,
      segmentCount: 1,
      topicIds: priorRemainder.topicIds,
      contentTargets: priorRemainder.contentTargets,
      completionEvidence: priorRemainder.completionEvidence,
    });
  });

  it("raises a legacy undersized session to the runnable floor", () => {
    const sessions = buildContentBasedReplacementSessions([
      { ...originalSession, estimated_minutes: 8 },
    ], 10, 1);

    expect(sessions.map((session) => session.estimatedMinutes)).toEqual([10]);
  });

  it("fails before emitting a partial plan when one origin needs more than fourteen parts", () => {
    expect(() => buildContentBasedReplacementSessions([
      { ...originalSession, estimated_minutes: 150 },
    ], 10, 1)).toThrow(PlanAdjustmentPartLimitError);
  });

  it("fails before dropping later origins when the aggregate exceeds fourteen parts", () => {
    const originals = Array.from({ length: 8 }, (_, index) => ({
      ...originalSession,
      id: `10000000-1000-4000-8000-${String(index + 2).padStart(12, "0")}`,
      sequence: index + 1,
      estimated_minutes: 20,
    }));

    expect(() => buildContentBasedReplacementSessions(originals, 10, 1))
      .toThrow("Choose a longer session window");
  });

  it("keeps every origin when the aggregate is exactly fourteen parts", () => {
    const originals = Array.from({ length: 7 }, (_, index) => ({
      ...originalSession,
      id: `10000000-1000-4000-8000-${String(index + 2).padStart(12, "0")}`,
      sequence: index + 1,
      estimated_minutes: 20,
    }));
    const sessions = buildContentBasedReplacementSessions(originals, 10, 1);

    expect(sessions).toHaveLength(14);
    expect(new Set(sessions.map((session) => session.originSessionId))).toEqual(
      new Set(originals.map((session) => session.id)),
    );
  });

  it("counts settled sessions against the plan-wide fourteen-session limit", () => {
    expect(() => buildContentBasedReplacementSessions([
      { ...originalSession, estimated_minutes: 15 },
    ], 10, 14, 1)).toThrow(PlanAdjustmentPartLimitError);

    const oneRemainingPart = buildContentBasedReplacementSessions([
      { ...originalSession, estimated_minutes: 10 },
    ], 10, 14, 1);
    expect(oneRemainingPart).toHaveLength(1);
  });

  it("keeps replacement content in chronological learning order when original sessions shared a date", () => {
    const sessions = buildContentBasedReplacementSessions([
      originalSession,
      {
        ...originalSession,
        id: "10000000-1000-4000-8000-100000000002",
        sequence: 2,
        title: "Apply the cellular respiration model",
        status: "upcoming" as const,
      },
    ], 15, 1);

    const scheduledTimes = sessions.map((session) => new Date(session.scheduledFor).getTime());
    expect(scheduledTimes).toEqual([...scheduledTimes].sort((left, right) => left - right));
    expect(new Set(scheduledTimes).size).toBe(scheduledTimes.length);
  });

  it("preserves a scheduled verification verbatim while rebuilding ordinary content around it", () => {
    const review = {
      ...originalSession,
      id: "10000000-1000-4000-8000-100000000099",
      sequence: 2,
      title: "Verify membrane transport",
      objective: "Answer three self-contained questions about membrane transport.",
      method: "Independent retrieval verification",
      method_rationale: "This is a delayed return to the exact concept.",
      scheduled_for: "2026-08-09T18:00:00.000Z",
      estimated_minutes: 5,
      status: "upcoming" as const,
      step_data: {
        amountLabel: "Verify in 2 days · about 5 min",
        learningMode: "study",
        topicIds: ["20000000-2000-4000-8000-200000000001"],
        contentTargets: ["Membrane transport"],
        completionEvidence: ["Answer three independent questions"],
        reviewConcept: "Membrane transport",
        reviewType: "verify",
        generatedSession: { id: "review-resource-must-stay-in-storage" },
      },
    };
    const laterContent = {
      ...originalSession,
      id: "10000000-1000-4000-8000-100000000100",
      sequence: 3,
      status: "upcoming" as const,
      scheduled_for: "2026-08-10T18:00:00.000Z",
      estimated_minutes: 20,
    };

    const sessions = buildProtectedPlanAdjustmentSessions(
      [originalSession, review, laterContent],
      15,
      1,
    );
    const preserved = sessions.find((session) => session.id === review.id);
    const later = sessions.filter((session) => (
      "originSessionId" in session && session.originSessionId === laterContent.id
    ));

    expect(preserved).toMatchObject({
      id: review.id,
      title: review.title,
      objective: review.objective,
      method: review.method,
      methodReason: review.method_rationale,
      scheduledFor: review.scheduled_for,
      estimatedMinutes: 5,
      amountLabel: "Verify in 2 days · about 5 min",
      reviewConcept: "Membrane transport",
      reviewType: "verify",
      protected: true,
      status: "upcoming",
    });
    expect(later).toHaveLength(2);
    expect(later.every((session) => session.status === "upcoming")).toBe(true);
  });

  it("counts protected reviews against the plan-wide replacement limit", () => {
    const review = {
      ...originalSession,
      id: "10000000-1000-4000-8000-100000000099",
      sequence: 2,
      status: "upcoming" as const,
      estimated_minutes: 5,
      step_data: {
        learningMode: "study",
        reviewConcept: "Cellular respiration",
        reviewType: "maintenance_transfer",
      },
    };

    expect(() => buildProtectedPlanAdjustmentSessions(
      [{ ...originalSession, estimated_minutes: 20 }, review],
      10,
      13,
      2,
    )).toThrow(PlanAdjustmentPartLimitError);
  });

  it("carries review metadata across the preview row boundary", () => {
    const row = learningPlanSessionToAdjustableRow({
      id: "10000000-1000-4000-8000-100000000099",
      sequence: 1,
      title: "Verify osmosis",
      objective: "Use three independent checks.",
      method: "Independent retrieval verification",
      methodReason: "Return after a delay.",
      scheduledFor: "2026-08-09T18:00:00.000Z",
      estimatedMinutes: 5,
      amountLabel: "Verify in 2 days · about 5 min",
      learningMode: "study",
      status: "ready",
      reviewConcept: "Osmosis",
      reviewType: "verify",
    });

    expect(row.step_data).toMatchObject({
      reviewConcept: "Osmosis",
      reviewType: "verify",
    });
  });

  it("uses authoritative protected-review fields while preserving browser-only lesson state", () => {
    const original = {
      id: "10000000-1000-4000-8000-100000000099",
      sequence: 2,
      title: "Old review title",
      objective: "Old objective",
      method: "Old method",
      methodReason: "Old reason",
      scheduledFor: "2026-08-09T18:00:00.000Z",
      estimatedMinutes: 5,
      amountLabel: "Old return · about 5 min",
      learningMode: "study" as const,
      topicIds: ["20000000-2000-4000-8000-200000000001"],
      contentTargets: ["Old review target"],
      completionEvidence: ["Old evidence"],
      status: "upcoming" as const,
      reviewConcept: "Old concept",
      reviewType: "verify" as const,
      resource: {
        rationale: "Prepared before the concurrent schedule change.",
        activities: [],
        generatedAt: "2026-08-08T18:00:00.000Z",
        origin: "generated" as const,
      },
      adaptationNote: {
        explanation: "Keep this learner-visible note.",
        adaptedAt: "2026-08-08T19:00:00.000Z",
      },
    };
    const authoritative = {
      id: original.id,
      sequence: 4,
      title: "Authoritative review title",
      objective: "Answer the authoritative verification questions.",
      method: "Independent retrieval verification",
      methodReason: "The committed review contract wins.",
      scheduledFor: "2026-08-11T09:30:00+00:00",
      estimatedMinutes: 7,
      amountLabel: "Verify in 3 days · about 7 min",
      learningMode: "study" as const,
      topicIds: ["20000000-2000-4000-8000-200000000002"],
      contentTargets: ["Authoritative review target"],
      completionEvidence: ["Answer three authoritative questions"],
      status: "ready" as const,
      reviewConcept: "Authoritative concept",
      reviewType: "maintenance_transfer" as const,
    };

    expect(mergeAuthoritativeProtectedPlanAdjustmentSession(original, authoritative))
      .toEqual({
        ...original,
        ...authoritative,
        resource: original.resource,
        adaptationNote: original.adaptationNote,
      });
  });

  it("recognizes generated lessons and checkpoints as saved work", () => {
    expect(sessionStepDataHasSavedWork({ generatedSession: { activities: [] } })).toBe(true);
    expect(sessionStepDataHasSavedWork({ activeSessionCheckpoint: { completedSteps: 1 } })).toBe(true);
    expect(sessionStepDataHasSavedWork({ reviewType: "verify" })).toBe(false);
  });
});
