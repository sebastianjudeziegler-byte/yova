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

  it("joins an in-flight Exit flush instead of sending the same terminal twice", async () => {
    installMemoryStorage();
    let release!: () => void;
    recordAuthenticatedSessionInterruption.mockImplementationOnce(() => (
      new Promise<void>((resolve) => {
        release = resolve;
      })
    ));
    const pending: PendingSessionInterruption = {
      userId: "00000000-0000-4000-8000-000000000061",
      queuedAt: "2026-08-11T20:08:00.000Z",
      interruption: {
        id: "00000000-0000-4000-8000-000000000062",
        planId: "00000000-0000-4000-8000-000000000063",
        planSessionId: "00000000-0000-4000-8000-000000000064",
        startedAt: "2026-08-11T20:00:00.000Z",
        interruptedAt: "2026-08-11T20:08:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 8,
        completedSteps: 2,
        totalSteps: 5,
      },
    };
    expect(queueSessionInterruption(pending)).toBe(true);

    const exitFlush = flushQueuedSessionInterruptions(pending.userId);
    const retryFlush = flushQueuedSessionInterruptions(pending.userId);

    expect(exitFlush).toBe(retryFlush);
    expect(recordAuthenticatedSessionInterruption).toHaveBeenCalledOnce();
    release();
    await expect(Promise.all([exitFlush, retryFlush])).resolves.toEqual([
      { synced: 1, remaining: 0 },
      { synced: 1, remaining: 0 },
    ]);
    expect(recordAuthenticatedSessionInterruption).toHaveBeenCalledOnce();
  });

  it("drains one Exit queued after the shared flight has already started", async () => {
    installMemoryStorage();
    let releaseFirst!: () => void;
    recordAuthenticatedSessionInterruption
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }))
      .mockResolvedValue(undefined);
    const first: PendingSessionInterruption = {
      userId: "00000000-0000-4000-8000-000000000081",
      queuedAt: "2026-08-11T20:08:00.000Z",
      interruption: {
        id: "00000000-0000-4000-8000-000000000082",
        planId: "00000000-0000-4000-8000-000000000083",
        planSessionId: "00000000-0000-4000-8000-000000000084",
        startedAt: "2026-08-11T20:00:00.000Z",
        interruptedAt: "2026-08-11T20:08:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 8,
        completedSteps: 2,
        totalSteps: 5,
      },
    };
    const late: PendingSessionInterruption = {
      userId: first.userId,
      queuedAt: "2026-08-11T20:10:00.000Z",
      interruption: {
        ...first.interruption,
        id: "00000000-0000-4000-8000-000000000085",
        planSessionId: "00000000-0000-4000-8000-000000000086",
        startedAt: "2026-08-11T20:09:00.000Z",
        interruptedAt: "2026-08-11T20:10:00.000Z",
      },
    };
    expect(queueSessionInterruption(first)).toBe(true);

    const exitFlush = flushQueuedSessionInterruptions(first.userId);
    expect(recordAuthenticatedSessionInterruption).toHaveBeenCalledOnce();
    expect(queueSessionInterruption(late)).toBe(true);
    const retryFlush = flushQueuedSessionInterruptions(first.userId);

    expect(retryFlush).toBe(exitFlush);
    releaseFirst();
    await expect(Promise.all([exitFlush, retryFlush])).resolves.toEqual([
      { synced: 2, remaining: 0 },
      { synced: 2, remaining: 0 },
    ]);
    expect(recordAuthenticatedSessionInterruption).toHaveBeenCalledTimes(2);
    expect(recordAuthenticatedSessionInterruption).toHaveBeenNthCalledWith(
      2,
      late.userId,
      late.interruption,
    );
  });

  it("starts one fresh Exit flush after the joined attempt fails", async () => {
    installMemoryStorage();
    const pending: PendingSessionInterruption = {
      userId: "00000000-0000-4000-8000-000000000071",
      queuedAt: "2026-08-11T20:08:00.000Z",
      interruption: {
        id: "00000000-0000-4000-8000-000000000072",
        planId: "00000000-0000-4000-8000-000000000073",
        planSessionId: "00000000-0000-4000-8000-000000000074",
        startedAt: "2026-08-11T20:00:00.000Z",
        interruptedAt: "2026-08-11T20:08:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 8,
        completedSteps: 2,
        totalSteps: 5,
      },
    };
    expect(queueSessionInterruption(pending)).toBe(true);
    recordAuthenticatedSessionInterruption
      .mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(flushQueuedSessionInterruptions(pending.userId)).resolves.toEqual({
      synced: 0,
      remaining: 1,
    });
    await expect(flushQueuedSessionInterruptions(pending.userId)).resolves.toEqual({
      synced: 1,
      remaining: 0,
    });
    expect(recordAuthenticatedSessionInterruption).toHaveBeenCalledTimes(2);
  });

  it("queues an old Exit without its retired activity marker", async () => {
    installMemoryStorage();
    recordAuthenticatedSessionInterruption.mockResolvedValue(undefined);
    const pending = {
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
          legacyPayload: "ignored",
        },
      },
    } as unknown as PendingSessionInterruption;

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

  it("sanitizes a stale retired marker without blocking a later supported Exit", async () => {
    installMemoryStorage();
    recordAuthenticatedSessionInterruption.mockResolvedValue(undefined);
    const userId = "00000000-0000-4000-8000-000000000051";
    const staleRetired = {
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
          legacyPayload: "ignored",
        },
      },
    } as unknown as PendingSessionInterruption;
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
    const storedQueue = JSON.stringify([staleRetired, supported]);
    window.localStorage.setItem("yova.session-interruption-outbox.v1", storedQueue);

    const sanitizedRetired = {
      ...staleRetired,
      interruption: { ...staleRetired.interruption },
    };
    delete sanitizedRetired.interruption.activityProgress;
    expect(readQueuedSessionInterruptionsForExport(userId)).toEqual({
      ok: true,
      value: [sanitizedRetired, supported],
    });
    expect(JSON.parse(window.localStorage.getItem("yova.session-interruption-outbox.v1") ?? "[]"))
      .toEqual([sanitizedRetired, supported]);
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
      staleRetired.userId,
      sanitizedRetired.interruption,
    );
    expect(recordAuthenticatedSessionInterruption).toHaveBeenNthCalledWith(
      2,
      supported.userId,
      supported.interruption,
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
