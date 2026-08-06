import { describe, expect, it } from "vitest";
import type { SessionInterruption } from "@/lib/domain";
import { resumableSessionProgress } from "@/lib/learning/session-resume";

function interruption(
  id: string,
  completedSteps: number,
  interruptedAt: string,
  planSessionId = "session-1",
): SessionInterruption {
  return {
    id,
    planId: "plan-1",
    planSessionId,
    startedAt: "2026-08-06T18:00:00.000Z",
    interruptedAt,
    plannedMinutes: 25,
    actualMinutes: 5,
    completedSteps,
    totalSteps: 5,
  };
}

describe("resumableSessionProgress", () => {
  it("returns the latest valid interruption after a learner stops more than once", () => {
    const result = resumableSessionProgress("session-1", [
      interruption("first", 1, "2026-08-06T18:05:00.000Z"),
      interruption("second", 3, "2026-08-06T18:15:00.000Z"),
    ]);

    expect(result?.id).toBe("second");
    expect(result?.completedSteps).toBe(3);
  });

  it("ignores another session and interruptions without a usable resume point", () => {
    const result = resumableSessionProgress("session-1", [
      interruption("not-started", 0, "2026-08-06T18:20:00.000Z"),
      interruption("finished", 5, "2026-08-06T18:25:00.000Z"),
      interruption("other-session", 2, "2026-08-06T18:30:00.000Z", "session-2"),
    ]);

    expect(result).toBeNull();
  });
});
