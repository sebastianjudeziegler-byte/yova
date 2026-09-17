import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionCompletion } from "@/lib/domain";

const transport = vi.hoisted(() => ({ write: vi.fn(), receipt: vi.fn() }));
vi.mock("@/lib/supabase/learning-state-repository", () => ({
  completeAuthenticatedPlanSession: transport.write,
  readAuthenticatedSessionCompletionReceipt: transport.receipt,
}));
import { syncBaselineCompletion } from "@/lib/sync/baseline-completion-sync";
import { loadQueuedSessionCompletions } from "@/lib/sync/session-completion-outbox";

const userId = "10000000-0000-4000-8000-000000000001";
const completion: SessionCompletion = {
  id: "10000000-0000-4000-8000-000000000002",
  planId: "10000000-0000-4000-8000-000000000003",
  planSessionId: "10000000-0000-4000-8000-000000000004",
  startedAt: "2026-09-17T12:00:00.000Z",
  completedAt: "2026-09-17T12:10:00.000Z",
  plannedMinutes: 20, actualMinutes: 10, correctAnswers: 5, totalAnswers: 5,
  feedback: null, observedGap: "No remaining gap identified.", completionMode: "guided",
  conceptEvidence: [], confidenceEvidence: [],
};

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  transport.write.mockReset().mockResolvedValue(undefined);
  transport.receipt.mockReset().mockResolvedValue(false);
});
afterEach(() => vi.unstubAllGlobals());

describe("baseline completion uses durable terminal recovery", () => {
  it("preserves both segment receipts through pending save and exact retry", async () => {
    const segmented = { ...completion, segmentCompletions: [
      { segmentId: "part-1", correctAnswers: 3, totalAnswers: 3, elapsedSeconds: 360 },
      { segmentId: "part-2", correctAnswers: 2, totalAnswers: 2, elapsedSeconds: 240 },
    ] };
    transport.write.mockRejectedValueOnce(new Error("offline"));
    await syncBaselineCompletion(userId, segmented);
    expect(loadQueuedSessionCompletions(userId)[0]?.completion).toEqual(segmented);
    await syncBaselineCompletion(userId, { ...segmented, completedAt: "2026-09-17T12:12:00.000Z" });
    expect(transport.write.mock.calls[1][0]).toEqual(segmented);
  });

  it("persists before sending and removes the pending result only after confirmation", async () => {
    transport.write.mockImplementation(async () => {
      expect(loadQueuedSessionCompletions(userId)[0].completion).toEqual(completion);
    });
    expect((await syncBaselineCompletion(userId, completion)).committed).toBe(true);
    expect(loadQueuedSessionCompletions(userId)).toEqual([]);
  });

  it("keeps an unknown timeout pending and reuses the exact payload after resume", async () => {
    transport.write.mockRejectedValueOnce(new Error("deadline"));
    const first = await syncBaselineCompletion(userId, completion);
    expect(first.committed).toBe(false);
    expect(loadQueuedSessionCompletions(userId)).toHaveLength(1);
    const retry = await syncBaselineCompletion(userId, {
      ...completion, id: "10000000-0000-4000-8000-000000000009", completedAt: "2026-09-17T12:12:00.000Z",
    });
    expect(retry.committed).toBe(true);
    expect(transport.write.mock.calls[1][0]).toEqual(completion);
    expect(retry.completion).toEqual(completion);
  });

  it("reconciles a lost reply with the authenticated committed receipt", async () => {
    transport.write.mockRejectedValue(new Error("reply lost"));
    transport.receipt.mockResolvedValue(true);
    const result = await syncBaselineCompletion(userId, completion);
    expect(result.committed).toBe(true);
    expect(transport.write).toHaveBeenCalledTimes(1);
    expect(transport.receipt).toHaveBeenCalledWith(userId, completion);
    expect(loadQueuedSessionCompletions(userId)).toEqual([]);
  });

  it("coalesces repeated Finish clicks into one operation", async () => {
    let release!: () => void;
    transport.write.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const first = syncBaselineCompletion(userId, completion);
    const second = syncBaselineCompletion(userId, completion);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    expect((await first).committed).toBe(true);
    expect((await second).committed).toBe(true);
    expect(transport.write).toHaveBeenCalledTimes(1);
  });

  it("never replays another account's pending completion", async () => {
    transport.write.mockRejectedValueOnce(new Error("offline"));
    await syncBaselineCompletion(userId, completion);
    const other = "10000000-0000-4000-8000-000000000008";
    await syncBaselineCompletion(other, { ...completion, id: other });
    expect(transport.write.mock.calls[1][5]).toBe(other);
    expect(loadQueuedSessionCompletions(userId)).toHaveLength(1);
  });
});
