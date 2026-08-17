import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  flushQueuedSessionCompletions: vi.fn(),
  flushQueuedSessionInterruptions: vi.fn(),
  pendingSessionCompletionPlanSessionIds: vi.fn(),
}));

vi.mock("@/lib/sync/session-completion-outbox", () => ({
  flushQueuedSessionCompletions: mocks.flushQueuedSessionCompletions,
  pendingSessionCompletionCount: vi.fn(() => 1),
  pendingSessionCompletionPlanSessionIds: mocks.pendingSessionCompletionPlanSessionIds,
}));

vi.mock("@/lib/sync/session-interruption-outbox", () => ({
  flushQueuedSessionInterruptions: mocks.flushQueuedSessionInterruptions,
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
    mocks.flushQueuedSessionInterruptions.mockImplementationOnce(async () => {
      mocks.order.push("interruption");
      return { synced: 0, remaining: 1 };
    });

    await expect(flushQueuedSessionTerminals("00000000-0000-4000-8000-000000000001"))
      .resolves.toEqual({
        interruptions: { synced: 0, remaining: 1 },
        completions: { synced: 0, remaining: 1 },
        remaining: 2,
      });
    expect(mocks.order).toEqual(["interruption"]);
    expect(mocks.flushQueuedSessionCompletions).not.toHaveBeenCalled();
  });

  it("does not let the live completion bypass an older queued Exit", async () => {
    const completeImmediately = vi.fn(async () => undefined);
    mocks.flushQueuedSessionInterruptions.mockResolvedValueOnce({ synced: 0, remaining: 1 });

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
