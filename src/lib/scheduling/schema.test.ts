import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReschedulePlanSessionsRequestSchema,
  ReschedulePlanSessionsResponseSchema,
} from "@/lib/scheduling/schema";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const FIRST_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_SESSION_ID = "33333333-3333-4333-8333-333333333333";
const CASE_SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("transactional schedule schemas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a bounded multi-session move", () => {
    const parsed = ReschedulePlanSessionsRequestSchema.safeParse({
      planId: PLAN_ID,
      updates: [{
        planSessionId: FIRST_SESSION_ID,
        scheduledFor: "2026-08-22T12:00:00.000Z",
      }, {
        planSessionId: SECOND_SESSION_ID,
        scheduledFor: "2026-08-23T12:00:00.000Z",
      }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.operationKind).toBe("manual");
  });

  it("reserves the five-minute past grace for advance-now batches", () => {
    const updates = [{
      planSessionId: FIRST_SESSION_ID,
      scheduledFor: "2026-08-21T11:58:00.000Z",
    }];

    expect(ReschedulePlanSessionsRequestSchema.safeParse({
      planId: PLAN_ID,
      operationKind: "manual",
      updates,
    }).success).toBe(false);
    expect(ReschedulePlanSessionsRequestSchema.safeParse({
      planId: PLAN_ID,
      operationKind: "advance_now",
      updates,
    }).success).toBe(true);
  });

  it("rejects duplicate session ids before the RPC", () => {
    const parsed = ReschedulePlanSessionsRequestSchema.safeParse({
      planId: PLAN_ID,
      updates: [{
        planSessionId: CASE_SESSION_ID,
        scheduledFor: "2026-08-22T12:00:00.000Z",
      }, {
        planSessionId: CASE_SESSION_ID.toUpperCase(),
        scheduledFor: "2026-08-23T12:00:00.000Z",
      }],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.updates).toContain(
        "Each session may appear only once in a schedule change.",
      );
    }
  });

  it("normalizes accepted UUIDs before they cross the persistence boundary", () => {
    const parsed = ReschedulePlanSessionsRequestSchema.parse({
      planId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
      updates: [{
        planSessionId: CASE_SESSION_ID.toUpperCase(),
        scheduledFor: "2026-08-22T12:00:00.000Z",
      }],
    });

    expect(parsed.planId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(parsed.updates[0]?.planSessionId).toBe(CASE_SESSION_ID);
  });

  it("rejects a schedule time outside the bounded request window", () => {
    expect(ReschedulePlanSessionsRequestSchema.safeParse({
      planId: PLAN_ID,
      updates: [{
        planSessionId: FIRST_SESSION_ID,
        scheduledFor: "2026-08-21T11:00:00.000Z",
      }],
    }).success).toBe(false);
  });

  it("requires an authoritative response with plan identity and sessions", () => {
    expect(ReschedulePlanSessionsResponseSchema.safeParse({
      planId: PLAN_ID,
      sessions: [{
        planSessionId: FIRST_SESSION_ID,
        scheduledFor: "2026-08-22T12:00:00.000Z",
      }],
      persistence: "supabase",
    }).success).toBe(true);
    expect(ReschedulePlanSessionsResponseSchema.safeParse({
      planId: PLAN_ID,
      sessions: [],
      persistence: "supabase",
    }).success).toBe(false);
  });
});
