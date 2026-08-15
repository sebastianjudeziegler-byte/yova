import { describe, expect, it } from "vitest";
import {
  isSessionOverdue,
  latestRecoveryInterruptionEvidenceRef,
  recoverySessionMinutes,
  tomorrowAtSessionTime,
} from "@/lib/scheduling/recovery";

describe("missed-session recovery", () => {
  const now = new Date("2026-08-05T20:00:00.000Z");

  it("waits through a meaningful grace period before offering recovery", () => {
    expect(isSessionOverdue("2026-08-05T15:30:00.000Z", now)).toBe(true);
    expect(isSessionOverdue("2026-08-05T17:00:00.000Z", now)).toBe(false);
    expect(isSessionOverdue("not-a-date", now)).toBe(false);
  });

  it("turns longer work into a bounded recovery session", () => {
    expect(recoverySessionMinutes(60)).toBe(20);
    expect(recoverySessionMinutes(30)).toBe(15);
    expect(recoverySessionMinutes(15)).toBe(10);
  });

  it("moves an old session to tomorrow while keeping its local clock time", () => {
    const moved = new Date(tomorrowAtSessionTime("2026-08-02T16:30:00.000Z", now));
    expect(moved.getUTCDate()).toBe(6);
    expect(moved.getUTCHours()).toBe(16);
    expect(moved.getUTCMinutes()).toBe(30);
  });

  it("links a recovery reason only to the latest interruption for that session", () => {
    expect(latestRecoveryInterruptionEvidenceRef([
      {
        id: "older",
        planId: "plan",
        planSessionId: "target-session",
        startedAt: "2026-08-04T16:00:00.000Z",
        interruptedAt: "2026-08-04T16:05:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 5,
        completedSteps: 1,
        totalSteps: 4,
      },
      {
        id: "other-session",
        planId: "plan",
        planSessionId: "different-session",
        startedAt: "2026-08-06T16:00:00.000Z",
        interruptedAt: "2026-08-06T16:05:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 5,
        completedSteps: 1,
        totalSteps: 4,
      },
      {
        id: "latest",
        planId: "plan",
        planSessionId: "target-session",
        startedAt: "2026-08-05T16:00:00.000Z",
        interruptedAt: "2026-08-05T16:05:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 5,
        completedSteps: 1,
        totalSteps: 4,
      },
    ], "target-session")).toBe("latest");
  });
});
