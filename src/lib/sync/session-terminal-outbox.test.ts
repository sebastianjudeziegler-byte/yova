import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  flushQueuedSessionCompletionSupersedingExit: vi.fn(),
  flushQueuedSessionCompletions: vi.fn(),
  flushQueuedSessionInterruptions: vi.fn(),
  loadQueuedSessionInterruptions: vi.fn(),
  pendingSessionCompletionPlanSessionIds: vi.fn(),
  reconcileQueuedSessionInterruptions: vi.fn(),
}));

vi.mock("@/lib/sync/session-completion-outbox", () => ({
  flushQueuedSessionCompletionSupersedingExit: mocks.flushQueuedSessionCompletionSupersedingExit,
  flushQueuedSessionCompletions: mocks.flushQueuedSessionCompletions,
  pendingSessionCompletionCount: vi.fn(() => 1),
  pendingSessionCompletionPlanSessionIds: mocks.pendingSessionCompletionPlanSessionIds,
}));

vi.mock("@/lib/sync/session-interruption-outbox", () => ({
  flushQueuedSessionInterruptions: mocks.flushQueuedSessionInterruptions,
  loadQueuedSessionInterruptions: mocks.loadQueuedSessionInterruptions,
  reconcileQueuedSessionInterruptions: mocks.reconcileQueuedSessionInterruptions,
}));

import {
  flushQueuedSessionTerminals,
  syncSessionCompletionAfterTerminals,
} from "@/lib/sync/session-terminal-outbox";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.flushQueuedSessionInterruptions.mockImplementation(async () => {
    mocks.order.push("interruption");
    return { synced: 1, remaining: 0 };
  });
  mocks.flushQueuedSessionCompletions.mockImplementation(async () => {
    mocks.order.push("completion");
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
});

describe("terminal session outbox ordering", () => {
  it("flushes an older explicit Exit before a later completion", async () => {
    await expect(flushQueuedSessionTerminals("00000000-0000-4000-8000-000000000001"))
      .resolves.toEqual({
        interruptions: { synced: 1, remaining: 0 },
        completions: { synced: 0, remaining: 1 },
        remaining: 1,
      });
    expect(mocks.order).toEqual(["interruption", "completion"]);
  });

  it("does not close the lesson while an older Exit is still waiting", async () => {
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
      });
    expect(mocks.order).toEqual(["interruption"]);
    expect(mocks.flushQueuedSessionCompletions).not.toHaveBeenCalled();
  });

  it("lets the exact later completion clear a poison Exit only after cloud commit", async () => {
    const userId = "00000000-0000-4000-8000-000000000011";
    const planSessionId = "00000000-0000-4000-8000-000000000012";
    mocks.flushQueuedSessionInterruptions
      .mockImplementationOnce(async () => {
        mocks.order.push("blocked-exit");
        return { synced: 0, remaining: 1 };
      })
      .mockImplementationOnce(async () => {
        mocks.order.push("remaining-exits");
        return { synced: 0, remaining: 0 };
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
    });
    expect(mocks.flushQueuedSessionCompletionSupersedingExit).toHaveBeenCalledWith(
      userId,
      planSessionId,
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
      "remaining-exits",
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
    });
    expect(mocks.reconcileQueuedSessionInterruptions).not.toHaveBeenCalled();
    expect(mocks.flushQueuedSessionCompletions).not.toHaveBeenCalled();
  });

  it("does not bypass an unrelated head Exit with a later completion", async () => {
    const blockedPlanSessionId = "00000000-0000-4000-8000-000000000032";
    mocks.flushQueuedSessionInterruptions.mockResolvedValueOnce({ synced: 0, remaining: 2 });
    mocks.loadQueuedSessionInterruptions.mockReturnValue([
      { interruption: { planSessionId: blockedPlanSessionId } },
      { interruption: { planSessionId: "00000000-0000-4000-8000-000000000033" } },
    ]);
    mocks.flushQueuedSessionCompletionSupersedingExit.mockResolvedValueOnce({
      committed: false,
      remaining: 1,
    });

    await flushQueuedSessionTerminals("00000000-0000-4000-8000-000000000031");

    expect(mocks.flushQueuedSessionCompletionSupersedingExit).toHaveBeenCalledOnce();
    expect(mocks.flushQueuedSessionCompletionSupersedingExit).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000031",
      blockedPlanSessionId,
    );
    expect(mocks.flushQueuedSessionCompletions).not.toHaveBeenCalled();
  });

  it("does not let the live completion bypass an older queued Exit", async () => {
    const completeImmediately = vi.fn(async () => undefined);
    mocks.flushQueuedSessionInterruptions.mockResolvedValueOnce({ synced: 0, remaining: 1 });
    mocks.loadQueuedSessionInterruptions.mockReturnValue([{
      interruption: {
        planSessionId: "00000000-0000-4000-8000-000000000003",
      },
    }]);

    await expect(syncSessionCompletionAfterTerminals({
      userId: "00000000-0000-4000-8000-000000000001",
      planSessionId: "00000000-0000-4000-8000-000000000002",
      completionQueued: false,
      completeImmediately,
    })).resolves.toMatchObject({ synced: false });

    expect(completeImmediately).not.toHaveBeenCalled();
    expect(mocks.flushQueuedSessionCompletions).not.toHaveBeenCalled();
  });

  it("uses the ordered outbox instead of a duplicate direct completion", async () => {
    const completeImmediately = vi.fn(async () => undefined);

    await expect(syncSessionCompletionAfterTerminals({
      userId: "00000000-0000-4000-8000-000000000001",
      planSessionId: "00000000-0000-4000-8000-000000000002",
      completionQueued: true,
      completeImmediately,
    })).resolves.toMatchObject({ synced: true });

    expect(mocks.order).toEqual(["interruption", "completion"]);
    expect(completeImmediately).not.toHaveBeenCalled();
  });

  it("uses the direct fallback only after older terminal work is clear", async () => {
    const completeImmediately = vi.fn(async () => undefined);

    await expect(syncSessionCompletionAfterTerminals({
      userId: "00000000-0000-4000-8000-000000000001",
      planSessionId: "00000000-0000-4000-8000-000000000002",
      completionQueued: false,
      completeImmediately,
    })).resolves.toMatchObject({ synced: true });

    expect(mocks.order).toEqual(["interruption", "completion"]);
    expect(completeImmediately).toHaveBeenCalledOnce();
  });
});
