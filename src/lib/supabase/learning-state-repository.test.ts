import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInterruption } from "@/lib/domain";

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ rpc }),
}));

import { recordAuthenticatedSessionInterruption } from "@/lib/supabase/learning-state-repository";

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
        sessionAdjustment: interruption.sessionAdjustment,
      }),
    });
  });
});
