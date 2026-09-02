import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingSessionCompletion } from "@/lib/sync/session-completion-outbox";
import type { PendingSessionInterruption } from "@/lib/sync/session-interruption-outbox";

const repository = vi.hoisted(() => ({
  completeAuthenticatedPlanSession: vi.fn(),
  recordAuthenticatedSessionInterruption: vi.fn(),
}));

vi.mock("@/lib/supabase/learning-state-repository", () => repository);

import {
  loadQueuedSessionCompletions,
  queueSessionCompletion,
  readQueuedSessionCompletionsForExport,
} from "@/lib/sync/session-completion-outbox";
import {
  loadQueuedSessionInterruptions,
  queueSessionInterruption,
  readQueuedSessionInterruptionsForExport,
} from "@/lib/sync/session-interruption-outbox";
import {
  flushQueuedSessionTerminals,
  reconcileQueuedSessionTerminalsAgainstAuthority,
  type AuthoritativeSessionTerminalInventory,
} from "@/lib/sync/session-terminal-outbox";

const userId = "50000000-0000-4000-8000-000000000001";
const planId = "50000000-0000-4000-8000-000000000002";

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

function pendingExit(planSessionId: string, suffix: string): PendingSessionInterruption {
  return {
    userId,
    queuedAt: "2026-09-02T09:05:00.000Z",
    interruption: {
      id: `50000000-0000-4000-8000-0000000000${suffix}`,
      planId,
      planSessionId,
      startedAt: "2026-09-02T09:00:00.000Z",
      interruptedAt: "2026-09-02T09:05:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 5,
      completedSteps: 1,
      totalSteps: 4,
    },
  };
}

function pendingCompletion(planSessionId: string, suffix: string): PendingSessionCompletion {
  return {
    userId,
    queuedAt: "2026-09-02T09:20:00.000Z",
    completion: {
      id: `50000000-0000-4000-8000-0000000000${suffix}`,
      planId,
      planSessionId,
      startedAt: "2026-09-02T09:06:00.000Z",
      completedAt: "2026-09-02T09:20:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 14,
      correctAnswers: 3,
      totalAnswers: 4,
      feedback: "about_right",
      observedGap: "One explanation still needs a delayed check.",
      conceptEvidence: [],
      confidenceEvidence: [],
    },
    adaptation: null,
    followUpSession: null,
  };
}

function reconcileFromFullCloudRead(
  authority: Partial<AuthoritativeSessionTerminalInventory>
    & Pick<AuthoritativeSessionTerminalInventory, "sessions">,
) {
  return reconcileQueuedSessionTerminalsAgainstAuthority(userId, {
    completions: [],
    interruptions: [],
    ...authority,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("terminal outbox reconciliation against authoritative session state", () => {
  it("retires missing-target warnings while preserving both payloads for export", () => {
    installMemoryStorage();
    const missingSessionId = "50000000-0000-4000-8000-000000000003";
    expect(queueSessionInterruption(pendingExit(missingSessionId, "04"))).toBe(true);
    expect(queueSessionCompletion(pendingCompletion(missingSessionId, "05"))).toBe(true);

    expect(reconcileFromFullCloudRead({ sessions: [] })).toMatchObject({
      remaining: 0,
      storageSaved: true,
    });
    expect(loadQueuedSessionInterruptions(userId)).toEqual([]);
    expect(loadQueuedSessionCompletions(userId)).toEqual([]);
    expect(readQueuedSessionInterruptionsForExport(userId)).toMatchObject({
      ok: true,
      value: [expect.objectContaining({
        interruption: expect.objectContaining({ id: expect.any(String) }),
      })],
    });
    expect(readQueuedSessionCompletionsForExport(userId)).toMatchObject({
      ok: true,
      value: [expect.objectContaining({
        completion: expect.objectContaining({ id: expect.any(String) }),
      })],
    });
  });

  it.each(["complete", "skipped"] as const)(
    "retires both active markers when the authoritative session is %s without a receipt",
    (status) => {
      installMemoryStorage();
      const terminalSessionId = "50000000-0000-4000-8000-000000000006";
      expect(queueSessionInterruption(pendingExit(terminalSessionId, "07"))).toBe(true);
      expect(queueSessionCompletion(pendingCompletion(terminalSessionId, "08"))).toBe(true);

      expect(reconcileFromFullCloudRead({
        sessions: [{ id: terminalSessionId, status }],
      })).toMatchObject({ remaining: 0 });
      expect(loadQueuedSessionInterruptions(userId)).toEqual([]);
      expect(loadQueuedSessionCompletions(userId)).toEqual([]);
    },
  );

  it("retains both retryable markers when their authoritative target is still ready", () => {
    installMemoryStorage();
    const readySessionId = "50000000-0000-4000-8000-000000000009";
    expect(queueSessionInterruption(pendingExit(readySessionId, "10"))).toBe(true);
    expect(queueSessionCompletion(pendingCompletion(readySessionId, "11"))).toBe(true);

    expect(reconcileFromFullCloudRead({
      sessions: [{ id: readySessionId, status: "ready" }],
    })).toMatchObject({ remaining: 2 });
    expect(loadQueuedSessionInterruptions(userId)).toHaveLength(1);
    expect(loadQueuedSessionCompletions(userId)).toHaveLength(1);
  });

  it("quarantines only the stale-route event when the same ready session has a current event", () => {
    installMemoryStorage();
    const planSessionId = "50000000-0000-4000-8000-000000000023";
    const oldRouteRevisionId = "50000000-0000-4000-8000-000000000024";
    const currentRouteRevisionId = "50000000-0000-4000-8000-000000000025";
    const staleExit = pendingExit(planSessionId, "26");
    staleExit.interruption.routeRevisionId = oldRouteRevisionId;
    const currentCompletion = pendingCompletion(planSessionId, "27");
    currentCompletion.completion.routeRevisionId = currentRouteRevisionId;
    expect(queueSessionInterruption(staleExit)).toBe(true);
    expect(queueSessionCompletion(currentCompletion)).toBe(true);

    expect(reconcileFromFullCloudRead({
      sessions: [{
        id: planSessionId,
        status: "ready",
        routeRevisionId: currentRouteRevisionId,
      }],
    })).toMatchObject({
      interruptions: { remaining: 0 },
      completions: { remaining: 1 },
      remaining: 1,
    });
    expect(loadQueuedSessionInterruptions(userId)).toEqual([]);
    expect(loadQueuedSessionCompletions(userId)).toHaveLength(1);
    expect(readQueuedSessionInterruptionsForExport(userId)).toMatchObject({
      ok: true,
      value: [expect.objectContaining({
        interruption: expect.objectContaining({ id: staleExit.interruption.id }),
      })],
    });
  });

  it("uses exact route parity while preserving events when route authority is unknown", () => {
    const planSessionId = "50000000-0000-4000-8000-000000000028";
    const routeRevisionId = "50000000-0000-4000-8000-000000000029";

    installMemoryStorage();
    expect(queueSessionCompletion(pendingCompletion(planSessionId, "30"))).toBe(true);
    expect(reconcileFromFullCloudRead({
      sessions: [{ id: planSessionId, status: "ready", routeRevisionId }],
    })).toMatchObject({ remaining: 0 });
    expect(readQueuedSessionCompletionsForExport(userId)).toMatchObject({
      ok: true,
      value: [expect.any(Object)],
    });

    installMemoryStorage();
    expect(queueSessionCompletion(pendingCompletion(planSessionId, "31"))).toBe(true);
    expect(reconcileFromFullCloudRead({
      sessions: [{ id: planSessionId, status: "ready" }],
    })).toMatchObject({ remaining: 1 });

    installMemoryStorage();
    expect(queueSessionCompletion(pendingCompletion(planSessionId, "32"))).toBe(true);
    expect(reconcileFromFullCloudRead({
      sessions: [{ id: planSessionId, status: "ready", routeRevisionId: null }],
    })).toMatchObject({ remaining: 1 });
  });

  it("keeps a stale-route event active when its recovery copy cannot be stored", () => {
    const values = new Map<string, string>();
    let rejectQuarantine = false;
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (rejectQuarantine && key.startsWith("yova.session-terminal-quarantine.v1:")) {
            throw new Error("storage unavailable");
          }
          values.set(key, value);
        },
        removeItem: (key: string) => values.delete(key),
      },
    });
    const planSessionId = "50000000-0000-4000-8000-000000000033";
    const oldRouteRevisionId = "50000000-0000-4000-8000-000000000034";
    const currentRouteRevisionId = "50000000-0000-4000-8000-000000000035";
    const stale = pendingCompletion(planSessionId, "36");
    stale.completion.routeRevisionId = oldRouteRevisionId;
    expect(queueSessionCompletion(stale)).toBe(true);
    rejectQuarantine = true;

    expect(reconcileFromFullCloudRead({
      sessions: [{
        id: planSessionId,
        status: "ready",
        routeRevisionId: currentRouteRevisionId,
      }],
    })).toMatchObject({ remaining: 1, storageSaved: false });
    expect(loadQueuedSessionCompletions(userId)).toHaveLength(1);
  });

  it("syncs unrelated valid work before authoritative reconciliation retires a poison Exit", async () => {
    installMemoryStorage();
    const missingSessionId = "50000000-0000-4000-8000-000000000012";
    const readySessionId = "50000000-0000-4000-8000-000000000013";
    expect(queueSessionInterruption(pendingExit(missingSessionId, "14"))).toBe(true);
    expect(queueSessionCompletion(pendingCompletion(readySessionId, "15"))).toBe(true);
    repository.recordAuthenticatedSessionInterruption.mockRejectedValue(
      new Error("The active session was not found."),
    );
    repository.completeAuthenticatedPlanSession.mockResolvedValue(undefined);

    await expect(flushQueuedSessionTerminals(userId)).resolves.toMatchObject({ remaining: 1 });
    expect(repository.completeAuthenticatedPlanSession).toHaveBeenCalledOnce();
    expect(reconcileFromFullCloudRead({
      sessions: [{ id: readySessionId, status: "ready" }],
    })).toMatchObject({ remaining: 0 });
    await expect(flushQueuedSessionTerminals(userId)).resolves.toMatchObject({ remaining: 0 });
    expect(repository.completeAuthenticatedPlanSession).toHaveBeenCalledOnce();
  });

  it("uses receipts as proof while keeping ready and upcoming targets retryable", () => {
    installMemoryStorage();
    const completedSessionId = "50000000-0000-4000-8000-000000000016";
    const readySessionId = "50000000-0000-4000-8000-000000000017";
    const upcomingSessionId = "50000000-0000-4000-8000-000000000018";
    const completedExit = pendingExit(completedSessionId, "19");
    const completed = pendingCompletion(completedSessionId, "20");
    expect(queueSessionInterruption(completedExit)).toBe(true);
    expect(queueSessionCompletion(completed)).toBe(true);
    expect(queueSessionInterruption(pendingExit(readySessionId, "21"))).toBe(true);
    expect(queueSessionCompletion(pendingCompletion(upcomingSessionId, "22"))).toBe(true);

    expect(reconcileFromFullCloudRead({
      sessions: [
        { id: completedSessionId, status: "complete" },
        { id: readySessionId, status: "ready" },
        { id: upcomingSessionId, status: "upcoming" },
      ],
      completions: [{
        id: completed.completion.id,
        planSessionId: completedSessionId,
      }],
      interruptions: [],
    })).toMatchObject({ remaining: 2, storageSaved: true });
    expect(loadQueuedSessionInterruptions(userId).map((entry) => entry.interruption.planSessionId))
      .toEqual([readySessionId]);
    expect(loadQueuedSessionCompletions(userId).map((entry) => entry.completion.planSessionId))
      .toEqual([upcomingSessionId]);
  });
});
