import { describe, expect, it } from "vitest";
import {
  buildContentBasedReplacementSessions,
  learningPlanSessionToAdjustableRow,
  PlanAdjustmentPartLimitError,
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

  it("does not pad a session that already fits the requested window", () => {
    const sessions = buildContentBasedReplacementSessions([
      { ...originalSession, estimated_minutes: 8 },
    ], 10, 1);

    expect(sessions.map((session) => session.estimatedMinutes)).toEqual([8]);
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
});
