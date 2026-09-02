import { describe, expect, it, vi } from "vitest";
import { persistPlanSchedule } from "@/lib/scheduling/client";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const updates = [{
  planSessionId: SESSION_ID,
  scheduledFor: "2026-08-22T12:00:00.000Z",
}];

describe("plan schedule API client", () => {
  it("sends one batch and returns the authoritative schedule", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      planId: PLAN_ID,
      sessions: updates,
      persistence: "supabase",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(persistPlanSchedule(PLAN_ID, updates, { request })).resolves.toMatchObject({
      planId: PLAN_ID,
      sessions: updates,
    });
    expect(request).toHaveBeenCalledOnce();
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      planId: PLAN_ID,
      operationKind: "manual",
      updates,
    });
  });

  it("normalizes UUID case before sending and comparing the authoritative response", async () => {
    const lowercasePlanId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const lowercaseSessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      planId: lowercasePlanId,
      sessions: [{ planSessionId: lowercaseSessionId, scheduledFor: updates[0].scheduledFor }],
      persistence: "supabase",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(persistPlanSchedule(lowercasePlanId.toUpperCase(), [{
      ...updates[0],
      planSessionId: lowercaseSessionId.toUpperCase(),
    }], { request })).resolves.toMatchObject({ planId: lowercasePlanId });
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      planId: lowercasePlanId,
      updates: [{ planSessionId: lowercaseSessionId }],
    });
  });

  it("marks the pull-forward workflow so only it receives network-latency grace", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      planId: PLAN_ID,
      sessions: updates,
      persistence: "supabase",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await persistPlanSchedule(PLAN_ID, updates, { operationKind: "advance_now", request });

    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      operationKind: "advance_now",
    });
  });

  it("does not treat an incomplete committed response as safe local state", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      planId: PLAN_ID,
      sessions: [{
        planSessionId: "33333333-3333-4333-8333-333333333333",
        scheduledFor: "2026-08-23T12:00:00.000Z",
      }],
      persistence: "supabase",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(persistPlanSchedule(PLAN_ID, updates, { request })).rejects.toThrow(
      "YOVA changed the calendar but could not safely confirm every session",
    );
  });

  it("keeps a typed server conflict learner-facing", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: "Choose a time after the previous session and before the next session.",
    }), { status: 409, headers: { "Content-Type": "application/json" } }));

    await expect(persistPlanSchedule(PLAN_ID, updates, { request })).rejects.toThrow(
      "Choose a time after the previous session",
    );
  });
});
