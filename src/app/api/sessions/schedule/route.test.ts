import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const FIRST_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_SESSION_ID = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  rpcError: null as null | { message: string },
  rpcData: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

import { PATCH } from "@/app/api/sessions/schedule/route";

describe("transactional session scheduling route", () => {
  beforeEach(() => {
    mocks.rpcError = null;
    mocks.rpcData = null;
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: { id: "44444444-4444-4444-8444-444444444444" } },
      error: null,
    });
    mocks.rpc.mockReset().mockImplementation(async (name: string, input: {
      payload: {
        planId?: string;
        planSessionId?: string;
        scheduledFor?: string;
        updates?: Array<{ planSessionId: string; scheduledFor: string }>;
      };
    }) => {
      if (mocks.rpcError) return { data: null, error: mocks.rpcError };
      if (mocks.rpcData) return { data: mocks.rpcData, error: null };
      if (name === "reschedule_plan_sessions") {
        return {
          data: {
            planId: input.payload.planId,
            sessions: input.payload.updates,
          },
          error: null,
        };
      }
      return {
        data: {
          planSessionId: input.payload.planSessionId,
          scheduledFor: input.payload.scheduledFor,
        },
        error: null,
      };
    });
    mocks.createClient.mockReset().mockResolvedValue({
      auth: { getUser: mocks.getUser },
      rpc: mocks.rpc,
    });
  });

  it("requires an authenticated learner", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "missing" } });

    const response = await PATCH(batchRequest());

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sends a plan-wide move through one batch RPC and returns its authoritative schedule", async () => {
    const response = await PATCH(batchRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("reschedule_plan_sessions", {
      payload: expect.objectContaining({
        planId: PLAN_ID,
        updates: expect.arrayContaining([
          expect.objectContaining({ planSessionId: FIRST_SESSION_ID }),
          expect.objectContaining({ planSessionId: SECOND_SESSION_ID }),
        ]),
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      planId: PLAN_ID,
      sessions: expect.arrayContaining([
        expect.objectContaining({ planSessionId: FIRST_SESSION_ID }),
        expect.objectContaining({ planSessionId: SECOND_SESSION_ID }),
      ]),
      persistence: "supabase",
    });
  });

  it("rejects duplicate batch ids before touching the database", async () => {
    const response = await PATCH(new Request("https://yova.example/api/sessions/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: PLAN_ID,
        updates: [{ planSessionId: FIRST_SESSION_ID, scheduledFor: futureIso(24) }, {
          planSessionId: FIRST_SESSION_ID,
          scheduledFor: futureIso(48),
        }],
      }),
    }));

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a past manual move before the RPC", async () => {
    const response = await PATCH(new Request("https://yova.example/api/sessions/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: PLAN_ID,
        operationKind: "manual",
        updates: [{
          planSessionId: FIRST_SESSION_ID,
          scheduledFor: new Date(Date.now() - 60_000).toISOString(),
        }],
      }),
    }));

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps bounded network-latency grace for the advance-now workflow", async () => {
    const scheduledFor = new Date(Date.now() - 60_000).toISOString();
    const response = await PATCH(new Request("https://yova.example/api/sessions/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: PLAN_ID,
        operationKind: "advance_now",
        updates: [{ planSessionId: FIRST_SESSION_ID, scheduledFor }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("reschedule_plan_sessions", {
      payload: expect.objectContaining({ operationKind: "advance_now" }),
    });
  });

  it("normalizes uppercase UUIDs before the RPC and response comparison", async () => {
    const uppercasePlanId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase();
    const uppercaseSessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".toUpperCase();
    const response = await PATCH(new Request("https://yova.example/api/sessions/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: uppercasePlanId,
        updates: [{ planSessionId: uppercaseSessionId, scheduledFor: futureIso(24) }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("reschedule_plan_sessions", {
      payload: expect.objectContaining({
        planId: uppercasePlanId.toLowerCase(),
        updates: [expect.objectContaining({ planSessionId: uppercaseSessionId.toLowerCase() })],
      }),
    });
  });

  it.each([
    ["schedule_plan_inactive", "plan is not active"],
    ["schedule_sequence_conflict", "after the previous session and before the next"],
    ["schedule_deadline_conflict", "on or before this goal’s deadline"],
    ["schedule_time_in_past", "future date and time"],
    ["schedule_unchanged", "different date or time"],
  ])("maps %s into an actionable conflict", async (databaseMessage, expectedMessage) => {
    mocks.rpcError = { message: databaseMessage };

    const response = await PATCH(batchRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining(expectedMessage),
    });
  });

  it.each([
    { planId: PLAN_ID, sessions: [] },
    {
      planId: "55555555-5555-4555-8555-555555555555",
      sessions: [{ planSessionId: FIRST_SESSION_ID, scheduledFor: futureIso(24) }, {
        planSessionId: SECOND_SESSION_ID,
        scheduledFor: futureIso(48),
      }],
    },
    {
      planId: PLAN_ID,
      sessions: [{ planSessionId: FIRST_SESSION_ID, scheduledFor: futureIso(24) }],
    },
  ])("marks an incomplete or mismatched post-commit batch response as committed", async (rpcData) => {
    mocks.rpcData = rpcData;

    const response = await PATCH(batchRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "schedule_committed_response_invalid",
      committed: true,
    });
  });

  it("keeps an older one-session client on the invariant-preserving wrapper", async () => {
    const scheduledFor = futureIso(24);
    const response = await PATCH(new Request("https://yova.example/api/sessions/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planSessionId: FIRST_SESSION_ID, scheduledFor }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("reschedule_plan_session", {
      payload: { planSessionId: FIRST_SESSION_ID, scheduledFor },
    });
    await expect(response.json()).resolves.toEqual({
      planSessionId: FIRST_SESSION_ID,
      scheduledFor,
      persistence: "supabase",
    });
  });
});

function batchRequest() {
  return new Request("https://yova.example/api/sessions/schedule", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      planId: PLAN_ID,
      updates: [{
        planSessionId: FIRST_SESSION_ID,
        scheduledFor: futureIso(24),
      }, {
        planSessionId: SECOND_SESSION_ID,
        scheduledFor: futureIso(48),
      }],
    }),
  });
}

function futureIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1_000).toISOString();
}
