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
  removeQueuedSessionCompletionsForPlan,
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
      { ...pending.completion, completionMode: "guided" },
      null,
      null,
    );
  });

  it("removes only one account's entries for a permanently deleted plan", () => {
    installMemoryStorage();
    const base: PendingSessionCompletion = {
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
    const sibling = {
      ...base,
      completion: { ...base.completion, id: "00000000-0000-4000-8000-000000000012", planId: "00000000-0000-4000-8000-000000000013" },
    };
    queueSessionCompletion(base);
    queueSessionCompletion(sibling);

    expect(removeQueuedSessionCompletionsForPlan(base.userId, base.completion.planId)).toBe(true);
    expect(pendingSessionCompletionPlanSessionIds(base.userId)).toEqual([sibling.completion.planSessionId]);
  });

  it("preserves unguided practice provenance through a queued cloud sync", async () => {
    installMemoryStorage();
    completeAuthenticatedPlanSession.mockResolvedValue(undefined);
    const pending: PendingSessionCompletion = {
      userId: "00000000-0000-4000-8000-000000000021",
      queuedAt: "2026-08-17T20:08:00.000Z",
      completion: {
        id: "00000000-0000-4000-8000-000000000022",
        planId: "00000000-0000-4000-8000-000000000023",
        planSessionId: "00000000-0000-4000-8000-000000000024",
        startedAt: "2026-08-17T20:00:00.000Z",
        completedAt: "2026-08-17T20:08:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 8,
        correctAnswers: 0,
        totalAnswers: 0,
        feedback: "about_right",
        observedGap: "Unguided practice completed; no topic evidence was recorded.",
        completionMode: "unguided_practice",
        conceptEvidence: [],
        confidenceEvidence: [],
      },
      adaptation: null,
      followUpSession: {
        id: "00000000-0000-4000-8000-000000000022",
        sequence: 2,
        title: "Verify thermohaline circulation",
        objective: "Complete an independent guided check for every original target.",
        method: "Independent retrieval verification",
        methodReason: "This work counted as practice, not proof.",
        scheduledFor: "2026-08-18T20:08:00.000Z",
        estimatedMinutes: 10,
        amountLabel: "Required guided verification · about 10 min",
        learningMode: "study",
        topicIds: ["00000000-0000-4000-8000-000000000026"],
        contentTargets: ["Density changes from temperature and salinity"],
        completionEvidence: ["Explain how temperature and salinity affect density."],
        reviewConcept: "Thermohaline circulation",
        reviewType: "verify",
        status: "ready",
      },
    };

    expect(queueSessionCompletion(pending)).toBe(true);
    await flushQueuedSessionCompletions(pending.userId);

    expect(completeAuthenticatedPlanSession).toHaveBeenCalledWith(
      expect.objectContaining({ completionMode: "unguided_practice" }),
      null,
      expect.objectContaining({
        reviewType: "verify",
        topicIds: ["00000000-0000-4000-8000-000000000026"],
        contentTargets: ["Density changes from temperature and salinity"],
        completionEvidence: ["Explain how temperature and salinity affect density."],
      }),
    );
  });
});
