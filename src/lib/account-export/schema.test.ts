import { describe, expect, it } from "vitest";
import { DeviceExportAddendumSchema } from "@/lib/account-export/schema";

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
    const completion = {
      id: "33333333-3333-4333-8333-333333333333",
      planId: "44444444-4444-4444-8444-444444444444",
      planSessionId: "55555555-5555-4555-8555-555555555555",
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

  it("exports broad-recall recovery only through route-bound envelopes", () => {
    const routeRevisionId = "77777777-7777-4777-8777-777777777777";
    const broadProgress = {
      kind: "broad_recall" as const,
      format: "broad_recall_v1" as const,
      activityIndex: 0,
      gapCount: 1,
      bindings: [{
        targetId: "88888888-8888-4888-8888-888888888888",
        evidenceId: "blurting-final-check:88888888-8888-4888-8888-888888888888",
      }],
      events: [],
    };
    const routeBoundInterruption = {
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
      activityProgress: broadProgress,
    };
    const routeBoundCheckpoint = {
      ...baseCheckpoint(),
      version: 2 as const,
      routeRevisionId,
      activityProgress: broadProgress,
    };
    const routeBound = {
      ...baseAddendum(),
      pendingSessionInterruptions: [{
        userId: ACCOUNT_ID,
        interruption: routeBoundInterruption,
        queuedAt: "2026-08-17T00:01:00.000Z",
      }],
      activeSessionCheckpoints: [routeBoundCheckpoint],
    };

    expect(DeviceExportAddendumSchema.safeParse(routeBound).success).toBe(true);
    expect(DeviceExportAddendumSchema.safeParse({
      ...routeBound,
      pendingSessionInterruptions: [{
        ...routeBound.pendingSessionInterruptions[0],
        interruption: {
          ...routeBoundInterruption,
          routeRevisionId: undefined,
        },
      }],
    }).success).toBe(false);
    expect(DeviceExportAddendumSchema.safeParse({
      ...routeBound,
      activeSessionCheckpoints: [{
        ...routeBoundCheckpoint,
        version: 1,
        routeRevisionId: undefined,
      }],
    }).success).toBe(false);
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
