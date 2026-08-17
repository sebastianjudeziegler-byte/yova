import { describe, expect, it } from "vitest";
import { cloudCheckpointResponseIsCurrent } from "@/lib/learning/active-session-cloud-sync";

describe("cloud checkpoint response lifecycle", () => {
  it("accepts only a response from the current account lifecycle", () => {
    expect(cloudCheckpointResponseIsCurrent({
      requestedEpoch: 4,
      currentEpoch: 4,
      runId: "run-current",
      discardedRunIds: new Set(),
    })).toBe(true);
    expect(cloudCheckpointResponseIsCurrent({
      requestedEpoch: 3,
      currentEpoch: 4,
      runId: "run-before-sign-out",
      discardedRunIds: new Set(),
    })).toBe(false);
  });

  it("rejects a late response after completion or explicit Exit", () => {
    expect(cloudCheckpointResponseIsCurrent({
      requestedEpoch: 4,
      currentEpoch: 4,
      runId: "run-finished",
      discardedRunIds: new Set(["run-finished"]),
    })).toBe(false);
  });
});
