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
});

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
