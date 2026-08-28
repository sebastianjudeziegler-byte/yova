import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingSessionInterruption } from "@/lib/sync/session-interruption-outbox";

const { recordAuthenticatedSessionInterruption } = vi.hoisted(() => ({
  recordAuthenticatedSessionInterruption: vi.fn(),
}));

vi.mock("@/lib/supabase/learning-state-repository", () => ({
  recordAuthenticatedSessionInterruption,
}));

import {
  flushQueuedSessionInterruptions,
  loadQueuedSessionInterruptions,
  pendingSessionInterruptionRunIds,
  queueSessionInterruption,
  removeQueuedSessionInterruptionsForPlan,
} from "@/lib/sync/session-interruption-outbox";

function installMemoryStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("session interruption outbox", () => {
  it("retains the full lesson setup while an interruption waits to sync", async () => {
    installMemoryStorage();
    recordAuthenticatedSessionInterruption.mockResolvedValue(undefined);
    const pending: PendingSessionInterruption = {
      userId: "00000000-0000-4000-8000-000000000001",
      queuedAt: "2026-08-11T20:08:00.000Z",
      interruption: {
        id: "00000000-0000-4000-8000-000000000002",
        planId: "00000000-0000-4000-8000-000000000003",
        planSessionId: "00000000-0000-4000-8000-000000000004",
        startedAt: "2026-08-11T20:00:00.000Z",
        interruptedAt: "2026-08-11T20:08:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 8,
        completedSteps: 2,
        totalSteps: 5,
        sessionAdjustment: {
          familiarity: "need_teaching",
          availableMinutes: 20,
          knownTargets: ["ATP coupling"],
          note: "Connect this to cellular respiration.",
        },
        activityProgress: {
          kind: "retrieval_round",
          activityIndex: 0,
          promptCount: 3,
          ratings: ["partly"],
        },
      },
    };

    expect(queueSessionInterruption(pending)).toBe(true);
    expect(loadQueuedSessionInterruptions(pending.userId)[0]?.interruption).not.toHaveProperty("routeRevisionId");
    expect(pendingSessionInterruptionRunIds(pending.userId)).toEqual([
      pending.interruption.id,
    ]);
    await expect(flushQueuedSessionInterruptions(pending.userId)).resolves.toEqual({
      synced: 1,
      remaining: 0,
    });
    expect(recordAuthenticatedSessionInterruption).toHaveBeenCalledWith(pending.interruption);
  });

  it("round-trips strict broad-recall progress without inventing ratings", () => {
    installMemoryStorage();
    const pending: PendingSessionInterruption = {
      userId: "00000000-0000-4000-8000-000000000041",
      queuedAt: "2026-08-11T20:08:00.000Z",
      interruption: {
        id: "00000000-0000-4000-8000-000000000042",
        planId: "00000000-0000-4000-8000-000000000043",
        planSessionId: "00000000-0000-4000-8000-000000000044",
        routeRevisionId: "00000000-0000-4000-8000-000000000045",
        startedAt: "2026-08-11T20:00:00.000Z",
        interruptedAt: "2026-08-11T20:08:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 8,
        completedSteps: 0,
        totalSteps: 5,
        activityProgress: {
          kind: "broad_recall",
          format: "broad_recall_v1",
          activityIndex: 0,
          gapCount: 2,
          bindings: [{
            targetId: "11111111-1111-4111-8111-111111111111",
            evidenceId: "blurting-final-check:11111111-1111-4111-8111-111111111111",
          }],
          events: [{
            type: "comparison_completed",
            gapStatuses: ["covered", "missing"],
          }],
        },
      },
    };

    expect(queueSessionInterruption(pending)).toBe(true);
    const restored = loadQueuedSessionInterruptions(pending.userId)[0];

    expect(restored).toEqual(pending);
    expect(restored?.interruption.activityProgress).not.toHaveProperty("ratings");

    expect(queueSessionInterruption({
      ...pending,
      interruption: {
        ...pending.interruption,
        routeRevisionId: undefined,
      },
    })).toBe(false);
    expect(loadQueuedSessionInterruptions(pending.userId)).toEqual([pending]);
  });

  it("removes only one account's entries for a permanently deleted plan", () => {
    installMemoryStorage();
    const base: PendingSessionInterruption = {
      userId: "00000000-0000-4000-8000-000000000001",
      queuedAt: "2026-08-11T20:08:00.000Z",
      interruption: {
        id: "00000000-0000-4000-8000-000000000002",
        planId: "00000000-0000-4000-8000-000000000003",
        planSessionId: "00000000-0000-4000-8000-000000000004",
        startedAt: "2026-08-11T20:00:00.000Z",
        interruptedAt: "2026-08-11T20:08:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 8,
        completedSteps: 2,
        totalSteps: 5,
      },
    };
    const sibling: PendingSessionInterruption = {
      ...base,
      interruption: {
        ...base.interruption,
        id: "00000000-0000-4000-8000-000000000012",
        planId: "00000000-0000-4000-8000-000000000013",
      },
    };
    queueSessionInterruption(base);
    queueSessionInterruption(sibling);

    expect(removeQueuedSessionInterruptionsForPlan(base.userId, base.interruption.planId)).toBe(true);
    expect(pendingSessionInterruptionRunIds(base.userId)).toEqual([sibling.interruption.id]);
  });

  it("preserves route identity on an interruption and its evidence snapshot", async () => {
    installMemoryStorage();
    recordAuthenticatedSessionInterruption.mockResolvedValue(undefined);
    const routeRevisionId = "00000000-0000-4000-8000-000000000025";
    const pending: PendingSessionInterruption = {
      userId: "00000000-0000-4000-8000-000000000021",
      queuedAt: "2026-08-11T20:08:00.000Z",
      interruption: {
        id: "00000000-0000-4000-8000-000000000022",
        planId: "00000000-0000-4000-8000-000000000023",
        planSessionId: "00000000-0000-4000-8000-000000000024",
        routeRevisionId,
        startedAt: "2026-08-11T20:00:00.000Z",
        interruptedAt: "2026-08-11T20:08:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 8,
        completedSteps: 2,
        totalSteps: 5,
        evidence: {
          correctAnswers: 1,
          totalAnswers: 1,
          conceptEvidence: [{
            routeRevisionId,
            concept: "ATP coupling",
            outcome: "secure",
            activityType: "free_response",
          }],
          confidenceEvidence: [{
            routeRevisionId,
            concept: "ATP coupling",
            confidence: "very_sure",
            correct: true,
            activityType: "free_response",
          }],
          observedGap: "No major gap detected.",
          completedImmediateRepairs: 0,
        },
      },
    };

    expect(queueSessionInterruption(pending)).toBe(true);
    expect(loadQueuedSessionInterruptions(pending.userId)[0]?.interruption).toEqual(pending.interruption);

    await flushQueuedSessionInterruptions(pending.userId);

    expect(recordAuthenticatedSessionInterruption).toHaveBeenCalledWith(
      expect.objectContaining({
        routeRevisionId,
        evidence: expect.objectContaining({
          conceptEvidence: [expect.objectContaining({ routeRevisionId })],
          confidenceEvidence: [expect.objectContaining({ routeRevisionId })],
        }),
      }),
    );
  });
});
