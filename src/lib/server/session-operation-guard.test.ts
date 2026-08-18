import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  classifyOperationalPlanSession,
  SCHEDULABLE_SESSION_STATUSES,
  sessionOperationFailure,
  verifyOperationalPlanSession,
} from "@/lib/server/session-operation-guard";

describe("session operation guard", () => {
  it("allows only the ready session of an active parent by default", () => {
    expect(classify("active", "ready")).toEqual({ allowed: true });

    for (const planStatus of ["draft", "completed", "archived", "unknown"]) {
      expect(classify(planStatus, "ready")).toEqual({
        allowed: false,
        reason: "inactive_plan",
      });
    }
    for (const sessionStatus of ["upcoming", "complete", "skipped", "unknown"]) {
      expect(classify("active", sessionStatus)).toEqual({
        allowed: false,
        reason: "session_not_ready",
      });
    }
  });

  it("allows ready and upcoming sessions only for scheduling operations", () => {
    expect(classifyOperationalPlanSession({
      requestedPlanId: "plan-1",
      sessionPlanId: "plan-1",
      planStatus: "active",
      sessionStatus: "upcoming",
      allowedSessionStatuses: SCHEDULABLE_SESSION_STATUSES,
    })).toEqual({ allowed: true });
    expect(classifyOperationalPlanSession({
      requestedPlanId: "plan-1",
      sessionPlanId: "plan-1",
      planStatus: "active",
      sessionStatus: "complete",
      allowedSessionStatuses: SCHEDULABLE_SESSION_STATUSES,
    })).toEqual({ allowed: false, reason: "session_not_ready" });
  });

  it("fails closed when the session belongs to another plan", () => {
    const access = classifyOperationalPlanSession({
      requestedPlanId: "plan-1",
      sessionPlanId: "plan-2",
      planStatus: "active",
      sessionStatus: "ready",
    });

    expect(access).toEqual({ allowed: false, reason: "not_found" });
    if (!access.allowed) {
      expect(sessionOperationFailure(access)).toEqual({
        status: 404,
        error: "That learning session was not found.",
      });
    }
  });

  it("derives the parent plan for scheduling requests without a plan id", async () => {
    const supabase = fakeSupabase({
      session: { id: "session-1", plan_id: "plan-1", status: "upcoming" },
      plan: { id: "plan-1", status: "active" },
    });

    await expect(verifyOperationalPlanSession(supabase, {
      planSessionId: "session-1",
      allowedSessionStatuses: SCHEDULABLE_SESSION_STATUSES,
    })).resolves.toEqual({ allowed: true });
  });

  it("stops on ownership gaps and database verification errors", async () => {
    await expect(verifyOperationalPlanSession(fakeSupabase({
      session: null,
      plan: { id: "plan-1", status: "active" },
    }), {
      planId: "plan-1",
      planSessionId: "session-1",
    })).resolves.toEqual({ allowed: false, reason: "not_found" });

    await expect(verifyOperationalPlanSession(fakeSupabase({
      session: { id: "session-1", plan_id: "plan-1", status: "ready" },
      plan: null,
      planError: { message: "database unavailable" },
    }), {
      planId: "plan-1",
      planSessionId: "session-1",
    })).resolves.toEqual({ allowed: false, reason: "verification_failed" });
  });
});

function classify(planStatus: string, sessionStatus: string) {
  return classifyOperationalPlanSession({
    requestedPlanId: "plan-1",
    sessionPlanId: "plan-1",
    planStatus,
    sessionStatus,
  });
}

function fakeSupabase({
  session,
  plan,
  sessionError = null,
  planError = null,
}: {
  session: { id: string; plan_id: string; status: string } | null;
  plan: { id: string; status: string } | null;
  sessionError?: unknown;
  planError?: unknown;
}) {
  return {
    from(table: string) {
      const result = table === "plan_sessions"
        ? { data: session, error: sessionError }
        : { data: plan, error: planError };
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => result,
      };
      return builder;
    },
  } as never;
}
