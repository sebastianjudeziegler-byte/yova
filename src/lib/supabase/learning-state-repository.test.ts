import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInterruption } from "@/lib/domain";
import {
  loadActiveSessionCheckpoints,
  saveActiveSessionCheckpoint,
  type ActiveSessionCheckpointV1,
} from "@/lib/learning/active-session-checkpoint";
import {
  defaultPersonalizationState,
  PERSONALIZATION_STATE_ANSWER_INDEX,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";

const { from, getUser, rpc } = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { getUser }, from, rpc }),
}));

import {
  ActiveSessionCheckpointConflictError,
  ActiveSessionCheckpointTerminalError,
  cancelAuthenticatedLearnerProfileWrites,
  completeAuthenticatedPlanSession,
  deleteAuthenticatedActiveSessionCheckpoint,
  loadAuthenticatedLearningState,
  loadAuthenticatedLearningStateWithRetry,
  recordAuthenticatedSessionInterruption,
  saveAuthenticatedActiveSessionCheckpoint,
  saveAuthenticatedLearnerProfile,
  type CloudLearningState,
} from "@/lib/supabase/learning-state-repository";

const NOW = "2026-08-17T18:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.clearAllMocks();
  from.mockReset();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("authenticated learning-state startup", () => {
  it("retries a transient empty read before restoring an existing learner", async () => {
    const restored = cloudState({ onboardingCompleted: true, displayName: "Existing learner" });
    const read = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(restored);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(loadAuthenticatedLearningStateWithRetry(read, [25], wait)).resolves.toBe(restored);

    expect(read).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(25);
  });

  it("retries a transient profile-query failure before making an onboarding decision", async () => {
    const restored = cloudState({ onboardingCompleted: true });
    const read = vi.fn()
      .mockRejectedValueOnce(new Error("YOVA could not load your cloud learning profile."))
      .mockResolvedValueOnce(restored);

    await expect(loadAuthenticatedLearningStateWithRetry(read, [0], async () => undefined))
      .resolves.toBe(restored);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("accepts a real new-account profile without delaying or retrying onboarding", async () => {
    const newLearner = cloudState({ onboardingCompleted: false });
    const read = vi.fn().mockResolvedValue(newLearner);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(loadAuthenticatedLearningStateWithRetry(read, [25, 50], wait)).resolves.toBe(newLearner);

    expect(read).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("does not reinterpret a missing mandatory profile row as a new learner", async () => {
    mockCloudQueries({ profile: null });

    await expect(loadAuthenticatedLearningState())
      .rejects.toThrow("could not load your cloud learning profile");
  });

  it("loads only fresh, valid, account-owned checkpoints from session step data", async () => {
    const valid = checkpoint();
    const rawAnswer = {
      ...checkpoint({
        planSessionId: "00000000-0000-4000-8000-000000000013",
        runId: "00000000-0000-4000-8000-000000000014",
      }),
      evidence: {
        ...checkpoint().evidence,
        learnerAnswer: "Private draft answer",
      },
    };
    const wrongAccount = checkpoint({
      accountId: "user-2",
      planSessionId: "00000000-0000-4000-8000-000000000015",
      runId: "00000000-0000-4000-8000-000000000016",
    });
    const expired = checkpoint({
      planSessionId: "00000000-0000-4000-8000-000000000017",
      runId: "00000000-0000-4000-8000-000000000018",
      savedAt: "2026-08-01T18:00:00.000Z",
    });
    const legacyWithoutLessonIdentity = checkpoint({
      planSessionId: "00000000-0000-4000-8000-000000000019",
      runId: "00000000-0000-4000-8000-000000000020",
    });
    delete (legacyWithoutLessonIdentity as Partial<ActiveSessionCheckpointV1>).resourceGeneratedAt;
    mockCloudQueries({
      profile: { display_name: "Learner", onboarding_completed_at: NOW },
      sessions: [
        sessionRow(valid),
        sessionRow(rawAnswer as ActiveSessionCheckpointV1),
        sessionRow(wrongAccount),
        sessionRow(expired),
        sessionRow(legacyWithoutLessonIdentity),
      ],
    });

    const state = await loadAuthenticatedLearningState();

    expect(state?.activeSessionCheckpoints).toEqual([valid]);
  });

  it("repairs already-persisted dangling titles while loading signed-in learning state", async () => {
    mockCloudQueries({
      profile: { display_name: "Learner", onboarding_completed_at: NOW },
      items: [
        {
          id: "item-krebs",
          title: "Understand How the Krebs Cycle Actually Produces Nadh and",
          kind: "topic",
          topic: "I want to understand how the Krebs cycle actually produces NADH and FADH2 during the citric acid cycle",
          deadline: null,
          source_mode: "yova_generated",
          study_mode: "inside_yova",
          created_at: NOW,
        },
        {
          id: "item-economics",
          title: "Understand How Supply and Demand Curves Shift, Using My",
          kind: "topic",
          topic: "I want to understand how supply and demand curves shift, using my economics textbook",
          deadline: null,
          source_mode: "yova_generated",
          study_mode: "inside_yova",
          created_at: NOW,
        },
      ],
      plans: [
        {
          id: "plan-krebs",
          learning_item_id: "item-krebs",
          status: "active",
          rationale: "Build the causal model before checking retrieval.",
          generation_inputs: { learningIntent: "learn", intent: "plan" },
          knowledge_map: null,
          created_at: NOW,
        },
        {
          id: "plan-economics",
          learning_item_id: "item-economics",
          status: "active",
          rationale: "Build the graph model before applying it.",
          generation_inputs: { learningIntent: "learn", intent: "plan" },
          knowledge_map: null,
          created_at: NOW,
        },
      ],
    });

    const state = await loadAuthenticatedLearningState();
    const titles = state?.plans.map((plan) => plan.title) ?? [];

    expect(titles[0]).toContain("NADH and FADH2");
    expect(titles[0]).not.toContain("Nadh");
    expect(titles[1]).toBe("Understand How Supply and Demand Curves Shift…");
    expect(titles).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/\b(?:and|my|using)\s*(?:…)?$/i),
    ]));
  });
});

describe("recordAuthenticatedSessionInterruption", () => {
  it("sends the exact setup needed to resume the generated lesson", async () => {
    const interruption: SessionInterruption = {
      id: "00000000-0000-4000-8000-000000000001",
      planId: "00000000-0000-4000-8000-000000000002",
      planSessionId: "00000000-0000-4000-8000-000000000003",
      startedAt: "2026-08-11T20:00:00.000Z",
      interruptedAt: "2026-08-11T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      completedSteps: 2,
      totalSteps: 5,
      sessionAdjustment: {
        familiarity: "need_teaching",
        availableMinutes: 20,
        knownTargets: ["ATP coupling"],
        note: "Connect this to cellular respiration.",
      },
    };

    await recordAuthenticatedSessionInterruption(interruption);

    expect(rpc).toHaveBeenCalledWith("record_session_interruption", {
      payload: expect.objectContaining({
        attemptId: interruption.id,
        sessionAdjustment: interruption.sessionAdjustment,
      }),
    });
  });
});

describe("completeAuthenticatedPlanSession", () => {
  it("uses the evidence-free transactional RPC for unguided practice", async () => {
    const verification = {
      id: "00000000-0000-4000-8000-000000000031",
      sequence: 2,
      title: "Verify thermohaline circulation",
      objective: "Complete an independent guided check for every original target.",
      method: "Independent retrieval verification",
      methodReason: "This work counted as practice, not proof.",
      scheduledFor: "2026-08-18T20:08:00.000Z",
      estimatedMinutes: 10,
      amountLabel: "Required guided verification · about 10 min",
      learningMode: "study" as const,
      topicIds: ["00000000-0000-4000-8000-000000000035"],
      contentTargets: ["Density changes from temperature and salinity"],
      completionEvidence: ["Explain how temperature and salinity affect density."],
      status: "ready" as const,
      reviewConcept: "Thermohaline circulation",
      reviewType: "verify" as const,
    };
    await completeAuthenticatedPlanSession({
      id: "00000000-0000-4000-8000-000000000031",
      planId: "00000000-0000-4000-8000-000000000032",
      planSessionId: "00000000-0000-4000-8000-000000000033",
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
    }, null, verification);

    expect(rpc).toHaveBeenCalledWith("complete_unguided_plan_session", {
      payload: expect.objectContaining({
        completionMode: "unguided_practice",
        correctAnswers: 0,
        totalAnswers: 0,
        conceptEvidence: [],
        confidenceEvidence: [],
        followUpSession: expect.objectContaining({
          id: verification.id,
          topicIds: verification.topicIds,
          contentTargets: verification.contentTargets,
          completionEvidence: verification.completionEvidence,
          reviewType: "verify",
        }),
      }),
    });
  });

  it("refuses to sync unguided completion without its guided verification", async () => {
    await expect(completeAuthenticatedPlanSession({
      id: "00000000-0000-4000-8000-000000000036",
      planId: "00000000-0000-4000-8000-000000000032",
      planSessionId: "00000000-0000-4000-8000-000000000033",
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
    })).rejects.toThrow("required guided verification");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps legacy guided completions on the existing RPC", async () => {
    await completeAuthenticatedPlanSession({
      id: "00000000-0000-4000-8000-000000000041",
      planId: "00000000-0000-4000-8000-000000000042",
      planSessionId: "00000000-0000-4000-8000-000000000043",
      startedAt: "2026-08-17T20:00:00.000Z",
      completedAt: "2026-08-17T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      correctAnswers: 1,
      totalAnswers: 1,
      feedback: "about_right",
      observedGap: "No major gap detected.",
      conceptEvidence: [],
      confidenceEvidence: [],
    });

    expect(rpc).toHaveBeenCalledWith("complete_plan_session", {
      payload: expect.objectContaining({ completionMode: "guided" }),
    });
  });
});

describe("authenticated active-session checkpoint sync", () => {
  it("sends no client identity or plan identity and returns the server checkpoint", async () => {
    const local = checkpoint({
      savedAt: "2026-08-17T17:59:00.000Z",
      sessionAdjustment: {
        familiarity: "need_teaching",
        availableMinutes: 20,
        knownTargets: ["Private known target"],
        note: "Private learner note",
      },
    });
    const authoritative = checkpoint({ savedAt: NOW });
    rpc.mockResolvedValueOnce({ data: authoritative, error: null });

    await expect(saveAuthenticatedActiveSessionCheckpoint(local)).resolves.toEqual(authoritative);

    const payload = rpc.mock.calls[0]?.[1]?.payload as Record<string, unknown>;
    expect(rpc.mock.calls[0]?.[0]).toBe("save_active_session_checkpoint_with_completion_mode");
    expect(payload).toMatchObject({
      runId: local.runId,
      planSessionId: local.planSessionId,
      completedSteps: local.completedSteps,
      resourceFingerprint: local.resourceFingerprint,
      resourceGeneratedAt: local.resourceGeneratedAt,
    });
    expect(payload).not.toHaveProperty("accountId");
    expect(payload).not.toHaveProperty("planId");
    expect(payload).not.toHaveProperty("sessionAdjustment");
    expect(JSON.stringify(payload)).not.toContain("Private known target");
    expect(JSON.stringify(payload)).not.toContain("Private learner note");
  });

  it("preserves unguided completion provenance in the cloud checkpoint payload", async () => {
    const local = checkpoint({
      status: "awaiting_finish",
      completedSteps: 5,
      resumeStep: 5,
      completedAt: "2026-08-17T17:59:30.000Z",
      completionFeedback: "about_right",
      completionMode: "unguided_practice",
    });
    rpc.mockResolvedValueOnce({ data: local, error: null });

    await expect(saveAuthenticatedActiveSessionCheckpoint(local)).resolves.toEqual(local);

    expect(rpc).toHaveBeenCalledWith(
      "save_active_session_checkpoint_with_completion_mode",
      { payload: expect.objectContaining({ completionMode: "unguided_practice" }) },
    );
  });

  it("rejects a checkpoint without exact generated lesson identity before calling the cloud", async () => {
    const legacyLocal = checkpoint();
    delete (legacyLocal as Partial<ActiveSessionCheckpointV1>).resourceGeneratedAt;

    await expect(saveAuthenticatedActiveSessionCheckpoint(legacyLocal))
      .rejects.toThrow("refused to sync");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a server response for a different generated lesson", async () => {
    const local = checkpoint();
    rpc.mockResolvedValueOnce({
      data: {
        ...local,
        resourceGeneratedAt: "2026-08-17T17:41:00.000Z",
      },
      error: null,
    });

    await expect(saveAuthenticatedActiveSessionCheckpoint(local))
      .rejects.toBeInstanceOf(ActiveSessionCheckpointConflictError);
  });

  it("coalesces queued writes per lesson to the checkpoint with the most progress", async () => {
    const first = checkpoint({ completedSteps: 0, resumeStep: 0, activeSeconds: 10 });
    const ahead = checkpoint({
      savedAt: "2026-08-17T17:58:00.000Z",
      completedSteps: 3,
      resumeStep: 3,
      activeSeconds: 300,
    });
    const lateOlderWrite = checkpoint({
      savedAt: "2026-08-17T17:59:00.000Z",
      completedSteps: 1,
      resumeStep: 1,
      activeSeconds: 100,
    });
    let releaseFirst!: (value: { data: ActiveSessionCheckpointV1; error: null }) => void;
    rpc.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = resolve;
    }));
    rpc.mockImplementation((_name: string, parameters: { payload: Record<string, unknown> }) => (
      Promise.resolve({
        data: {
          accountId: first.accountId,
          planId: first.planId,
          ...parameters.payload,
          savedAt: NOW,
        },
        error: null,
      })
    ));

    const firstSave = saveAuthenticatedActiveSessionCheckpoint(first);
    await Promise.resolve();
    const aheadSave = saveAuthenticatedActiveSessionCheckpoint(ahead);
    const olderSave = saveAuthenticatedActiveSessionCheckpoint(lateOlderWrite);

    expect(rpc).toHaveBeenCalledTimes(1);
    releaseFirst({ data: { ...first, savedAt: NOW }, error: null });
    const results = await Promise.all([firstSave, aheadSave, olderSave]);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]?.[1]?.payload).toMatchObject({
      completedSteps: ahead.completedSteps,
      resumeStep: ahead.resumeStep,
      activeSeconds: ahead.activeSeconds,
    });
    expect(results.every((result) => result.completedSteps === ahead.completedSteps)).toBe(true);
  });

  it("allows separate lessons to sync concurrently", async () => {
    const first = checkpoint();
    const second = checkpoint({
      planSessionId: "00000000-0000-4000-8000-000000000020",
      runId: "00000000-0000-4000-8000-000000000021",
    });
    const releases: Array<(value: { data: ActiveSessionCheckpointV1; error: null }) => void> = [];
    rpc.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));

    const firstSave = saveAuthenticatedActiveSessionCheckpoint(first);
    const secondSave = saveAuthenticatedActiveSessionCheckpoint(second);

    expect(rpc).toHaveBeenCalledTimes(2);
    releases[0]?.({ data: first, error: null });
    releases[1]?.({ data: second, error: null });
    await Promise.all([firstSave, secondSave]);
  });

  it("maps cloud ownership and terminal signals to distinct errors", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "active_session_checkpoint_conflict" },
    });
    await expect(saveAuthenticatedActiveSessionCheckpoint(checkpoint()))
      .rejects.toBeInstanceOf(ActiveSessionCheckpointConflictError);

    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "active_session_checkpoint_terminal" },
    });
    await expect(saveAuthenticatedActiveSessionCheckpoint(checkpoint()))
      .rejects.toBeInstanceOf(ActiveSessionCheckpointTerminalError);
  });

  it("leaves the browser checkpoint intact when a retryable cloud write fails", async () => {
    installMemoryStorage();
    const local = checkpoint();
    expect(saveActiveSessionCheckpoint(local)).toBe(true);
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "08006", message: "network unavailable" },
    });

    await expect(saveAuthenticatedActiveSessionCheckpoint(local))
      .rejects.toThrow("kept this lesson on this device");

    expect(loadActiveSessionCheckpoints(local.accountId)).toEqual([local]);
  });

  it("deletes by server-owned session identity without accepting account or plan ids", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const local = checkpoint();

    await deleteAuthenticatedActiveSessionCheckpoint(local.planSessionId, local.runId);

    expect(rpc).toHaveBeenCalledWith("delete_active_session_checkpoint", {
      requested_plan_session_id: local.planSessionId,
      requested_run_id: local.runId,
    });
  });
});

describe("saveAuthenticatedLearnerProfile", () => {
  it("stores the personalization state inside the existing additional-context field", async () => {
    const state = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([], {
      ...state,
      workspace: { ...state.workspace, textDensity: "reduced" },
    });

    await saveAuthenticatedLearnerProfile({
      accountId: "user-1",
      displayName: "Learner",
      onboardingAnswers: answers,
    });

    const payload = rpc.mock.calls[0]?.[1]?.payload as Record<string, unknown>;
    const additionalContext = JSON.parse(payload.additionalContext as string) as Record<string, unknown>;
    expect(additionalContext).toMatchObject({
      schemaVersion: 3,
      personalizationState: answers[PERSONALIZATION_STATE_ANSWER_INDEX],
    });
  });

  it("serializes writes and coalesces queued edits to the newest profile", async () => {
    let releaseFirst!: (value: { error: null }) => void;
    rpc.mockImplementationOnce(() => new Promise<{ error: null }>((resolve) => {
      releaseFirst = resolve;
    }));

    const first = saveAuthenticatedLearnerProfile({
      accountId: "user-1",
      displayName: "First",
      onboardingAnswers: ["first blocker"],
    });
    await Promise.resolve();
    const second = saveAuthenticatedLearnerProfile({
      accountId: "user-1",
      displayName: "Second",
      onboardingAnswers: ["second blocker"],
    });
    const newest = saveAuthenticatedLearnerProfile({
      accountId: "user-1",
      displayName: "Newest",
      onboardingAnswers: ["newest blocker"],
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(releaseFirst).toBeTypeOf("function");
    releaseFirst({ error: null });
    await Promise.all([first, second, newest]);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]?.[1]?.payload).toMatchObject({
      displayName: "Newest",
      commonBlocker: "newest blocker",
    });
  });

  it("rejects a stale account-scoped write before calling the profile RPC", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "account-b" } },
      error: null,
    });

    await expect(saveAuthenticatedLearnerProfile({
      accountId: "account-a",
      displayName: "Stale A",
      onboardingAnswers: ["A blocker"],
    })).rejects.toThrow("signed-in account changed");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("cancels account A without letting its queued profile write run under account B", async () => {
    let releaseAccountA!: (value: { data: null; error: null }) => void;
    let currentUserId = "account-a";
    getUser.mockImplementation(async () => ({
      data: { user: { id: currentUserId } },
      error: null,
    }));
    rpc.mockImplementationOnce(() => new Promise<{ data: null; error: null }>((resolve) => {
      releaseAccountA = resolve;
    }));

    const activeAccountA = saveAuthenticatedLearnerProfile({
      accountId: "account-a",
      displayName: "Account A",
      onboardingAnswers: ["A active"],
    });
    const activeAccountAResult = activeAccountA.catch((error: unknown) => error);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

    const queuedAccountA = saveAuthenticatedLearnerProfile({
      accountId: "account-a",
      displayName: "Stale A",
      onboardingAnswers: ["A queued"],
    });
    const queuedAccountAResult = queuedAccountA.catch((error: unknown) => error);
    cancelAuthenticatedLearnerProfileWrites("account-a");

    currentUserId = "account-b";
    const accountB = saveAuthenticatedLearnerProfile({
      accountId: "account-b",
      displayName: "Account B",
      onboardingAnswers: ["B blocker"],
    });
    releaseAccountA({ data: null, error: null });

    await expect(activeAccountAResult).resolves.toMatchObject({
      message: expect.stringContaining("signed-in account changed"),
    });
    await expect(queuedAccountAResult).resolves.toMatchObject({
      message: expect.stringContaining("signed-in account changed"),
    });
    await expect(accountB).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "save_learner_profile",
      "save_learner_profile",
    ]);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      payload: { expectedAccountId: "account-a", displayName: "Account A" },
    });
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({
      payload: { expectedAccountId: "account-b", displayName: "Account B" },
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("Stale A");
  });
});

function cloudState(overrides: Partial<CloudLearningState> = {}): CloudLearningState {
  return {
    displayName: "Learner",
    onboardingCompleted: false,
    onboardingAnswers: [],
    plans: [],
    deadlineMilestones: [],
    sessionCompletions: [],
    sessionInterruptions: [],
    activeSessionCheckpoints: [],
    ...overrides,
  };
}

function checkpoint(
  overrides: Partial<ActiveSessionCheckpointV1> = {},
): ActiveSessionCheckpointV1 {
  return {
    version: 1,
    accountId: "user-1",
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
    resourceGeneratedAt: "2026-08-17T17:40:00.000Z",
    evidence: {
      correctAnswers: 1,
      totalAnswers: 1,
      conceptEvidence: [],
      confidenceEvidence: [],
      observedGap: "No gap observed yet.",
      completedImmediateRepairs: 0,
    },
    ...overrides,
  } as ActiveSessionCheckpointV1;
}

function sessionRow(activeSessionCheckpoint: ActiveSessionCheckpointV1) {
  return {
    id: activeSessionCheckpoint.planSessionId,
    plan_id: activeSessionCheckpoint.planId,
    sequence: 1,
    title: "ATP coupling",
    objective: "Explain ATP coupling.",
    method: "Self-explanation",
    method_rationale: "Make the causal chain explicit.",
    scheduled_for: NOW,
    estimated_minutes: 25,
    status: "ready",
    step_data: { activeSessionCheckpoint },
  };
}

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

function mockCloudQueries({
  profile,
  sessions = [],
  items = [],
  plans = [],
}: {
  profile: { display_name: string; onboarding_completed_at: string | null } | null;
  sessions?: ReturnType<typeof sessionRow>[];
  items?: Array<Record<string, unknown>>;
  plans?: Array<Record<string, unknown>>;
}) {
  from.mockImplementation((table: string) => {
    const result = {
      data: table === "profiles"
        ? profile
        : table === "learner_profiles"
          ? null
          : table === "learning_items"
            ? items
            : table === "plans"
              ? plans
          : table === "plan_sessions"
            ? sessions
            : [],
      error: null,
    };
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(() => Promise.resolve(result));
    builder.eq = vi.fn(() => builder);
    builder.not = vi.fn(() => builder);
    builder.order = vi.fn(() => Promise.resolve(result));
    return builder;
  });
}
