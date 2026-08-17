import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInterruption } from "@/lib/domain";
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
  loadAuthenticatedLearningState,
  loadAuthenticatedLearningStateWithRetry,
  recordAuthenticatedSessionInterruption,
  saveAuthenticatedLearnerProfile,
  type CloudLearningState,
} from "@/lib/supabase/learning-state-repository";

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReset();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  rpc.mockReset().mockResolvedValue({ error: null });
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

describe("saveAuthenticatedLearnerProfile", () => {
  it("stores the personalization state inside the existing additional-context field", async () => {
    const state = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([], {
      ...state,
      workspace: { ...state.workspace, textDensity: "reduced" },
    });

    await saveAuthenticatedLearnerProfile({
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
      displayName: "First",
      onboardingAnswers: ["first blocker"],
    });
    await Promise.resolve();
    const second = saveAuthenticatedLearnerProfile({
      displayName: "Second",
      onboardingAnswers: ["second blocker"],
    });
    const newest = saveAuthenticatedLearnerProfile({
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
    ...overrides,
  };
}

function mockCloudQueries({ profile }: { profile: { display_name: string; onboarding_completed_at: string | null } | null }) {
  from.mockImplementation((table: string) => {
    const result = {
      data: table === "profiles" ? profile : table === "learner_profiles" ? null : [],
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
