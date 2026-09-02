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
import { NonRetryableSessionTerminalMutationError } from "@/lib/sync/session-terminal-mutation-error";
import {
  flushQueuedSessionTerminals,
  reconcileQueuedSessionTerminalsAgainstAuthority,
} from "@/lib/sync/session-terminal-outbox";

const userId = "40000000-0000-4000-8000-000000000001";
const planId = "40000000-0000-4000-8000-000000000002";

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

function pendingExit(planSessionId: string): PendingSessionInterruption {
  return {
    userId,
    queuedAt: "2026-09-01T09:05:00.000Z",
    interruption: {
      id: "40000000-0000-4000-8000-000000000003",
      planId,
      planSessionId,
      startedAt: "2026-09-01T09:00:00.000Z",
      interruptedAt: "2026-09-01T09:05:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 5,
      completedSteps: 1,
      totalSteps: 4,
    },
  };
}

function pendingCompletion(planSessionId: string): PendingSessionCompletion {
  return {
    userId,
    queuedAt: "2026-09-01T09:20:00.000Z",
    completion: {
      id: "40000000-0000-4000-8000-000000000004",
      planId,
      planSessionId,
      startedAt: "2026-09-01T09:06:00.000Z",
      completedAt: "2026-09-01T09:20:00.000Z",
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

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("terminal outbox poison-entry recovery", () => {
  it("retires two permanently rejected events for a ready session without losing either payload", async () => {
    installMemoryStorage();
    const planSessionId = "40000000-0000-4000-8000-000000000009";
    expect(queueSessionInterruption(pendingExit(planSessionId))).toBe(true);
    expect(queueSessionCompletion(pendingCompletion(planSessionId))).toBe(true);
    repository.recordAuthenticatedSessionInterruption.mockRejectedValue(
      new NonRetryableSessionTerminalMutationError(
        "interruption",
        "incompatible_cloud_state",
      ),
    );
    repository.completeAuthenticatedPlanSession.mockRejectedValue(
      new NonRetryableSessionTerminalMutationError(
        "completion",
        "incompatible_cloud_state",
      ),
    );

    expect(reconcileQueuedSessionTerminalsAgainstAuthority(userId, {
      sessions: [{ id: planSessionId, status: "ready" }],
      completions: [],
      interruptions: [],
    })).toMatchObject({ remaining: 2 });

    await expect(flushQueuedSessionTerminals(userId)).resolves.toEqual({
      interruptions: { synced: 0, remaining: 0 },
      completions: { synced: 0, remaining: 0 },
      remaining: 0,
    });
    expect(loadQueuedSessionInterruptions(userId)).toEqual([]);
    expect(loadQueuedSessionCompletions(userId)).toEqual([]);
    expect(readQueuedSessionInterruptionsForExport(userId)).toMatchObject({
      ok: true,
      value: [expect.objectContaining({
        interruption: expect.objectContaining({ planSessionId }),
      })],
    });
    expect(readQueuedSessionCompletionsForExport(userId)).toMatchObject({
      ok: true,
      value: [expect.objectContaining({
        completion: expect.objectContaining({ planSessionId }),
      })],
    });
  });

  it("turns the recurring two-event warning into zero only after exact completion commit", async () => {
    installMemoryStorage();
    const planSessionId = "40000000-0000-4000-8000-000000000005";
    expect(queueSessionInterruption(pendingExit(planSessionId))).toBe(true);
    expect(queueSessionCompletion(pendingCompletion(planSessionId))).toBe(true);
    repository.recordAuthenticatedSessionInterruption.mockRejectedValue(
      new Error("The active session was not found."),
    );
    repository.completeAuthenticatedPlanSession.mockResolvedValue(undefined);

    await expect(flushQueuedSessionTerminals(userId)).resolves.toEqual({
      interruptions: { synced: 0, remaining: 0 },
      completions: { synced: 1, remaining: 0 },
      remaining: 0,
    });
    expect(repository.recordAuthenticatedSessionInterruption).toHaveBeenCalledOnce();
    expect(repository.completeAuthenticatedPlanSession).toHaveBeenCalledOnce();
    expect(loadQueuedSessionInterruptions(userId)).toEqual([]);
    expect(loadQueuedSessionCompletions(userId)).toEqual([]);
  });

  it("keeps both events when the exact completion is also rejected", async () => {
    installMemoryStorage();
    const planSessionId = "40000000-0000-4000-8000-000000000006";
    expect(queueSessionInterruption(pendingExit(planSessionId))).toBe(true);
    expect(queueSessionCompletion(pendingCompletion(planSessionId))).toBe(true);
    repository.recordAuthenticatedSessionInterruption.mockRejectedValue(
      new Error("temporarily unavailable"),
    );
    repository.completeAuthenticatedPlanSession.mockRejectedValue(
      new Error("temporarily unavailable"),
    );

    await expect(flushQueuedSessionTerminals(userId)).resolves.toMatchObject({
      interruptions: { remaining: 1 },
      completions: { remaining: 1 },
      remaining: 2,
    });
    expect(loadQueuedSessionInterruptions(userId)).toHaveLength(1);
    expect(loadQueuedSessionCompletions(userId)).toHaveLength(1);
  });

  it("keeps and counts both permanent rejections when active-marker removal fails", async () => {
    const values = new Map<string, string>();
    let failActiveRemoval = false;
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => {
          if (failActiveRemoval && (
            key === "yova.cloud-sync-outbox.v1"
            || key === "yova.session-interruption-outbox.v1"
          )) {
            throw new Error("storage unavailable");
          }
          values.delete(key);
        },
      },
    });
    const planSessionId = "40000000-0000-4000-8000-000000000010";
    expect(queueSessionInterruption(pendingExit(planSessionId))).toBe(true);
    expect(queueSessionCompletion(pendingCompletion(planSessionId))).toBe(true);
    failActiveRemoval = true;
    repository.recordAuthenticatedSessionInterruption.mockRejectedValue(
      new NonRetryableSessionTerminalMutationError(
        "interruption",
        "incompatible_cloud_state",
      ),
    );
    repository.completeAuthenticatedPlanSession.mockRejectedValue(
      new NonRetryableSessionTerminalMutationError(
        "completion",
        "incompatible_cloud_state",
      ),
    );

    await expect(flushQueuedSessionTerminals(userId)).resolves.toMatchObject({
      interruptions: { remaining: 1 },
      completions: { remaining: 1 },
      remaining: 2,
    });
    expect(loadQueuedSessionInterruptions(userId)).toHaveLength(1);
    expect(loadQueuedSessionCompletions(userId)).toHaveLength(1);
  });

  it("lets an unrelated completion sync while keeping the failed Exit", async () => {
    installMemoryStorage();
    const blockedSessionId = "40000000-0000-4000-8000-000000000007";
    const unrelatedSessionId = "40000000-0000-4000-8000-000000000008";
    expect(queueSessionInterruption(pendingExit(blockedSessionId))).toBe(true);
    expect(queueSessionCompletion(pendingCompletion(unrelatedSessionId))).toBe(true);
    repository.recordAuthenticatedSessionInterruption.mockRejectedValue(
      new Error("temporarily unavailable"),
    );
    repository.completeAuthenticatedPlanSession.mockResolvedValue(undefined);

    await expect(flushQueuedSessionTerminals(userId)).resolves.toMatchObject({
      interruptions: { remaining: 1 },
      completions: { synced: 1, remaining: 0 },
      remaining: 1,
    });
    expect(repository.completeAuthenticatedPlanSession).toHaveBeenCalledOnce();
    expect(loadQueuedSessionInterruptions(userId)[0]?.interruption.planSessionId)
      .toBe(blockedSessionId);
    expect(loadQueuedSessionCompletions(userId)).toEqual([]);
  });
});
