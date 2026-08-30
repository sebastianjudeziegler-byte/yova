import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsupportedBroadRecallInterruptionError } from "@/lib/sync/session-interruption-error";
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
  readQueuedSessionInterruptionsForExport,
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
    expect(recordAuthenticatedSessionInterruption).toHaveBeenCalledWith(
      pending.userId,
      pending.interruption,
    );
  });

  it("queues a Broad Recall Exit without its device-only activity marker", async () => {
    installMemoryStorage();
    recordAuthenticatedSessionInterruption.mockResolvedValue(undefined);
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
    expect(loadQueuedSessionInterruptions(pending.userId)).toEqual([{
      ...pending,
      interruption: expect.not.objectContaining({
        activityProgress: expect.anything(),
      }),
    }]);
    expect(pending.interruption).toHaveProperty("activityProgress");

    await expect(flushQueuedSessionInterruptions(pending.userId)).resolves.toEqual({
      synced: 1,
      remaining: 0,
    });
    expect(recordAuthenticatedSessionInterruption).toHaveBeenCalledWith(
      pending.userId,
      expect.not.objectContaining({ activityProgress: expect.anything() }),
    );
  });

  it("sanitizes a stale Broad Recall entry without blocking a later supported Exit", async () => {
    installMemoryStorage();
    recordAuthenticatedSessionInterruption.mockResolvedValue(undefined);
    const userId = "00000000-0000-4000-8000-000000000051";
    const staleBroad: PendingSessionInterruption = {
      userId,
      queuedAt: "2026-08-11T20:08:00.000Z",
      interruption: {
        id: "00000000-0000-4000-8000-000000000052",
        planId: "00000000-0000-4000-8000-000000000053",
        planSessionId: "00000000-0000-4000-8000-000000000054",
        routeRevisionId: "00000000-0000-4000-8000-000000000055",
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
          events: [],
        },
      },
    };
    const supported: PendingSessionInterruption = {
      userId,
      queuedAt: "2026-08-11T20:10:00.000Z",
      interruption: {
        id: "00000000-0000-4000-8000-000000000056",
        planId: "00000000-0000-4000-8000-000000000057",
        planSessionId: "00000000-0000-4000-8000-000000000058",
        startedAt: "2026-08-11T20:02:00.000Z",
        interruptedAt: "2026-08-11T20:10:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 8,
        completedSteps: 2,
        totalSteps: 5,
      },
    };
    const storedQueue = JSON.stringify([staleBroad, supported]);
    window.localStorage.setItem("yova.session-interruption-outbox.v1", storedQueue);

    const sanitizedBroad = {
      ...staleBroad,
      interruption: { ...staleBroad.interruption },
    };
    delete sanitizedBroad.interruption.activityProgress;
    expect(readQueuedSessionInterruptionsForExport(userId)).toEqual({
      ok: true,
      value: [sanitizedBroad, supported],
    });
    expect(JSON.parse(window.localStorage.getItem("yova.session-interruption-outbox.v1") ?? "[]"))
      .toEqual([sanitizedBroad, supported]);
    expect(recordAuthenticatedSessionInterruption).not.toHaveBeenCalled();

    // Re-seed the legacy queue so the normal startup flush, independently of
    // the export reader above, proves the poison pill is migrated on load.
    window.localStorage.setItem("yova.session-interruption-outbox.v1", storedQueue);
    await expect(flushQueuedSessionInterruptions(userId)).resolves.toEqual({
      synced: 2,
      remaining: 0,
    });
    expect(window.localStorage.getItem("yova.session-interruption-outbox.v1")).toBeNull();
    expect(recordAuthenticatedSessionInterruption).toHaveBeenCalledTimes(2);
    expect(recordAuthenticatedSessionInterruption).toHaveBeenNthCalledWith(
      1,
      staleBroad.userId,
      sanitizedBroad.interruption,
    );
    expect(recordAuthenticatedSessionInterruption).toHaveBeenNthCalledWith(
      2,
      supported.userId,
      supported.interruption,
    );
  });

  it("discards a server-classified retired marker without blocking a later exit", async () => {
    installMemoryStorage();
    recordAuthenticatedSessionInterruption
      .mockRejectedValueOnce(new UnsupportedBroadRecallInterruptionError())
      .mockResolvedValueOnce(undefined);
    const userId = "00000000-0000-4000-8000-000000000061";
    const first: PendingSessionInterruption = {
      userId,
      queuedAt: "2026-08-11T20:08:00.000Z",
      interruption: {
        id: "00000000-0000-4000-8000-000000000062",
        planId: "00000000-0000-4000-8000-000000000063",
        planSessionId: "00000000-0000-4000-8000-000000000064",
        startedAt: "2026-08-11T20:00:00.000Z",
        interruptedAt: "2026-08-11T20:08:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 8,
        completedSteps: 0,
        totalSteps: 5,
      },
    };
    const second: PendingSessionInterruption = {
      ...first,
      queuedAt: "2026-08-11T20:10:00.000Z",
      interruption: {
        ...first.interruption,
        id: "00000000-0000-4000-8000-000000000065",
        interruptedAt: "2026-08-11T20:10:00.000Z",
      },
    };
    expect(queueSessionInterruption(first)).toBe(true);
    expect(queueSessionInterruption(second)).toBe(true);

    await expect(flushQueuedSessionInterruptions(userId)).resolves.toEqual({
      synced: 1,
      remaining: 0,
    });
    expect(recordAuthenticatedSessionInterruption).toHaveBeenNthCalledWith(
      1,
      first.userId,
      first.interruption,
    );
    expect(recordAuthenticatedSessionInterruption).toHaveBeenNthCalledWith(
      2,
      second.userId,
      second.interruption,
    );
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
      pending.userId,
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
