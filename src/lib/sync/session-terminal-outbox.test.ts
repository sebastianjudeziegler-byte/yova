import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  completionOutcomes: [] as Array<{
    completionId: string;
    planSessionId: string;
    disposition: "committed" | "rejected";
  }>,
  flushQueuedSessionCompletionSupersedingExit: vi.fn(),
  flushQueuedSessionCompletions: vi.fn(),
  flushQueuedSessionInterruptions: vi.fn(),
  loadQueuedSessionInterruptions: vi.fn(),
  pendingSessionInterruptionPlanSessionIds: vi.fn(),
  pendingSessionCompletionPlanSessionIds: vi.fn(),
  sessionCompletionOutboxDisposition: vi.fn(),
  reconcileQueuedSessionInterruptions: vi.fn(),
}));

vi.mock("@/lib/sync/session-completion-outbox", () => ({
  flushQueuedSessionCompletionSupersedingExit: mocks.flushQueuedSessionCompletionSupersedingExit,
  flushQueuedSessionCompletions: mocks.flushQueuedSessionCompletions,
  pendingSessionCompletionCount: vi.fn(() => 1),
  pendingSessionCompletionPlanSessionIds: mocks.pendingSessionCompletionPlanSessionIds,
  sessionCompletionOutboxDisposition: mocks.sessionCompletionOutboxDisposition,
}));

vi.mock("@/lib/sync/session-interruption-outbox", () => ({
  flushQueuedSessionInterruptions: mocks.flushQueuedSessionInterruptions,
  loadQueuedSessionInterruptions: mocks.loadQueuedSessionInterruptions,
  pendingSessionInterruptionPlanSessionIds: mocks.pendingSessionInterruptionPlanSessionIds,
  reconcileQueuedSessionInterruptions: mocks.reconcileQueuedSessionInterruptions,
}));

import {
  flushQueuedSessionTerminals,
  sessionCompletionSyncIssue,
  syncSessionCompletionAfterTerminals,
} from "@/lib/sync/session-terminal-outbox";
import { NonRetryableSessionTerminalMutationError } from "@/lib/sync/session-terminal-mutation-error";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.completionOutcomes.length = 0;
  mocks.flushQueuedSessionInterruptions.mockImplementation(async () => {
    mocks.order.push("interruption");
    return { synced: 1, remaining: 0 };
  });
  mocks.flushQueuedSessionCompletions.mockImplementation(async (_userId, options) => {
    mocks.order.push("completion");
    mocks.completionOutcomes.forEach((outcome) => options?.onOutcome?.(outcome));
    return { synced: 0, remaining: 1 };
  });
  mocks.flushQueuedSessionCompletionSupersedingExit.mockResolvedValue({
    committed: false,
    remaining: 1,
  });
  mocks.loadQueuedSessionInterruptions.mockReturnValue([]);
  mocks.reconcileQueuedSessionInterruptions.mockReturnValue({
    removed: 0,
    remaining: 1,
    storageSaved: true,
  });
  mocks.pendingSessionCompletionPlanSessionIds.mockReturnValue([]);
  mocks.sessionCompletionOutboxDisposition.mockReturnValue({ kind: "absent" });
  mocks.pendingSessionInterruptionPlanSessionIds.mockReturnValue([]);
});

describe("terminal session outbox ordering", () => {
  it("coalesces concurrent terminal flushes for the same account", async () => {
    let releaseInterruption!: () => void;
    mocks.flushQueuedSessionInterruptions.mockImplementationOnce(() => new Promise((resolve) => {
      releaseInterruption = () => resolve({ synced: 0, remaining: 0 });
    }));
    const userId = "00000000-0000-4000-8000-000000000081";

    const first = flushQueuedSessionTerminals(userId);
    const second = flushQueuedSessionTerminals(userId);

    expect(second).toBe(first);
    expect(mocks.flushQueuedSessionInterruptions).toHaveBeenCalledOnce();
    releaseInterruption();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.flushQueuedSessionCompletions).toHaveBeenCalledOnce();
  });

  it("flushes an older explicit Exit before a later completion", async () => {
    await expect(flushQueuedSessionTerminals("00000000-0000-4000-8000-000000000001"))
      .resolves.toEqual({
        interruptions: { synced: 1, remaining: 0 },
        completions: { synced: 0, remaining: 1 },
        remaining: 1,
        completionOutcomes: [],
      });
    expect(mocks.order).toEqual(["interruption", "completion"]);
  });

  it("blocks only the completion for the session whose Exit is still waiting", async () => {
    const planSessionId = "00000000-0000-4000-8000-000000000002";
    mocks.flushQueuedSessionInterruptions.mockImplementationOnce(async () => {
      mocks.order.push("interruption");
      return { synced: 0, remaining: 1 };
    });
    mocks.loadQueuedSessionInterruptions.mockReturnValue([{
      interruption: { planSessionId },
    }]);

    await expect(flushQueuedSessionTerminals("00000000-0000-4000-8000-000000000001"))
      .resolves.toEqual({
        interruptions: { synced: 0, remaining: 1 },
        completions: { synced: 0, remaining: 1 },
        remaining: 2,
        completionOutcomes: [],
      });
    expect(mocks.order).toEqual(["interruption", "completion"]);
    expect(mocks.flushQueuedSessionCompletions).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      expect.objectContaining({
        blockedPlanSessionIds: new Set([planSessionId]),
        onOutcome: expect.any(Function),
      }),
    );
  });

  it("lets the exact later completion clear a poison Exit only after cloud commit", async () => {
    const userId = "00000000-0000-4000-8000-000000000011";
    const planSessionId = "00000000-0000-4000-8000-000000000012";
    mocks.flushQueuedSessionInterruptions.mockImplementationOnce(async () => {
      mocks.order.push("blocked-exit");
      return { synced: 0, remaining: 1 };
    });
    mocks.loadQueuedSessionInterruptions
      .mockReturnValueOnce([{ interruption: { planSessionId } }])
      .mockReturnValue([]);
    mocks.flushQueuedSessionCompletionSupersedingExit.mockImplementationOnce(async () => {
      mocks.order.push("exact-completion");
      return { committed: true, remaining: 0 };
    });
    mocks.reconcileQueuedSessionInterruptions.mockImplementationOnce(() => {
      mocks.order.push("reconcile-exit");
      return { removed: 1, remaining: 0, storageSaved: true };
    });
    mocks.flushQueuedSessionCompletions.mockImplementationOnce(async () => {
      mocks.order.push("remaining-completions");
      return { synced: 0, remaining: 0 };
    });

    await expect(flushQueuedSessionTerminals(userId)).resolves.toEqual({
      interruptions: { synced: 0, remaining: 0 },
      completions: { synced: 1, remaining: 0 },
      remaining: 0,
      completionOutcomes: [],
    });
    expect(mocks.flushQueuedSessionCompletionSupersedingExit).toHaveBeenCalledWith(
      userId,
      planSessionId,
      { onOutcome: expect.any(Function) },
    );
    expect(mocks.reconcileQueuedSessionInterruptions).toHaveBeenCalledWith(
      userId,
      [],
      [planSessionId],
    );
    expect(mocks.order).toEqual([
      "blocked-exit",
      "exact-completion",
      "reconcile-exit",
      "remaining-completions",
    ]);
  });

  it("keeps both terminal markers when the exact completion also fails", async () => {
    const planSessionId = "00000000-0000-4000-8000-000000000022";
    mocks.flushQueuedSessionInterruptions.mockResolvedValueOnce({ synced: 0, remaining: 1 });
    mocks.loadQueuedSessionInterruptions.mockReturnValue([{
      interruption: { planSessionId },
    }]);
    mocks.flushQueuedSessionCompletionSupersedingExit.mockResolvedValueOnce({
      committed: false,
      remaining: 1,
    });

    await expect(flushQueuedSessionTerminals(
      "00000000-0000-4000-8000-000000000021",
    )).resolves.toEqual({
      interruptions: { synced: 0, remaining: 1 },
      completions: { synced: 0, remaining: 1 },
      remaining: 2,
      completionOutcomes: [],
    });
    expect(mocks.reconcileQueuedSessionInterruptions).not.toHaveBeenCalled();
    expect(mocks.flushQueuedSessionCompletions).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000021",
      expect.objectContaining({
        blockedPlanSessionIds: new Set([planSessionId]),
        onOutcome: expect.any(Function),
      }),
    );
  });

  it("checks each blocked session independently and still flushes unrelated completions", async () => {
    const blockedPlanSessionId = "00000000-0000-4000-8000-000000000032";
    const secondBlockedPlanSessionId = "00000000-0000-4000-8000-000000000033";
    mocks.flushQueuedSessionInterruptions.mockResolvedValueOnce({ synced: 0, remaining: 2 });
    mocks.loadQueuedSessionInterruptions.mockReturnValue([
      { interruption: { planSessionId: blockedPlanSessionId } },
      { interruption: { planSessionId: secondBlockedPlanSessionId } },
    ]);
    mocks.flushQueuedSessionCompletionSupersedingExit.mockResolvedValueOnce({
      committed: false,
      remaining: 1,
    });

    await flushQueuedSessionTerminals("00000000-0000-4000-8000-000000000031");

    expect(mocks.flushQueuedSessionCompletionSupersedingExit).toHaveBeenCalledTimes(2);
    expect(mocks.flushQueuedSessionCompletionSupersedingExit.mock.calls.map((call) => (
      call.slice(0, 2)
    ))).toEqual([
      ["00000000-0000-4000-8000-000000000031", blockedPlanSessionId],
      ["00000000-0000-4000-8000-000000000031", secondBlockedPlanSessionId],
    ]);
    expect(mocks.flushQueuedSessionCompletions).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000031",
      expect.objectContaining({
        blockedPlanSessionIds: new Set([blockedPlanSessionId, secondBlockedPlanSessionId]),
        onOutcome: expect.any(Function),
      }),
    );
  });

  it("does not let a live completion bypass a queued Exit for the same session", async () => {
    const completeImmediately = vi.fn(async () => undefined);
    const planSessionId = "00000000-0000-4000-8000-000000000002";
    mocks.flushQueuedSessionInterruptions.mockResolvedValueOnce({ synced: 0, remaining: 1 });
    mocks.loadQueuedSessionInterruptions.mockReturnValue([{
      interruption: {
        planSessionId,
      },
    }]);
    mocks.pendingSessionInterruptionPlanSessionIds.mockReturnValue([planSessionId]);

    await expect(syncSessionCompletionAfterTerminals({
      userId: "00000000-0000-4000-8000-000000000001",
      planSessionId,
      completionId: "00000000-0000-4000-8000-000000000003",
      completionQueued: false,
      completeImmediately,
    })).resolves.toEqual({
      disposition: "not_durable",
      reason: "older_exit",
      pendingEvents: 2,
    });

    expect(completeImmediately).not.toHaveBeenCalled();
    expect(mocks.flushQueuedSessionCompletions).toHaveBeenCalled();
  });

  it("lets a live completion proceed when only an unrelated Exit remains", async () => {
    const completeImmediately = vi.fn(async () => undefined);
    const planSessionId = "00000000-0000-4000-8000-000000000042";
    mocks.flushQueuedSessionInterruptions.mockResolvedValueOnce({ synced: 0, remaining: 1 });
    mocks.loadQueuedSessionInterruptions.mockReturnValue([{
      interruption: { planSessionId: "00000000-0000-4000-8000-000000000043" },
    }]);
    mocks.pendingSessionInterruptionPlanSessionIds.mockReturnValue([
      "00000000-0000-4000-8000-000000000043",
    ]);

    await expect(syncSessionCompletionAfterTerminals({
      userId: "00000000-0000-4000-8000-000000000041",
      planSessionId,
      completionId: "00000000-0000-4000-8000-000000000044",
      completionQueued: false,
      completeImmediately,
    })).resolves.toMatchObject({ disposition: "committed" });
    expect(completeImmediately).toHaveBeenCalledOnce();
  });

  it("uses the ordered outbox instead of a duplicate direct completion", async () => {
    const completeImmediately = vi.fn(async () => undefined);
    mocks.completionOutcomes.push({
      completionId: "00000000-0000-4000-8000-000000000003",
      planSessionId: "00000000-0000-4000-8000-000000000002",
      disposition: "committed",
    });

    await expect(syncSessionCompletionAfterTerminals({
      userId: "00000000-0000-4000-8000-000000000001",
      planSessionId: "00000000-0000-4000-8000-000000000002",
      completionId: "00000000-0000-4000-8000-000000000003",
      completionQueued: true,
      completeImmediately,
    })).resolves.toMatchObject({ disposition: "committed" });

    expect(mocks.order).toEqual(["interruption", "completion"]);
    expect(completeImmediately).not.toHaveBeenCalled();
  });

  it("does not infer cloud commit from cross-tab outbox disappearance", async () => {
    const completeImmediately = vi.fn(async () => undefined);
    // Another tab, eviction, or corrupt storage can make the marker disappear
    // while this flush has no exact RPC receipt for it.
    mocks.sessionCompletionOutboxDisposition.mockReturnValue({ kind: "absent" });

    const result = await syncSessionCompletionAfterTerminals({
      userId: "00000000-0000-4000-8000-000000000091",
      planSessionId: "00000000-0000-4000-8000-000000000092",
      completionId: "00000000-0000-4000-8000-000000000093",
      completionQueued: true,
      completeImmediately,
    });

    expect(result).toEqual({
      disposition: "not_durable",
      reason: "unconfirmed_absence",
      pendingEvents: 1,
    });
    expect(sessionCompletionSyncIssue({
      disposition: "not_durable",
      reason: "unconfirmed_absence",
      pendingEvents: result.pendingEvents,
    })).toContain(
      "could not confirm that this completion reached the cloud",
    );
    expect(completeImmediately).not.toHaveBeenCalled();
  });

  it("uses the direct fallback only after older terminal work is clear", async () => {
    const completeImmediately = vi.fn(async () => undefined);

    await expect(syncSessionCompletionAfterTerminals({
      userId: "00000000-0000-4000-8000-000000000001",
      planSessionId: "00000000-0000-4000-8000-000000000002",
      completionId: "00000000-0000-4000-8000-000000000003",
      completionQueued: false,
      completeImmediately,
    })).resolves.toMatchObject({ disposition: "committed" });

    expect(mocks.order).toEqual(["interruption", "completion"]);
    expect(completeImmediately).toHaveBeenCalledOnce();
  });

  it("types a deterministic direct completion failure as rejected", async () => {
    const completeImmediately = vi.fn(async () => {
      throw new NonRetryableSessionTerminalMutationError(
        "completion",
        "invalid_payload",
      );
    });

    await expect(syncSessionCompletionAfterTerminals({
      userId: "00000000-0000-4000-8000-000000000071",
      planSessionId: "00000000-0000-4000-8000-000000000072",
      completionId: "00000000-0000-4000-8000-000000000073",
      completionQueued: false,
      completeImmediately,
    })).resolves.toEqual({
      disposition: "rejected",
      pendingEvents: 1,
    });
  });

  it("keeps the completion screen authoritative while a durable retry remains", async () => {
    const completeImmediately = vi.fn(async () => undefined);
    mocks.sessionCompletionOutboxDisposition.mockReturnValue({ kind: "pending" });

    await expect(syncSessionCompletionAfterTerminals({
      userId: "00000000-0000-4000-8000-000000000051",
      planSessionId: "00000000-0000-4000-8000-000000000052",
      completionId: "00000000-0000-4000-8000-000000000053",
      completionQueued: true,
      completeImmediately,
    })).resolves.toEqual({
      disposition: "queued",
      reason: "retryable_failure",
      pendingEvents: 1,
    });
    expect(completeImmediately).not.toHaveBeenCalled();
    const issue = sessionCompletionSyncIssue({
      disposition: "queued",
      reason: "retryable_failure",
      pendingEvents: 1,
    });
    expect(issue).toContain("Choose Finish again to retry");
    expect(issue).not.toContain("Retry now");
  });

  it("distinguishes a deterministic cloud rejection from a pending retry", async () => {
    const completeImmediately = vi.fn(async () => undefined);
    const planSessionId = "00000000-0000-4000-8000-000000000062";
    mocks.flushQueuedSessionInterruptions.mockResolvedValueOnce({ synced: 0, remaining: 1 });
    mocks.loadQueuedSessionInterruptions.mockReturnValue([{
      interruption: { planSessionId },
    }]);
    mocks.pendingSessionInterruptionPlanSessionIds.mockReturnValue([planSessionId]);
    mocks.sessionCompletionOutboxDisposition.mockReturnValue({
      kind: "quarantined",
      reason: "permanent_server_rejection",
    });

    await expect(syncSessionCompletionAfterTerminals({
      userId: "00000000-0000-4000-8000-000000000061",
      planSessionId,
      completionId: "00000000-0000-4000-8000-000000000063",
      completionQueued: true,
      completeImmediately,
    })).resolves.toEqual({
      disposition: "rejected",
      pendingEvents: 2,
    });
    expect(completeImmediately).not.toHaveBeenCalled();
  });
});
