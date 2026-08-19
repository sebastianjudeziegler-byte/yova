import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInterruption, SessionResource } from "@/lib/domain";
import {
  ACTIVE_SESSION_CHECKPOINT_TTL_MS,
  checkpointToSessionResumePoint,
  checkpointMatchesSessionResource,
  chooseLatestSessionResumePoint,
  clearActiveSessionCheckpoints,
  compareActiveSessionCheckpointProgress,
  fingerprintSessionResource,
  latestActiveSessionCheckpointFor,
  loadActiveSessionCheckpoints,
  mergeActiveSessionCheckpoints,
  readActiveSessionCheckpoint,
  removeActiveSessionCheckpoint,
  removeActiveSessionCheckpointsForPlan,
  replaceActiveSessionCheckpointsForAccount,
  restoreCheckpointSessionResources,
  saveActiveSessionCheckpoint,
  type ActiveSessionCheckpointV1,
} from "@/lib/learning/active-session-checkpoint";

const NOW = "2026-08-17T18:00:00.000Z";

function installMemoryStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal("window", { localStorage });
  return { localStorage, values };
}

function evidence() {
  return {
    correctAnswers: 1,
    totalAnswers: 1,
    conceptEvidence: [{
      concept: "ATP coupling",
      outcome: "secure" as const,
      activityType: "multiple_choice" as const,
    }],
    confidenceEvidence: [],
    observedGap: "No gap observed yet.",
    completedImmediateRepairs: 0,
  };
}

function checkpoint(
  overrides: Partial<ActiveSessionCheckpointV1> = {},
): ActiveSessionCheckpointV1 {
  return {
    version: 1,
    accountId: "preview_user_alpha",
    runId: "00000000-0000-4000-8000-000000000001",
    planId: "00000000-0000-4000-8000-000000000002",
    planSessionId: "00000000-0000-4000-8000-000000000003",
    status: "working",
    startedAt: "2026-08-17T17:50:00.000Z",
    savedAt: NOW,
    activeSeconds: 420,
    plannedMinutes: 25,
    completedSteps: 1,
    totalSteps: 5,
    resumeStep: 1,
    resourceFingerprint: "sr1:0123456789abcdef",
    evidence: evidence(),
    ...overrides,
  } as ActiveSessionCheckpointV1;
}

function awaitingFinishCheckpoint(
  overrides: Partial<ActiveSessionCheckpointV1> = {},
): ActiveSessionCheckpointV1 {
  return {
    ...checkpoint(),
    status: "awaiting_finish",
    completedSteps: 5,
    resumeStep: 5,
    completedAt: "2026-08-17T17:59:30.000Z",
    completionFeedback: "about_right",
    evidence: evidence(),
    ...overrides,
  } as ActiveSessionCheckpointV1;
}

function interruption(overrides: Partial<SessionInterruption> = {}): SessionInterruption {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    planId: "00000000-0000-4000-8000-000000000002",
    planSessionId: "00000000-0000-4000-8000-000000000003",
    startedAt: "2026-08-17T17:30:00.000Z",
    interruptedAt: "2026-08-17T17:45:00.000Z",
    plannedMinutes: 25,
    actualMinutes: 15,
    completedSteps: 2,
    totalSteps: 5,
    ...overrides,
  };
}

function resource(body = "Read the explanation before answering."): SessionResource {
  return {
    rationale: "Teach first, then check retrieval.",
    activities: [{
      type: "instruction",
      concept: null,
      label: "Learn",
      title: "Build the core model",
      body,
      choices: [],
      correctAnswer: null,
      feedback: null,
    }],
    generatedAt: "2026-08-17T17:49:00.000Z",
    origin: "generated",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("active session checkpoint storage", () => {
  it("keeps an already-deployed local checkpoint without generated lesson identity readable", () => {
    installMemoryStorage();
    const legacyLocal = checkpoint();

    expect(legacyLocal.resourceGeneratedAt).toBeUndefined();
    expect(saveActiveSessionCheckpoint(legacyLocal)).toBe(true);
    expect(loadActiveSessionCheckpoints(legacyLocal.accountId)).toEqual([legacyLocal]);
  });

  it("keeps only the latest checkpoint per account and plan session", () => {
    installMemoryStorage();
    const earlier = checkpoint({ savedAt: "2026-08-17T17:55:00.000Z", completedSteps: 0, resumeStep: 0 });
    const later = checkpoint({ savedAt: "2026-08-17T17:58:00.000Z", completedSteps: 2, resumeStep: 2 });
    const otherSession = checkpoint({
      runId: "00000000-0000-4000-8000-000000000004",
      planSessionId: "00000000-0000-4000-8000-000000000005",
    });
    const otherAccount = checkpoint({
      accountId: "preview_user_beta",
      runId: "00000000-0000-4000-8000-000000000006",
    });

    expect(saveActiveSessionCheckpoint(earlier)).toBe(true);
    expect(saveActiveSessionCheckpoint(later)).toBe(true);
    expect(saveActiveSessionCheckpoint(otherSession)).toBe(true);
    expect(saveActiveSessionCheckpoint(otherAccount)).toBe(true);

    const loaded = loadActiveSessionCheckpoints("preview_user_alpha");
    expect(loaded).toHaveLength(2);
    expect(latestActiveSessionCheckpointFor(later.planSessionId, loaded)).toMatchObject({
      completedSteps: 2,
      savedAt: later.savedAt,
    });
    expect(loadActiveSessionCheckpoints("preview_user_beta")).toHaveLength(1);
  });

  it("does not let an older late write replace newer progress", () => {
    installMemoryStorage();
    const newer = checkpoint({ savedAt: "2026-08-17T17:55:00.000Z", completedSteps: 3, resumeStep: 3 });
    const older = checkpoint({ savedAt: "2026-08-17T17:59:00.000Z", completedSteps: 1, resumeStep: 1 });

    expect(saveActiveSessionCheckpoint(newer)).toBe(true);
    expect(saveActiveSessionCheckpoint(older)).toBe(true);

    expect(loadActiveSessionCheckpoints(newer.accountId)).toEqual([newer]);
  });

  it("treats a different generatedAt as a different local lesson source", () => {
    installMemoryStorage();
    const olderGeneration = checkpoint({
      resourceGeneratedAt: "2026-08-17T17:40:00.000Z",
      savedAt: "2026-08-17T17:55:00.000Z",
      completedSteps: 3,
      resumeStep: 3,
    });
    const regeneratedLesson = checkpoint({
      resourceGeneratedAt: "2026-08-17T17:45:00.000Z",
      savedAt: "2026-08-17T17:59:00.000Z",
      completedSteps: 1,
      resumeStep: 1,
    });

    expect(saveActiveSessionCheckpoint(olderGeneration)).toBe(true);
    expect(saveActiveSessionCheckpoint(regeneratedLesson)).toBe(true);
    expect(loadActiveSessionCheckpoints(olderGeneration.accountId)).toEqual([regeneratedLesson]);
  });

  it("orders offset timestamps by the instant they represent", () => {
    const planSessionId = checkpoint().planSessionId;
    const earlierWithLargerClockText = checkpoint({
      savedAt: "2026-08-17T18:10:00+01:00",
      completedSteps: 0,
      resumeStep: 0,
    });
    const laterInUtc = checkpoint({
      savedAt: "2026-08-17T17:55:00.000Z",
      completedSteps: 2,
      resumeStep: 2,
    });

    expect(latestActiveSessionCheckpointFor(
      planSessionId,
      [earlierWithLargerClockText, laterInUtc],
    )).toBe(laterInUtc);
  });

  it("expires stale checkpoints after the bounded recovery window", () => {
    const { values } = installMemoryStorage();
    expect(saveActiveSessionCheckpoint(checkpoint())).toBe(true);

    vi.setSystemTime(new Date(Date.parse(NOW) + ACTIVE_SESSION_CHECKPOINT_TTL_MS + 1));

    expect(loadActiveSessionCheckpoints("preview_user_alpha")).toEqual([]);
    expect(values.size).toBe(0);
  });

  it("removes one run or all checkpoints for an account without touching another account", () => {
    installMemoryStorage();
    const own = checkpoint();
    const ownOtherSession = checkpoint({
      runId: "00000000-0000-4000-8000-000000000004",
      planSessionId: "00000000-0000-4000-8000-000000000005",
    });
    const otherAccount = checkpoint({
      accountId: "preview_user_beta",
      runId: "00000000-0000-4000-8000-000000000006",
    });
    saveActiveSessionCheckpoint(own);
    saveActiveSessionCheckpoint(ownOtherSession);
    saveActiveSessionCheckpoint(otherAccount);

    expect(removeActiveSessionCheckpoint(
      own.accountId,
      own.planSessionId,
      "00000000-0000-4000-8000-000000000099",
    )).toBe(true);
    expect(loadActiveSessionCheckpoints(own.accountId)).toHaveLength(2);
    expect(removeActiveSessionCheckpoint(own.accountId, own.planSessionId, own.runId)).toBe(true);
    expect(loadActiveSessionCheckpoints(own.accountId)).toHaveLength(1);
    expect(clearActiveSessionCheckpoints(own.accountId)).toBe(true);
    expect(loadActiveSessionCheckpoints(own.accountId)).toEqual([]);
    expect(loadActiveSessionCheckpoints(otherAccount.accountId)).toHaveLength(1);
  });

  it("removes every checkpoint for one deleted plan without touching sibling plans or accounts", () => {
    installMemoryStorage();
    const own = checkpoint();
    const siblingPlan = checkpoint({
      planId: "00000000-0000-4000-8000-000000000081",
      planSessionId: "00000000-0000-4000-8000-000000000082",
      runId: "00000000-0000-4000-8000-000000000083",
    });
    const otherAccount = checkpoint({
      accountId: "preview_user_beta",
      runId: "00000000-0000-4000-8000-000000000084",
    });
    saveActiveSessionCheckpoint(own);
    saveActiveSessionCheckpoint(siblingPlan);
    saveActiveSessionCheckpoint(otherAccount);

    expect(removeActiveSessionCheckpointsForPlan(own.accountId, own.planId)).toBe(true);
    expect(loadActiveSessionCheckpoints(own.accountId)).toEqual([siblingPlan]);
    expect(loadActiveSessionCheckpoints(otherAccount.accountId)).toEqual([otherAccount]);
  });

  it("round-trips unguided completion provenance through browser recovery storage", () => {
    installMemoryStorage();
    const finished = awaitingFinishCheckpoint({ completionMode: "unguided_practice" });

    expect(saveActiveSessionCheckpoint(finished)).toBe(true);
    expect(loadActiveSessionCheckpoints(finished.accountId)).toEqual([finished]);
    expect(
      checkpointToSessionResumePoint(loadActiveSessionCheckpoints(finished.accountId)[0]!)
        .completionMode,
    ).toBe("unguided_practice");
  });

  it("returns failure without overwriting data when browser storage is unavailable", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => { throw new Error("blocked"); },
        removeItem: () => { throw new Error("blocked"); },
      },
    });

    expect(saveActiveSessionCheckpoint(checkpoint())).toBe(false);
    expect(removeActiveSessionCheckpoint("preview_user_alpha", checkpoint().planSessionId)).toBe(false);
    expect(clearActiveSessionCheckpoints("preview_user_alpha")).toBe(false);
    expect(loadActiveSessionCheckpoints("preview_user_alpha")).toEqual([]);
  });

  it("removes malformed checkpoint data so reset and sign-out cleanup cannot be blocked", () => {
    const { values } = installMemoryStorage();
    values.set("yova.active-session-checkpoints.v1", "{private checkpoint text");

    expect(clearActiveSessionCheckpoints("preview_user_alpha")).toBe(true);
    expect(values.has("yova.active-session-checkpoints.v1")).toBe(false);
    expect(saveActiveSessionCheckpoint(checkpoint())).toBe(true);
  });

  it("atomically replaces one account after cloud reconciliation and preserves other accounts", () => {
    installMemoryStorage();
    const newerBrowserRun = checkpoint({
      runId: "00000000-0000-4000-8000-000000000071",
      savedAt: "2026-08-17T17:59:00.000Z",
      completedSteps: 4,
      resumeStep: 4,
    });
    const cloudRun = checkpoint({
      runId: "00000000-0000-4000-8000-000000000072",
      savedAt: "2026-08-17T17:55:00.000Z",
      completedSteps: 1,
      resumeStep: 1,
    });
    const otherAccount = checkpoint({
      accountId: "preview_user_beta",
      runId: "00000000-0000-4000-8000-000000000073",
    });
    saveActiveSessionCheckpoint(newerBrowserRun);
    saveActiveSessionCheckpoint(otherAccount);

    expect(replaceActiveSessionCheckpointsForAccount(
      newerBrowserRun.accountId,
      [cloudRun],
    )).toBe(true);

    expect(loadActiveSessionCheckpoints(newerBrowserRun.accountId)).toEqual([cloudRun]);
    expect(loadActiveSessionCheckpoints(otherAccount.accountId)).toEqual([otherAccount]);
  });

  it("refuses an invalid or cross-account atomic replacement without changing storage", () => {
    installMemoryStorage();
    const original = checkpoint();
    saveActiveSessionCheckpoint(original);
    const crossAccount = checkpoint({ accountId: "preview_user_beta" });

    expect(replaceActiveSessionCheckpointsForAccount(original.accountId, [crossAccount])).toBe(false);
    expect(replaceActiveSessionCheckpointsForAccount(original.accountId, [{
      ...original,
      selectedAnswer: "Private answer",
    } as unknown as ActiveSessionCheckpointV1])).toBe(false);
    expect(loadActiveSessionCheckpoints(original.accountId)).toEqual([original]);
  });

  it("persists only source-derived repair identity, never generated repair or evaluation prose", () => {
    const { values } = installMemoryStorage();
    const unsafeRepair = {
      concept: "ATP coupling",
      correctAnswer: "ATP hydrolysis can drive an endergonic reaction.",
      body: "PRIVATE-DRAFT-7c2d9e echoed from the learner answer",
      repairSupport: { retryPrompt: "PRIVATE-DRAFT-7c2d9e" },
    };

    expect(saveActiveSessionCheckpoint(checkpoint({
      pendingRepair: unsafeRepair,
    } as Partial<ActiveSessionCheckpointV1>))).toBe(false);
    expect(JSON.stringify([...values.values()])).not.toContain("PRIVATE-DRAFT-7c2d9e");

    expect(saveActiveSessionCheckpoint(checkpoint({
      pendingRepair: {
        concept: unsafeRepair.concept,
        correctAnswer: unsafeRepair.correctAnswer,
      },
    }))).toBe(true);
    const resume = checkpointToSessionResumePoint(loadActiveSessionCheckpoints("preview_user_alpha")[0]!);
    expect(resume.pendingRepair).toMatchObject({
      concept: "ATP coupling",
      correctAnswer: unsafeRepair.correctAnswer,
    });
    expect(resume.pendingRepair?.body).toContain(unsafeRepair.correctAnswer);
    expect(JSON.stringify([...values.values()])).not.toContain("PRIVATE-DRAFT-7c2d9e");
  });

  it("prunes the oldest checkpoints before the persisted array exceeds its size bound", () => {
    const { values } = installMemoryStorage();
    const longText = "x".repeat(300);
    const largeEvidence = {
      correctAnswers: 0,
      totalAnswers: 24,
      conceptEvidence: Array.from({ length: 24 }, (_, index) => ({
        concept: `Concept ${index}`,
        outcome: "needs_review" as const,
        activityType: "free_response" as const,
        misconceptionSummary: longText,
      })),
      confidenceEvidence: Array.from({ length: 24 }, (_, index) => ({
        concept: `Concept ${index}`,
        confidence: "very_sure" as const,
        correct: false,
        activityType: "free_response" as const,
        misconceptionSummary: longText,
      })),
      observedGap: "g".repeat(1_000),
      completedImmediateRepairs: 4,
    };

    for (let index = 0; index < 48; index += 1) {
      expect(saveActiveSessionCheckpoint(checkpoint({
        accountId: `account_${Math.floor(index / 12)}`,
        runId: `run_${index}`,
        planId: `plan_${index}`,
        planSessionId: `session_${index}`,
        savedAt: new Date(Date.parse(NOW) - (47 - index) * 1_000).toISOString(),
        evidence: largeEvidence,
      }))).toBe(true);
    }

    const serialized = [...values.values()][0] ?? "";
    expect(serialized.length).toBeGreaterThan(0);
    expect(serialized.length).toBeLessThanOrEqual(500_000);
    expect(loadActiveSessionCheckpoints("account_3").some((entry) => entry.runId === "run_47"))
      .toBe(true);
  });

  it("rejects unbounded or root-level raw answer fields and strips unknown nested evidence", () => {
    const { values } = installMemoryStorage();
    const withRawAnswer = {
      ...checkpoint(),
      selectedAnswer: "A private free-response draft",
    } as unknown as ActiveSessionCheckpointV1;

    expect(saveActiveSessionCheckpoint(withRawAnswer)).toBe(false);
    expect(values.size).toBe(0);

    const nestedUnknown = {
      ...checkpoint(),
      evidence: {
        ...evidence(),
        learnerAnswer: "A second private draft",
      },
    } as unknown as ActiveSessionCheckpointV1;
    expect(saveActiveSessionCheckpoint(nestedUnknown)).toBe(true);
    const serialized = [...values.values()].join("");
    expect(serialized).not.toContain("learnerAnswer");
    expect(serialized).not.toContain("private draft");

    expect(saveActiveSessionCheckpoint(checkpoint({ activeSeconds: 21_601 }))).toBe(false);
    expect(saveActiveSessionCheckpoint(checkpoint({ totalSteps: 25 }))).toBe(false);
    expect(saveActiveSessionCheckpoint(checkpoint({ completedSteps: 0, resumeStep: 1 }))).toBe(false);
  });
});

describe("cloud active session checkpoint reconciliation", () => {
  it("rejects expired, malformed, and nested raw-answer cloud data", () => {
    expect(readActiveSessionCheckpoint(checkpoint())).toEqual(checkpoint());
    expect(readActiveSessionCheckpoint({
      ...checkpoint(),
      evidence: {
        ...evidence(),
        learnerAnswer: "A private free-response draft",
      },
    })).toBeNull();
    expect(readActiveSessionCheckpoint({
      ...checkpoint(),
      completedSteps: 6,
    })).toBeNull();
    expect(readActiveSessionCheckpoint(checkpoint({
      savedAt: new Date(Date.parse(NOW) - ACTIVE_SESSION_CHECKPOINT_TTL_MS - 1).toISOString(),
    }))).toBeNull();
  });

  it("orders progress before wall-clock recency", () => {
    const base = checkpoint({
      savedAt: "2026-08-17T17:59:00.000Z",
      completedSteps: 1,
      resumeStep: 1,
      activeSeconds: 500,
    });
    const moreActiveTime = checkpoint({ ...base, activeSeconds: 501 });
    const laterResume = checkpoint({ ...base, activeSeconds: 1, resumeStep: 2, completedSteps: 2 });
    const finished = awaitingFinishCheckpoint({
      savedAt: "2026-08-17T17:58:00.000Z",
      activeSeconds: 1,
    });

    expect(compareActiveSessionCheckpointProgress(moreActiveTime, base)).toBeGreaterThan(0);
    expect(compareActiveSessionCheckpointProgress(laterResume, moreActiveTime)).toBeGreaterThan(0);
    expect(compareActiveSessionCheckpointProgress(finished, laterResume)).toBeGreaterThan(0);
  });

  it("uploads a same-run browser checkpoint only when it is ahead", () => {
    const cloud = checkpoint({
      savedAt: "2026-08-17T17:59:00.000Z",
      completedSteps: 1,
      resumeStep: 1,
    });
    const local = checkpoint({
      savedAt: "2026-08-17T17:58:00.000Z",
      completedSteps: 2,
      resumeStep: 2,
    });

    const merged = mergeActiveSessionCheckpoints([local], [cloud]);

    expect(merged.checkpoints).toEqual([local]);
    expect(merged.checkpointsToUpload).toEqual([local]);
    expect(merged.cloudRunIds.size).toBe(0);
    expect(merged.conflictingLocalRuns).toEqual([]);
  });

  it("uses same-run cloud progress when it is equal or ahead", () => {
    const local = checkpoint({
      savedAt: "2026-08-17T17:58:00.000Z",
      completedSteps: 1,
      resumeStep: 1,
    });
    const cloud = checkpoint({
      savedAt: "2026-08-17T17:59:00.000Z",
      completedSteps: 2,
      resumeStep: 2,
    });

    const merged = mergeActiveSessionCheckpoints([local], [cloud]);

    expect(merged.checkpoints).toEqual([cloud]);
    expect(merged.cloudRunIds.has(cloud.runId)).toBe(true);
    expect(merged.checkpointsToUpload).toEqual([]);
    expect(merged.conflictingLocalRuns).toEqual([]);
  });

  it("keeps cloud authoritative across a different run or lesson fingerprint", () => {
    const cloud = checkpoint({
      runId: "00000000-0000-4000-8000-000000000090",
      completedSteps: 0,
      resumeStep: 0,
      activeSeconds: 10,
    });
    const differentRun = awaitingFinishCheckpoint();
    const runConflict = mergeActiveSessionCheckpoints([differentRun], [cloud]);

    expect(runConflict.checkpoints).toEqual([cloud]);
    expect(runConflict.cloudRunIds.has(cloud.runId)).toBe(true);
    expect(runConflict.checkpointsToUpload).toEqual([]);
    expect(runConflict.conflictingLocalRuns).toEqual([differentRun]);

    const differentLesson = checkpoint({ resourceFingerprint: "sr1:fedcba9876543210" });
    const lessonConflict = mergeActiveSessionCheckpoints([differentLesson], [checkpoint()]);
    expect(lessonConflict.checkpoints).toEqual([checkpoint()]);
    expect(lessonConflict.conflictingLocalRuns).toEqual([differentLesson]);
  });

  it("treats a regenerated lesson as a conflict even when its content hash is unchanged", () => {
    const local = checkpoint({ resourceGeneratedAt: "2026-08-17T17:40:00.000Z" });
    const cloud = checkpoint({ resourceGeneratedAt: "2026-08-17T17:45:00.000Z" });

    const merged = mergeActiveSessionCheckpoints([local], [cloud]);

    expect(merged.checkpoints).toEqual([cloud]);
    expect(merged.cloudRunIds.has(cloud.runId)).toBe(true);
    expect(merged.checkpointsToUpload).toEqual([]);
    expect(merged.conflictingLocalRuns).toEqual([local]);
  });

  it("uploads local-only sessions and keeps cloud-only sessions", () => {
    const local = checkpoint({
      planSessionId: "00000000-0000-4000-8000-000000000011",
      runId: "00000000-0000-4000-8000-000000000012",
    });
    const cloud = checkpoint({
      planSessionId: "00000000-0000-4000-8000-000000000021",
      runId: "00000000-0000-4000-8000-000000000022",
    });

    const merged = mergeActiveSessionCheckpoints([local], [cloud]);

    expect(merged.checkpoints).toEqual([local, cloud]);
    expect(merged.checkpointsToUpload).toEqual([local]);
    expect(merged.cloudRunIds.has(cloud.runId)).toBe(true);
  });
});

describe("browser-only session resource recovery", () => {
  function planWithResource(sessionResource?: SessionResource) {
    return {
      id: checkpoint().planId,
      learningItemId: "00000000-0000-4000-8000-000000000020",
      title: "Biology review",
      topic: "Cell energy",
      kind: "topic" as const,
      deadline: null,
      status: "active" as const,
      sourceMode: "yova_generated" as const,
      studyMode: "inside_yova" as const,
      learningIntent: "learn" as const,
      rationale: "Build a durable model.",
      createdAt: "2026-08-17T17:00:00.000Z",
      sessions: [{
        id: checkpoint().planSessionId,
        sequence: 1,
        title: "ATP coupling",
        objective: "Explain ATP coupling.",
        method: "Self-explanation",
        methodReason: "Make the causal chain explicit.",
        scheduledFor: "2026-08-17T17:30:00.000Z",
        estimatedMinutes: 25,
        amountLabel: "One focused session",
        learningMode: "learn" as const,
        status: "ready" as const,
        ...(sessionResource ? { resource: sessionResource } : {}),
      }],
    };
  }

  it("restores a missing cloud resource only when the checkpoint fingerprints the local copy", () => {
    const localResource = resource();
    const proof = checkpoint({ resourceFingerprint: fingerprintSessionResource(localResource) });

    const restored = restoreCheckpointSessionResources(
      [planWithResource()],
      [planWithResource(localResource)],
      [proof],
    );

    expect(restored[0]?.sessions[0]?.resource).toEqual(localResource);
  });

  it("does not override cloud content or restore an unproved local resource", () => {
    const cloudResource = {
      ...resource("Cloud-authoritative lesson."),
      generatedAt: "2026-08-17T17:55:00.000Z",
    };
    const localResource = {
      ...resource("Browser-only fallback lesson."),
      generatedAt: "2026-08-17T17:50:00.000Z",
    };
    const mismatchedProof = checkpoint({
      resourceFingerprint: fingerprintSessionResource(resource("Different lesson.")),
    });

    expect(restoreCheckpointSessionResources(
      [planWithResource(cloudResource)],
      [planWithResource(localResource)],
      [checkpoint({ resourceFingerprint: fingerprintSessionResource(localResource) })],
    )[0]?.sessions[0]?.resource).toEqual(cloudResource);
    expect(restoreCheckpointSessionResources(
      [planWithResource()],
      [planWithResource(localResource)],
      [mismatchedProof],
    )[0]?.sessions[0]?.resource).toBeUndefined();
  });

  it("does not restore a same-content resource from a different generation", () => {
    const original = resource();
    const regenerated = {
      ...original,
      generatedAt: "2026-08-17T17:59:00.000Z",
    };
    const exactProof = checkpoint({
      resourceFingerprint: fingerprintSessionResource(original),
      resourceGeneratedAt: original.generatedAt,
    });

    expect(restoreCheckpointSessionResources(
      [planWithResource()],
      [planWithResource(regenerated)],
      [exactProof],
    )[0]?.sessions[0]?.resource).toBeUndefined();
  });

  it("restores the checkpoint-proven browser lesson over an older cloud cache", () => {
    const cloudResource = {
      ...resource("Older cloud-cached lesson."),
      generatedAt: "2026-08-17T17:40:00.000Z",
    };
    const localResource = {
      ...resource("Browser-only safe fallback."),
      generatedAt: "2026-08-17T17:50:00.000Z",
    };
    const proof = checkpoint({ resourceFingerprint: fingerprintSessionResource(localResource) });

    expect(restoreCheckpointSessionResources(
      [planWithResource(cloudResource)],
      [planWithResource(localResource)],
      [proof],
    )[0]?.sessions[0]?.resource).toEqual(localResource);
  });
});

describe("active session resource identity", () => {
  it("is stable across object key order and changes when learning content changes", () => {
    const original = resource();
    const reordered: SessionResource = {
      origin: original.origin,
      generatedAt: original.generatedAt,
      activities: original.activities,
      rationale: original.rationale,
    };

    expect(fingerprintSessionResource(original)).toMatch(/^sr1:[0-9a-f]{16}$/);
    expect(fingerprintSessionResource(reordered)).toBe(fingerprintSessionResource(original));
    expect(fingerprintSessionResource({
      ...original,
      generatedAt: "2026-08-17T18:30:00.000Z",
    })).toBe(fingerprintSessionResource(original));
    expect(fingerprintSessionResource(resource("A different explanation.")))
      .not.toBe(fingerprintSessionResource(original));
  });

  it("uses generatedAt to reject a stale regeneration with the same content", () => {
    const original = resource();
    const regenerated = {
      ...original,
      generatedAt: "2026-08-17T17:59:00.000Z",
    };
    const exactCheckpoint = checkpoint({
      resourceFingerprint: fingerprintSessionResource(original),
      resourceGeneratedAt: original.generatedAt,
    });
    const legacyCheckpoint = checkpoint({
      resourceFingerprint: fingerprintSessionResource(original),
    });

    expect(fingerprintSessionResource(regenerated)).toBe(fingerprintSessionResource(original));
    expect(checkpointMatchesSessionResource(exactCheckpoint, original)).toBe(true);
    expect(checkpointMatchesSessionResource(exactCheckpoint, regenerated)).toBe(false);
    expect(checkpointMatchesSessionResource(legacyCheckpoint, regenerated)).toBe(true);
  });
});

describe("active session resume selection", () => {
  it("maps a checkpoint to a structurally compatible, privacy-safe resume point", () => {
    const original = checkpoint({ activeSeconds: 61, completedSteps: 0, resumeStep: 0 });

    expect(checkpointToSessionResumePoint(original)).toMatchObject({
      id: original.runId,
      planId: original.planId,
      planSessionId: original.planSessionId,
      interruptedAt: original.savedAt,
      actualMinutes: 2,
      completedSteps: 0,
      resumeStep: 0,
      source: "active_session_checkpoint",
      checkpointStatus: "working",
      resourceFingerprint: original.resourceFingerprint,
    });
  });

  it("allows a step-zero checkpoint and an awaiting-finish checkpoint to resume", () => {
    const stepZero = checkpoint({ completedSteps: 0, resumeStep: 0 });
    const selectedStepZero = chooseLatestSessionResumePoint(stepZero.planSessionId, [], [stepZero]);
    expect(selectedStepZero).toMatchObject({
      source: "active_session_checkpoint",
      completedSteps: 0,
    });

    const finished = awaitingFinishCheckpoint({ completionMode: "unguided_practice" });
    const selectedFinished = chooseLatestSessionResumePoint(finished.planSessionId, [], [finished]);
    expect(selectedFinished).toMatchObject({
      source: "active_session_checkpoint",
      checkpointStatus: "awaiting_finish",
      completedSteps: finished.totalSteps,
      completedAt: finished.completedAt,
      completionFeedback: "about_right",
      completionMode: "unguided_practice",
    });

    const legacyFinished = checkpointToSessionResumePoint(awaitingFinishCheckpoint());
    expect(legacyFinished.completionMode).toBe("guided");
  });

  it("chooses the newest valid source while retaining legacy interruption filtering", () => {
    const validLegacy = interruption();
    const ignoredStepZero = interruption({
      id: "00000000-0000-4000-8000-000000000011",
      interruptedAt: "2026-08-17T17:59:00.000Z",
      completedSteps: 0,
    });
    const olderCheckpoint = checkpoint({ savedAt: "2026-08-17T17:40:00.000Z" });

    expect(chooseLatestSessionResumePoint(
      validLegacy.planSessionId,
      [validLegacy, ignoredStepZero],
      [olderCheckpoint],
    )).toEqual(validLegacy);

    const newerCheckpoint = checkpoint({ savedAt: "2026-08-17T17:50:00.000Z" });
    expect(chooseLatestSessionResumePoint(
      validLegacy.planSessionId,
      [validLegacy, ignoredStepZero],
      [newerCheckpoint],
    )).toMatchObject({
      source: "active_session_checkpoint",
      savedAt: newerCheckpoint.savedAt,
    });
  });
});
