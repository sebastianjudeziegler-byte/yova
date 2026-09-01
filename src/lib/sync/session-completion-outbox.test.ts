import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { preparePostSessionStudyRouteTransition } from "@/lib/study-route/post-session-transition";
import { createCommittedInitialSessionStudyRoute } from "@/lib/study-route/session-route-creation";
import type { PendingSessionCompletion } from "@/lib/sync/session-completion-outbox";

const { completeAuthenticatedPlanSession } = vi.hoisted(() => ({
  completeAuthenticatedPlanSession: vi.fn(),
}));

vi.mock("@/lib/supabase/learning-state-repository", () => ({
  completeAuthenticatedPlanSession,
}));

import {
  flushQueuedSessionCompletions,
  loadQueuedSessionCompletions,
  pendingSessionCompletionPlanSessionIds,
  queueSessionCompletion,
  reconcileQueuedSessionCompletions,
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
  return values;
}

function completionPending({
  userId,
  completionId,
  planSessionId,
  planId = "20000000-0000-4000-8000-000000000001",
}: {
  userId: string;
  completionId: string;
  planSessionId: string;
  planId?: string;
}): PendingSessionCompletion {
  return {
    userId,
    queuedAt: "2026-08-17T20:08:00.000Z",
    completion: {
      id: completionId,
      planId,
      planSessionId,
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
    expect(loadQueuedSessionCompletions(pending.userId)[0]?.completion).not.toHaveProperty("routeRevisionId");
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

  it("reconciles authoritative completion receipts for only the exact account", () => {
    installMemoryStorage();
    const userId = "20000000-0000-4000-8000-000000000002";
    const otherUserId = "20000000-0000-4000-8000-000000000003";
    const completedPlanSessionId = "20000000-0000-4000-8000-000000000004";
    const exact = completionPending({
      userId,
      completionId: "20000000-0000-4000-8000-000000000005",
      planSessionId: completedPlanSessionId,
    });
    const sameCompletedSession = completionPending({
      userId,
      completionId: "20000000-0000-4000-8000-000000000006",
      planSessionId: completedPlanSessionId,
    });
    const retryable = completionPending({
      userId,
      completionId: "20000000-0000-4000-8000-000000000007",
      planSessionId: "20000000-0000-4000-8000-000000000008",
    });
    const otherAccount = completionPending({
      userId: otherUserId,
      completionId: "20000000-0000-4000-8000-000000000009",
      planSessionId: completedPlanSessionId,
    });
    [exact, sameCompletedSession, retryable, otherAccount].forEach((entry) => {
      expect(queueSessionCompletion(entry)).toBe(true);
    });

    expect(reconcileQueuedSessionCompletions(userId, [{
      id: exact.completion.id,
      planSessionId: completedPlanSessionId,
    }])).toEqual({
      removed: 2,
      remaining: 1,
      storageSaved: true,
    });
    expect(loadQueuedSessionCompletions(userId).map((entry) => entry.completion.id)).toEqual([
      retryable.completion.id,
    ]);
    expect(loadQueuedSessionCompletions(otherUserId).map((entry) => entry.completion.id)).toEqual([
      otherAccount.completion.id,
    ]);
  });

  it("reports the actual remaining completion count when reconciliation cannot be saved", () => {
    const values = installMemoryStorage();
    const pending = completionPending({
      userId: "20000000-0000-4000-8000-000000000012",
      completionId: "20000000-0000-4000-8000-000000000013",
      planSessionId: "20000000-0000-4000-8000-000000000014",
    });
    expect(queueSessionCompletion(pending)).toBe(true);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: () => { throw new Error("storage unavailable"); },
        removeItem: () => { throw new Error("storage unavailable"); },
      },
    });

    expect(reconcileQueuedSessionCompletions(pending.userId, [{
      id: pending.completion.id,
      planSessionId: pending.completion.planSessionId,
    }])).toEqual({
      removed: 0,
      remaining: 1,
      storageSaved: false,
    });
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
      null,
      null,
    );
  });

  it("preserves route identity on the completion and each evidence item", async () => {
    installMemoryStorage();
    completeAuthenticatedPlanSession.mockResolvedValue(undefined);
    const routeRevisionId = "00000000-0000-4000-8000-000000000035";
    const pending: PendingSessionCompletion = {
      userId: "00000000-0000-4000-8000-000000000031",
      queuedAt: "2026-08-17T20:08:00.000Z",
      completion: {
        id: "00000000-0000-4000-8000-000000000032",
        planId: "00000000-0000-4000-8000-000000000033",
        planSessionId: "00000000-0000-4000-8000-000000000034",
        routeRevisionId,
        startedAt: "2026-08-17T20:00:00.000Z",
        completedAt: "2026-08-17T20:08:00.000Z",
        plannedMinutes: 20,
        actualMinutes: 8,
        correctAnswers: 1,
        totalAnswers: 1,
        feedback: "about_right",
        observedGap: "No major gap detected.",
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
      },
      adaptation: null,
      followUpSession: null,
    };

    expect(queueSessionCompletion(pending)).toBe(true);
    expect(loadQueuedSessionCompletions(pending.userId)[0]?.completion).toEqual({
      ...pending.completion,
      completionMode: "guided",
    });

    await flushQueuedSessionCompletions(pending.userId);

    expect(completeAuthenticatedPlanSession).toHaveBeenCalledWith(
      expect.objectContaining({
        routeRevisionId,
        conceptEvidence: [expect.objectContaining({ routeRevisionId })],
        confidenceEvidence: [expect.objectContaining({ routeRevisionId })],
      }),
      null,
      null,
      null,
      null,
    );
  });

  it("replays a deferred guided continuation from durable browser storage", async () => {
    installMemoryStorage();
    completeAuthenticatedPlanSession.mockResolvedValue(undefined);
    const pending: PendingSessionCompletion = {
      userId: "00000000-0000-4000-8000-000000000041",
      queuedAt: "2026-08-21T17:10:00.000Z",
      completion: {
        id: "00000000-0000-4000-8000-000000000042",
        planId: "00000000-0000-4000-8000-000000000043",
        planSessionId: "00000000-0000-4000-8000-000000000044",
        startedAt: "2026-08-21T17:00:00.000Z",
        completedAt: "2026-08-21T17:10:00.000Z",
        plannedMinutes: 10,
        actualMinutes: 10,
        correctAnswers: 1,
        totalAnswers: 1,
        feedback: "about_right",
        observedGap: "No major gap detected.",
        completionMode: "guided",
        conceptEvidence: [],
        confidenceEvidence: [],
      },
      adaptation: null,
      followUpSession: null,
      continuationSession: {
        id: "00000000-0000-4000-8000-000000000045",
        sequence: 2,
        title: "Continue cellular respiration",
        objective: "Learn and explain the remaining saved target: Electron transport chain mechanism.",
        method: "Guided explanation and retrieval",
        methodReason: "This continuation preserves the exact remaining plan target.",
        scheduledFor: "2026-08-21T17:10:00.000Z",
        estimatedMinutes: 10,
        amountLabel: "1 saved target · about 10 min",
        learningMode: "learn",
        topicIds: ["00000000-0000-4000-8000-000000000046"],
        contentTargets: ["Electron transport chain mechanism"],
        completionEvidence: ["Explain the electron transport chain mechanism"],
        status: "ready",
      },
    };

    expect(queueSessionCompletion(pending)).toBe(true);
    await flushQueuedSessionCompletions(pending.userId);

    expect(completeAuthenticatedPlanSession).toHaveBeenCalledWith(
      expect.objectContaining({ completionMode: "guided" }),
      null,
      null,
      expect.objectContaining({
        id: "00000000-0000-4000-8000-000000000045",
        topicIds: ["00000000-0000-4000-8000-000000000046"],
        contentTargets: ["Electron transport chain mechanism"],
        completionEvidence: ["Explain the electron transport chain mechanism"],
      }),
      null,
    );
  });

  it("round-trips a successor route and new-session lineage through offline replay", async () => {
    installMemoryStorage();
    completeAuthenticatedPlanSession.mockResolvedValue(undefined);
    const planId = "10000000-0000-4000-8000-000000000001";
    const completedId = "10000000-0000-4000-8000-000000000002";
    const nextId = "10000000-0000-4000-8000-000000000003";
    const reviewId = "10000000-0000-4000-8000-000000000004";
    const topicId = "10000000-0000-4000-8000-000000000005";
    const createdAt = "2026-08-23T09:00:00.000Z";
    const changedAt = "2026-08-23T10:00:00.000Z";
    const baseSession = (
      id: string,
      sequence: number,
      method: string,
      status: LearningPlanSession["status"],
    ): LearningPlanSession => ({
      id,
      sequence,
      title: `Session ${sequence}`,
      objective: `Explain and apply the target for session ${sequence}.`,
      method,
      methodReason: "This method matches the target and current knowledge stage.",
      scheduledFor: changedAt,
      estimatedMinutes: 10,
      amountLabel: "One target · about 10 min",
      learningMode: sequence === 1 ? "learn" : "study",
      topicIds: [topicId],
      contentTargets: ["One bounded target"],
      completionEvidence: ["Explain the bounded target without notes."],
      status,
    });
    const raw: LearningPlan = {
      id: planId,
      learningItemId: "10000000-0000-4000-8000-000000000006",
      title: "Routed goal",
      topic: "Routed topic",
      kind: "test",
      deadline: null,
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "learn",
      rationale: "Learn, retrieve, and verify the bounded target.",
      createdAt,
      sessions: [
        baseSession(completedId, 1, "Self-explanation", "ready"),
        baseSession(nextId, 2, "Retrieval practice", "upcoming"),
      ],
    };
    const routed: LearningPlan = {
      ...raw,
      sessions: raw.sessions.map((session) => ({
        ...session,
        studyRoute: createCommittedInitialSessionStudyRoute({
          plan: raw,
          session,
          now: createdAt,
          origin: { source: "plan_activation", reason: "The learner activated this plan." },
        }),
      })),
    };
    const adaptation = {
      planSessionId: nextId,
      title: "Session 2",
      objective: "Explain and apply the target for session 2.",
      method: "Independent application and mixed practice",
      methodReason: "A strong result supports independent mixed application on the same target.",
      estimatedMinutes: 10,
      amountLabel: "One target · about 10 min",
      learningMode: "study" as const,
      explanation: "YOVA increased challenge after a strong independent result.",
    };
    const review: LearningPlanSession = {
      ...baseSession(reviewId, 2, "Independent retrieval verification", "ready"),
      title: "Verify the target",
      objective: "Retrieve and apply the target after a delay.",
      reviewConcept: "Bounded target",
      reviewType: "verify",
    };
    const transition = preparePostSessionStudyRouteTransition({
      plan: routed,
      completedSessionId: completedId,
      changedAt,
      adaptation,
      followUpSession: review,
    });
    const pending: PendingSessionCompletion = {
      userId: "10000000-0000-4000-8000-000000000007",
      queuedAt: changedAt,
      completion: {
        id: "10000000-0000-4000-8000-000000000008",
        planId,
        planSessionId: completedId,
        routeRevisionId: routed.sessions[0]!.studyRoute!.identity.routeRevisionId,
        startedAt: createdAt,
        completedAt: changedAt,
        plannedMinutes: 10,
        actualMinutes: 10,
        correctAnswers: 1,
        totalAnswers: 1,
        feedback: "about_right",
        observedGap: "No major gap detected.",
        conceptEvidence: [],
        confidenceEvidence: [],
      },
      adaptation,
      nextSessionStudyRoute: transition.nextSessionStudyRoute,
      followUpSession: transition.followUpSession,
      continuationSession: null,
    };

    expect(queueSessionCompletion(pending)).toBe(true);
    const loaded = loadQueuedSessionCompletions(pending.userId)[0]!;
    expect(loaded.nextSessionStudyRoute?.identity.routeRevisionId).toBe(
      transition.nextSessionStudyRoute?.identity.routeRevisionId,
    );
    expect(loaded.followUpSession?.studyRoute?.identity.routeLineageId).toBe(
      transition.followUpSession?.studyRoute?.identity.routeLineageId,
    );

    await flushQueuedSessionCompletions(pending.userId);
    expect(completeAuthenticatedPlanSession).toHaveBeenCalledWith(
      expect.objectContaining({ routeRevisionId: pending.completion.routeRevisionId }),
      adaptation,
      expect.objectContaining({
        studyRoute: expect.objectContaining({
          identity: expect.objectContaining({ sessionId: reviewId }),
        }),
      }),
      null,
      expect.objectContaining({
        identity: expect.objectContaining({ sessionId: nextId, revisionNumber: 2 }),
      }),
    );
  });
});
