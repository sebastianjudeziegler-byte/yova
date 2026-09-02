import { describe, expect, it } from "vitest";
import { DeviceExportAddendumSchema } from "@/lib/account-export/schema";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { preparePostSessionStudyRouteTransition } from "@/lib/study-route/post-session-transition";
import { createCommittedInitialSessionStudyRoute } from "@/lib/study-route/session-route-creation";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

describe("DeviceExportAddendumSchema", () => {
  it("rebuilds browser state from allowlisted fields and drops nested extras", () => {
    const parsed = DeviceExportAddendumSchema.parse({
      ...baseAddendum(),
      previewSnapshot: {
        version: 1,
        account: {
          id: ACCOUNT_ID,
          email: "person@example.com",
          displayName: "Person",
          createdAt: "2026-08-17T00:00:00.000Z",
          identityMode: "supabase",
          emailVerified: true,
          sessionToken: "must-not-export",
        },
        signedIn: true,
        onboardingAnswers: [],
        onboardingCompleted: true,
        alphaEntered: true,
        plans: [],
        deadlineMilestones: [],
        sessionCompletions: [],
        sessionInterruptions: [],
        updatedAt: "2026-08-17T00:00:00.000Z",
        arbitraryLocalStorage: { secret: true },
      },
    });

    expect(parsed.previewSnapshot?.account).not.toHaveProperty("sessionToken");
    expect(parsed.previewSnapshot).not.toHaveProperty("arbitraryLocalStorage");
    expect(JSON.stringify(parsed)).not.toContain("must-not-export");
  });

  it("rejects state belonging to another account", () => {
    const parsed = DeviceExportAddendumSchema.safeParse({
      ...baseAddendum(),
      pendingSessionInterruptions: [{
        userId: "22222222-2222-4222-8222-222222222222",
        interruption: {
          id: "33333333-3333-4333-8333-333333333333",
          planId: "44444444-4444-4444-8444-444444444444",
          planSessionId: "55555555-5555-4555-8555-555555555555",
          startedAt: "2026-08-17T00:00:00.000Z",
          interruptedAt: "2026-08-17T00:01:00.000Z",
          plannedMinutes: 20,
          actualMinutes: 1,
          completedSteps: 0,
          totalSteps: 4,
        },
        queuedAt: "2026-08-17T00:01:00.000Z",
      }],
    });

    expect(parsed.success).toBe(false);
  });

  it("preserves completion provenance and defaults legacy records to guided", () => {
    const routeRevisionId = "77777777-7777-4777-8777-777777777777";
    const completion = {
      id: "33333333-3333-4333-8333-333333333333",
      planId: "44444444-4444-4444-8444-444444444444",
      planSessionId: "55555555-5555-4555-8555-555555555555",
      routeRevisionId,
      startedAt: "2026-08-17T00:00:00.000Z",
      completedAt: "2026-08-17T00:10:00.000Z",
      plannedMinutes: 10,
      actualMinutes: 10,
      correctAnswers: 0,
      totalAnswers: 0,
      feedback: "about_right",
      observedGap: "No topic evidence recorded.",
      conceptEvidence: [],
      confidenceEvidence: [],
    };
    const parsed = DeviceExportAddendumSchema.parse({
      ...baseAddendum(),
      pendingSessionCompletions: [{
        userId: ACCOUNT_ID,
        completion,
        adaptation: null,
        followUpSession: null,
        queuedAt: "2026-08-17T00:10:00.000Z",
      }, {
        userId: ACCOUNT_ID,
        completion: {
          ...completion,
          id: "66666666-6666-4666-8666-666666666666",
          completionMode: "unguided_practice",
        },
        adaptation: null,
        followUpSession: null,
        queuedAt: "2026-08-17T00:10:00.000Z",
      }],
    });

    expect(parsed.pendingSessionCompletions.map((entry) => entry.completion.completionMode))
      .toEqual(["guided", "unguided_practice"]);
    expect(parsed.pendingSessionCompletions.map((entry) => entry.completion.routeRevisionId))
      .toEqual([routeRevisionId, routeRevisionId]);
  });

  it("round-trips the complete routed completion recovery envelope", () => {
    const now = "2026-08-23T09:00:00.000Z";
    const planId = "10000000-0000-4000-8000-000000000001";
    const completedSession = recoverySession(
      "10000000-0000-4000-8000-000000000002",
      1,
      "ready",
    );
    const nextSession = recoverySession(
      "10000000-0000-4000-8000-000000000003",
      2,
      "upcoming",
    );
    const followUpSession = recoverySession(
      "10000000-0000-4000-8000-000000000004",
      3,
      "ready",
    );
    const continuationSession = recoverySession(
      "10000000-0000-4000-8000-000000000005",
      4,
      "ready",
    );
    const rawPlan: LearningPlan = {
      id: planId,
      learningItemId: "10000000-0000-4000-8000-000000000006",
      title: "Routed recovery plan",
      topic: "Routed recovery topic",
      kind: "test",
      deadline: null,
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "learn",
      rationale: "Preserve the exact routed session transition for recovery.",
      createdAt: now,
      sessions: [completedSession, nextSession],
    };
    const routedPlan: LearningPlan = {
      ...rawPlan,
      sessions: rawPlan.sessions.map((session) => ({
        ...session,
        studyRoute: createCommittedInitialSessionStudyRoute({
          plan: rawPlan,
          session,
          now,
          origin: {
            source: "plan_activation",
            reason: "The learner activated this routed recovery plan.",
          },
        }),
      })),
    };
    const adaptation = {
      planSessionId: nextSession.id,
      title: nextSession.title,
      objective: nextSession.objective,
      method: "Self-explanation",
      methodReason: "Explaining the target responds to the completed-session evidence.",
      estimatedMinutes: nextSession.estimatedMinutes,
      amountLabel: nextSession.amountLabel,
      learningMode: nextSession.learningMode,
      explanation: "The next route retains the exact post-session decision.",
    };
    const adaptedTransition = preparePostSessionStudyRouteTransition({
      plan: routedPlan,
      completedSessionId: completedSession.id,
      changedAt: "2026-08-23T09:10:00.000Z",
      adaptation,
      followUpSession,
    });
    const continuationTransition = preparePostSessionStudyRouteTransition({
      plan: routedPlan,
      completedSessionId: completedSession.id,
      changedAt: "2026-08-23T09:10:00.000Z",
      continuationSession,
    });
    const completedRoute = routedPlan.sessions[0]!.studyRoute!;
    const completionFor = (id: string) => ({
      id,
      planId,
      planSessionId: completedSession.id,
      routeRevisionId: completedRoute.identity.routeRevisionId,
      startedAt: now,
      completedAt: "2026-08-23T09:10:00.000Z",
      plannedMinutes: 10,
      actualMinutes: 10,
      correctAnswers: 1,
      totalAnswers: 1,
      feedback: "about_right" as const,
      observedGap: "No major gap detected.",
      completionMode: "guided" as const,
      conceptEvidence: [],
      confidenceEvidence: [],
    });
    const adaptedPending = {
      userId: ACCOUNT_ID,
      completion: completionFor("10000000-0000-4000-8000-000000000007"),
      adaptation,
      followUpSession: adaptedTransition.followUpSession,
      continuationSession: null,
      nextSessionStudyRoute: adaptedTransition.nextSessionStudyRoute,
      queuedAt: "2026-08-23T09:10:01.000Z",
    };
    const continuationPending = {
      userId: ACCOUNT_ID,
      completion: completionFor("10000000-0000-4000-8000-000000000009"),
      adaptation: null,
      followUpSession: null,
      continuationSession: continuationTransition.continuationSession,
      nextSessionStudyRoute: null,
      queuedAt: "2026-08-23T09:10:02.000Z",
    };

    const parsed = DeviceExportAddendumSchema.parse(JSON.parse(JSON.stringify({
      ...baseAddendum(),
      pendingSessionCompletions: [adaptedPending, continuationPending],
    })));
    const recoveredAdaptation = parsed.pendingSessionCompletions[0]!;
    const recoveredContinuation = parsed.pendingSessionCompletions[1]!;

    expect(recoveredAdaptation.completion.routeRevisionId)
      .toBe(completedRoute.identity.routeRevisionId);
    expect(recoveredAdaptation.nextSessionStudyRoute)
      .toEqual(adaptedTransition.nextSessionStudyRoute);
    expect(recoveredAdaptation.followUpSession?.studyRoute)
      .toEqual(adaptedTransition.followUpSession?.studyRoute);
    expect(recoveredContinuation.continuationSession?.studyRoute)
      .toEqual(continuationTransition.continuationSession?.studyRoute);
  });

  it("exports ratings-only activity recovery without accepting learner draft text", () => {
    const activityProgress = {
      kind: "retrieval_round" as const,
      activityIndex: 0,
      promptCount: 3,
      ratings: ["partly" as const],
    };
    const addendum = {
      ...baseAddendum(),
      pendingSessionInterruptions: [{
        userId: ACCOUNT_ID,
        interruption: {
          id: "33333333-3333-4333-8333-333333333333",
          planId: "44444444-4444-4444-8444-444444444444",
          planSessionId: "55555555-5555-4555-8555-555555555555",
          startedAt: "2026-08-17T00:00:00.000Z",
          interruptedAt: "2026-08-17T00:01:00.000Z",
          plannedMinutes: 20,
          actualMinutes: 1,
          completedSteps: 0,
          totalSteps: 4,
          activityProgress,
        },
        queuedAt: "2026-08-17T00:01:00.000Z",
      }],
      activeSessionCheckpoints: [{
        version: 1,
        accountId: ACCOUNT_ID,
        runId: "66666666-6666-4666-8666-666666666666",
        planId: "44444444-4444-4444-8444-444444444444",
        planSessionId: "55555555-5555-4555-8555-555555555555",
        status: "working",
        startedAt: "2026-08-17T00:00:00.000Z",
        savedAt: "2026-08-17T00:01:00.000Z",
        activeSeconds: 60,
        plannedMinutes: 20,
        completedSteps: 0,
        totalSteps: 4,
        resumeStep: 0,
        resourceFingerprint: "sr1:0123456789abcdef",
        activityProgress,
      }],
    };

    const parsed = DeviceExportAddendumSchema.parse(addendum);
    expect(parsed.pendingSessionInterruptions[0]?.interruption.activityProgress)
      .toEqual(activityProgress);
    expect(parsed.activeSessionCheckpoints[0]?.activityProgress).toEqual(activityProgress);

    const unsafe = structuredClone(addendum);
    (unsafe.activeSessionCheckpoints[0]!.activityProgress as typeof activityProgress & {
      answerDraft?: string;
    }).answerDraft = "PRIVATE RECALL DRAFT";
    expect(DeviceExportAddendumSchema.safeParse(unsafe).success).toBe(false);
  });

  it("exports old recovery envelopes after dropping their retired activity marker", () => {
    const routeRevisionId = "77777777-7777-4777-8777-777777777777";
    const routeBound = {
      ...baseAddendum(),
      pendingSessionInterruptions: [{
        userId: ACCOUNT_ID,
        interruption: {
          id: "33333333-3333-4333-8333-333333333333",
          planId: "44444444-4444-4444-8444-444444444444",
          planSessionId: "55555555-5555-4555-8555-555555555555",
          routeRevisionId,
          startedAt: "2026-08-17T00:00:00.000Z",
          interruptedAt: "2026-08-17T00:01:00.000Z",
          plannedMinutes: 20,
          actualMinutes: 1,
          completedSteps: 0,
          totalSteps: 4,
          activityProgress: { kind: "broad_recall", legacyPayload: "ignored" },
        },
        queuedAt: "2026-08-17T00:01:00.000Z",
      }],
      activeSessionCheckpoints: [{
        ...baseCheckpoint(),
        version: 2,
        routeRevisionId,
        activityProgress: { kind: "broad_recall", legacyPayload: "ignored" },
      }],
    };

    const parsed = DeviceExportAddendumSchema.parse(routeBound);

    expect(parsed.pendingSessionInterruptions[0]?.interruption).toMatchObject({
      routeRevisionId,
      completedSteps: 0,
      totalSteps: 4,
    });
    expect(parsed.pendingSessionInterruptions[0]?.interruption)
      .not.toHaveProperty("activityProgress");
    expect(parsed.activeSessionCheckpoints[0]).not.toHaveProperty("activityProgress");
  });
  it("exports route-bound recovery markers without weakening legacy checkpoint reads", () => {
    const routeRevisionId = "77777777-7777-4777-8777-777777777777";
    const legacyCheckpoint = baseCheckpoint();
    const routeBoundCheckpoint = {
      ...baseCheckpoint(),
      version: 2,
      runId: "88888888-8888-4888-8888-888888888888",
      routeRevisionId,
    };

    const parsed = DeviceExportAddendumSchema.parse({
      ...baseAddendum(),
      activeSessionCheckpoints: [legacyCheckpoint, routeBoundCheckpoint],
    });

    expect(parsed.activeSessionCheckpoints).toEqual([
      legacyCheckpoint,
      routeBoundCheckpoint,
    ]);
    expect(DeviceExportAddendumSchema.safeParse({
      ...baseAddendum(),
      activeSessionCheckpoints: [{
        ...routeBoundCheckpoint,
        routeRevisionId: undefined,
      }],
    }).success).toBe(false);
  });
});

function baseCheckpoint() {
  return {
    version: 1 as const,
    accountId: ACCOUNT_ID,
    runId: "66666666-6666-4666-8666-666666666666",
    planId: "44444444-4444-4444-8444-444444444444",
    planSessionId: "55555555-5555-4555-8555-555555555555",
    status: "working" as const,
    startedAt: "2026-08-17T00:00:00.000Z",
    savedAt: "2026-08-17T00:01:00.000Z",
    activeSeconds: 60,
    plannedMinutes: 20,
    completedSteps: 0,
    totalSteps: 4,
    resumeStep: 0,
    resourceFingerprint: "sr1:0123456789abcdef",
  };
}

function recoverySession(
  id: string,
  sequence: number,
  status: LearningPlanSession["status"],
): LearningPlanSession {
  return {
    id,
    sequence,
    title: `Recovery session ${sequence}`,
    objective: "Explain and retrieve one bounded target.",
    method: "Retrieval practice",
    methodReason: "Retrieval provides observable evidence for the exact target.",
    scheduledFor: "2026-08-24T09:00:00.000Z",
    estimatedMinutes: 10,
    amountLabel: "One target · about 10 min",
    learningMode: "study",
    topicIds: ["10000000-0000-4000-8000-000000000008"],
    contentTargets: ["One bounded target"],
    completionEvidence: ["Explain the bounded target without notes."],
    status,
  };
}

function baseAddendum() {
  return {
    schemaVersion: 1,
    accountId: ACCOUNT_ID,
    capturedAt: "2026-08-17T00:00:00.000Z",
    previewSnapshot: null,
    pendingSessionCompletions: [],
    pendingSessionInterruptions: [],
    activeSessionCheckpoints: [],
  };
}
