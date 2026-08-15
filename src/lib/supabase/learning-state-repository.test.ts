import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInterruption } from "@/lib/domain";
import {
  defaultPersonalizationState,
  PERSONALIZATION_STATE_ANSWER_INDEX,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ rpc }),
}));

import {
  recordAuthenticatedSessionInterruption,
  saveAuthenticatedLearnerProfile,
} from "@/lib/supabase/learning-state-repository";

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ error: null });
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
