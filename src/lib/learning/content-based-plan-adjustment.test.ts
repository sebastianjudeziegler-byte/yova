import { describe, expect, it } from "vitest";
import { buildContentBasedReplacementSessions } from "@/lib/learning/content-based-plan-adjustment";

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

  it("rebalances small remainders instead of creating an unusable five-minute session", () => {
    const sessions = buildContentBasedReplacementSessions([
      { ...originalSession, estimated_minutes: 20 },
    ], 15, 1);

    expect(sessions.map((session) => session.estimatedMinutes)).toEqual([10, 10]);
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
