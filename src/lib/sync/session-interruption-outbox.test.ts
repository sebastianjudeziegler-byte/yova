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
  reconcileQueuedSessionInterruptions,
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
  return values;
}

function interruptionPending({
  userId,
  interruptionId,
  planSessionId,
  planId = "30000000-0000-4000-8000-000000000001",
}: {
  userId: string;
  interruptionId: string;
  planSessionId: string;
  planId?: string;
}): PendingSessionInterruption {
  return {
    userId,
    queuedAt: "2026-08-11T20:08:00.000Z",
    interruption: {
      id: interruptionId,
      planId,
      planSessionId,
      startedAt: "2026-08-11T20:00:00.000Z",
      interruptedAt: "2026-08-11T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      completedSteps: 2,
      totalSteps: 5,
    },
  };
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

  it("continues with unrelated sessions after one Exit fails", async () => {
    installMemoryStorage();
    const userId = "30000000-0000-4000-8000-000000000091";
    const blockedSessionId = "30000000-0000-4000-8000-000000000092";
    const unrelatedSessionId = "30000000-0000-4000-8000-000000000093";
    const blocked = interruptionPending({
      userId,
      interruptionId: "30000000-0000-4000-8000-000000000094",
      planSessionId: blockedSessionId,
    });
    const sameSessionLater = interruptionPending({
      userId,
      interruptionId: "30000000-0000-4000-8000-000000000095",
      planSessionId: blockedSessionId,
    });
    const unrelated = interruptionPending({
      userId,
      interruptionId: "30000000-0000-4000-8000-000000000096",
      planSessionId: unrelatedSessionId,
    });
    [blocked, sameSessionLater, unrelated].forEach((entry) => {
      expect(queueSessionInterruption(entry)).toBe(true);
    });
    recordAuthenticatedSessionInterruption.mockImplementation(async (_userId, interruption) => {
      if (interruption.planSessionId === blockedSessionId) {
        throw new Error("target temporarily unavailable");
      }
    });

    await expect(flushQueuedSessionInterruptions(userId)).resolves.toEqual({
      synced: 1,
      remaining: 2,
    });
    expect(recordAuthenticatedSessionInterruption).toHaveBeenCalledTimes(2);
    expect(recordAuthenticatedSessionInterruption.mock.calls.map(([, interruption]) => interruption.id))
      .toEqual([blocked.interruption.id, unrelated.interruption.id]);
    expect(loadQueuedSessionInterruptions(userId).map((entry) => entry.interruption.id))
      .toEqual([blocked.interruption.id, sameSessionLater.interruption.id]);
  });

  it("rejects new Exits that claim the session is already finished", () => {
    installMemoryStorage();
    const completed = interruptionPending({
      userId: "30000000-0000-4000-8000-000000000101",
      interruptionId: "30000000-0000-4000-8000-000000000102",
      planSessionId: "30000000-0000-4000-8000-000000000103",
    });
    completed.interruption.completedSteps = completed.interruption.totalSteps;
    expect(queueSessionInterruption(completed)).toBe(false);

    const invalidResume = interruptionPending({
      userId: "30000000-0000-4000-8000-000000000101",
      interruptionId: "30000000-0000-4000-8000-000000000104",
      planSessionId: "30000000-0000-4000-8000-000000000105",
    });
    invalidResume.interruption.resumeStep = invalidResume.interruption.totalSteps;
    expect(queueSessionInterruption(invalidResume)).toBe(false);
  });

  it("migrates a recognized legacy finished Exit to quarantine and keeps it exportable", () => {
    const values = installMemoryStorage();
    const legacy = interruptionPending({
      userId: "30000000-0000-4000-8000-000000000111",
      interruptionId: "30000000-0000-4000-8000-000000000112",
      planSessionId: "30000000-0000-4000-8000-000000000113",
    });
    legacy.interruption.completedSteps = legacy.interruption.totalSteps;
    legacy.interruption.resumeStep = legacy.interruption.totalSteps;
    values.set("yova.session-interruption-outbox.v1", JSON.stringify([legacy]));

    expect(loadQueuedSessionInterruptions(legacy.userId)).toEqual([]);
    expect(values.has("yova.session-interruption-outbox.v1")).toBe(false);
    expect(readQueuedSessionInterruptionsForExport(legacy.userId)).toEqual({
      ok: true,
      value: [legacy],
    });
    expect(recordAuthenticatedSessionInterruption).not.toHaveBeenCalled();
  });

  it("keeps a legacy invalid Exit active when quarantine storage is unavailable", () => {
    const values = installMemoryStorage();
    const legacy = interruptionPending({
      userId: "30000000-0000-4000-8000-000000000121",
      interruptionId: "30000000-0000-4000-8000-000000000122",
      planSessionId: "30000000-0000-4000-8000-000000000123",
    });
    legacy.interruption.completedSteps = legacy.interruption.totalSteps;
    values.set("yova.session-interruption-outbox.v1", JSON.stringify([legacy]));
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key.startsWith("yova.session-terminal-quarantine.v1")) {
            throw new Error("quarantine unavailable");
          }
          values.set(key, value);
        },
        removeItem: (key: string) => values.delete(key),
      },
    });

    expect(loadQueuedSessionInterruptions(legacy.userId)).toEqual([legacy]);
  });

  it("reconciles exact cloud Exit receipts for only the current account", () => {
    installMemoryStorage();
    const userId = "30000000-0000-4000-8000-000000000002";
    const otherUserId = "30000000-0000-4000-8000-000000000003";
    const planSessionId = "30000000-0000-4000-8000-000000000004";
    const exact = interruptionPending({
      userId,
      interruptionId: "30000000-0000-4000-8000-000000000005",
      planSessionId,
    });
    const retryable = interruptionPending({
      userId,
      interruptionId: "30000000-0000-4000-8000-000000000006",
      planSessionId,
    });
    const otherAccount = interruptionPending({
      userId: otherUserId,
      interruptionId: "30000000-0000-4000-8000-000000000007",
      planSessionId,
    });
    [exact, retryable, otherAccount].forEach((entry) => {
      expect(queueSessionInterruption(entry)).toBe(true);
    });

    expect(reconcileQueuedSessionInterruptions(userId, [{
      id: exact.interruption.id,
      planSessionId,
    }], [])).toEqual({
      removed: 1,
      remaining: 1,
      storageSaved: true,
    });
    expect(loadQueuedSessionInterruptions(userId).map((entry) => entry.interruption.id)).toEqual([
      retryable.interruption.id,
    ]);
    expect(loadQueuedSessionInterruptions(otherUserId).map((entry) => entry.interruption.id)).toEqual([
      otherAccount.interruption.id,
    ]);
  });

  it("lets an authoritative completion supersede a queued Exit for the same session", () => {
    installMemoryStorage();
    const userId = "30000000-0000-4000-8000-000000000012";
    const otherUserId = "30000000-0000-4000-8000-000000000013";
    const completedPlanSessionId = "30000000-0000-4000-8000-000000000014";
    const superseded = interruptionPending({
      userId,
      interruptionId: "30000000-0000-4000-8000-000000000015",
      planSessionId: completedPlanSessionId,
    });
    const retryable = interruptionPending({
      userId,
      interruptionId: "30000000-0000-4000-8000-000000000016",
      planSessionId: "30000000-0000-4000-8000-000000000017",
    });
    const otherAccount = interruptionPending({
      userId: otherUserId,
      interruptionId: "30000000-0000-4000-8000-000000000018",
      planSessionId: completedPlanSessionId,
    });
    [superseded, retryable, otherAccount].forEach((entry) => {
      expect(queueSessionInterruption(entry)).toBe(true);
    });

    expect(reconcileQueuedSessionInterruptions(userId, [], [completedPlanSessionId])).toEqual({
      removed: 1,
      remaining: 1,
      storageSaved: true,
    });
    expect(loadQueuedSessionInterruptions(userId).map((entry) => entry.interruption.id)).toEqual([
      retryable.interruption.id,
    ]);
    expect(loadQueuedSessionInterruptions(otherUserId).map((entry) => entry.interruption.id)).toEqual([
      otherAccount.interruption.id,
    ]);
  });

  it("keeps a non-retryable Exit active when quarantine storage fails", () => {
    const values = installMemoryStorage();
    const pending = interruptionPending({
      userId: "30000000-0000-4000-8000-000000000024",
      interruptionId: "30000000-0000-4000-8000-000000000025",
      planSessionId: "30000000-0000-4000-8000-000000000026",
    });
    expect(queueSessionInterruption(pending)).toBe(true);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key.startsWith("yova.session-terminal-quarantine.v1")) {
            throw new Error("quarantine unavailable");
          }
          values.set(key, value);
        },
        removeItem: (key: string) => values.delete(key),
      },
    });

    expect(reconcileQueuedSessionInterruptions(pending.userId, [], [], [{
      planSessionId: pending.interruption.planSessionId,
      reason: "target_complete",
    }])).toEqual({ removed: 0, remaining: 1, storageSaved: false });
    expect(loadQueuedSessionInterruptions(pending.userId)).toHaveLength(1);
  });

  it("cleans quarantined Exits by both account and plan", () => {
    installMemoryStorage();
    const userId = "30000000-0000-4000-8000-000000000027";
    const otherUserId = "30000000-0000-4000-8000-000000000028";
    const planId = "30000000-0000-4000-8000-000000000029";
    const keptPlanId = "30000000-0000-4000-8000-000000000030";
    const removed = interruptionPending({
      userId,
      interruptionId: "30000000-0000-4000-8000-000000000034",
      planSessionId: "30000000-0000-4000-8000-000000000035",
      planId,
    });
    const kept = interruptionPending({
      userId,
      interruptionId: "30000000-0000-4000-8000-000000000036",
      planSessionId: "30000000-0000-4000-8000-000000000037",
      planId: keptPlanId,
    });
    const otherAccount = interruptionPending({
      userId: otherUserId,
      interruptionId: "30000000-0000-4000-8000-000000000038",
      planSessionId: "30000000-0000-4000-8000-000000000039",
      planId,
    });
    [removed, kept, otherAccount].forEach((entry) => {
      expect(queueSessionInterruption(entry)).toBe(true);
    });
    expect(reconcileQueuedSessionInterruptions(userId, [], [], [removed, kept].map((entry) => ({
      planSessionId: entry.interruption.planSessionId,
      reason: "target_absent" as const,
    }))).remaining).toBe(0);
    expect(reconcileQueuedSessionInterruptions(otherUserId, [], [], [{
      planSessionId: otherAccount.interruption.planSessionId,
      reason: "target_absent",
    }]).remaining).toBe(0);

    expect(removeQueuedSessionInterruptionsForPlan(userId, planId)).toBe(true);
    expect(readQueuedSessionInterruptionsForExport(userId)).toMatchObject({
      ok: true,
      value: [expect.objectContaining({
        interruption: expect.objectContaining({ id: kept.interruption.id }),
      })],
    });
    expect(readQueuedSessionInterruptionsForExport(otherUserId)).toMatchObject({
      ok: true,
      value: [expect.objectContaining({
        interruption: expect.objectContaining({ id: otherAccount.interruption.id }),
      })],
    });
  });

  it("reports the actual remaining Exit count when reconciliation cannot be saved", () => {
    const values = installMemoryStorage();
    const pending = interruptionPending({
      userId: "30000000-0000-4000-8000-000000000021",
      interruptionId: "30000000-0000-4000-8000-000000000022",
      planSessionId: "30000000-0000-4000-8000-000000000023",
    });
    expect(queueSessionInterruption(pending)).toBe(true);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: () => { throw new Error("storage unavailable"); },
        removeItem: () => { throw new Error("storage unavailable"); },
      },
    });

    expect(reconcileQueuedSessionInterruptions(pending.userId, [{
      id: pending.interruption.id,
      planSessionId: pending.interruption.planSessionId,
    }], [])).toEqual({
      removed: 0,
      remaining: 1,
      storageSaved: false,
    });
  });

  it("retains and counts an Exit when server commit succeeds but local removal fails", async () => {
    const values = installMemoryStorage();
    const pending = interruptionPending({
      userId: "30000000-0000-4000-8000-000000000131",
      interruptionId: "30000000-0000-4000-8000-000000000132",
      planSessionId: "30000000-0000-4000-8000-000000000133",
    });
    expect(queueSessionInterruption(pending)).toBe(true);
    recordAuthenticatedSessionInterruption.mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: () => { throw new Error("storage unavailable"); },
        removeItem: () => { throw new Error("storage unavailable"); },
      },
    });

    await expect(flushQueuedSessionInterruptions(pending.userId)).resolves.toEqual({
      synced: 0,
      remaining: 1,
    });
    expect(recordAuthenticatedSessionInterruption).toHaveBeenCalledOnce();
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
