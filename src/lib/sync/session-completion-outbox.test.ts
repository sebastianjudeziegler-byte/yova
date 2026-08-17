import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingSessionCompletion } from "@/lib/sync/session-completion-outbox";

const { completeAuthenticatedPlanSession } = vi.hoisted(() => ({
  completeAuthenticatedPlanSession: vi.fn(),
}));

vi.mock("@/lib/supabase/learning-state-repository", () => ({
  completeAuthenticatedPlanSession,
}));

import {
  flushQueuedSessionCompletions,
  pendingSessionCompletionPlanSessionIds,
  queueSessionCompletion,
} from "@/lib/sync/session-completion-outbox";

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

describe("session completion outbox", () => {
  it("exposes the queued session as a terminal checkpoint tombstone", async () => {
    installMemoryStorage();
    completeAuthenticatedPlanSession.mockResolvedValue(undefined);
    const pending: PendingSessionCompletion = {
      userId: "00000000-0000-4000-8000-000000000001",
      queuedAt: "2026-08-17T20:08:00.000Z",
      completion: {
        id: "00000000-0000-4000-8000-000000000002",
        planId: "00000000-0000-4000-8000-000000000003",
        planSessionId: "00000000-0000-4000-8000-000000000004",
        startedAt: "2026-08-17T20:00:00.000Z",
        completedAt: "2026-08-17T20:08:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 8,
        correctAnswers: 2,
        totalAnswers: 3,
        feedback: "about_right",
        observedGap: "One concept needs another retrieval.",
        conceptEvidence: [],
        confidenceEvidence: [],
      },
      adaptation: null,
      followUpSession: null,
    };

    expect(queueSessionCompletion(pending)).toBe(true);
    expect(pendingSessionCompletionPlanSessionIds(pending.userId)).toEqual([
      pending.completion.planSessionId,
    ]);
    await expect(flushQueuedSessionCompletions(pending.userId)).resolves.toEqual({
      synced: 1,
      remaining: 0,
    });
    expect(completeAuthenticatedPlanSession).toHaveBeenCalledWith(
      pending.completion,
      null,
      null,
    );
  });
});
