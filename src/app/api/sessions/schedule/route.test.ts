import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  planStatus: "active",
  sessionStatus: "upcoming",
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

import { PATCH } from "@/app/api/sessions/schedule/route";

describe("session schedule operational guard", () => {
  beforeEach(() => {
    mocks.planStatus = "active";
    mocks.sessionStatus = "upcoming";
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: { id: "33333333-3333-4333-8333-333333333333" } },
      error: null,
    });
    mocks.from.mockReset().mockImplementation((table: string) => {
      const result = table === "plan_sessions"
        ? { data: { id: SESSION_ID, plan_id: PLAN_ID, status: mocks.sessionStatus }, error: null }
        : { data: { id: PLAN_ID, status: mocks.planStatus }, error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => result,
      };
      return builder;
    });
    mocks.rpc.mockReset().mockImplementation(async (_name: string, input: { payload: { scheduledFor: string } }) => ({
      data: {
        planSessionId: SESSION_ID,
        scheduledFor: input.payload.scheduledFor,
      },
      error: null,
    }));
    mocks.createClient.mockReset().mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
      rpc: mocks.rpc,
    });
  });

  it.each(["draft", "completed", "archived"])(
    "blocks a session whose parent plan is %s before the scheduling RPC",
    async (planStatus) => {
      mocks.planStatus = planStatus;

      const response = await PATCH(scheduleRequest());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "This learning session is no longer available because its plan is not active.",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("allows an upcoming session from an active plan", async () => {
    const response = await PATCH(scheduleRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("reschedule_plan_session", {
      payload: expect.objectContaining({ planSessionId: SESSION_ID }),
    });
  });
});

function scheduleRequest() {
  return new Request("https://yova.example/api/sessions/schedule", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      planSessionId: SESSION_ID,
      scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
    }),
  });
}
