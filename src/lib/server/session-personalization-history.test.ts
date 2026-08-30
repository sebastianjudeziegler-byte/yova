import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readOptionalSessionPersonalizationHistory,
  SESSION_ACCOUNT_PERSONALIZATION_HISTORY_LIMIT,
  SESSION_PLAN_ATTEMPT_HISTORY_LIMIT,
  SESSION_PLAN_INTERRUPTION_HISTORY_LIMIT,
} from "@/lib/server/session-personalization-history";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "a1000000-0000-4000-8000-000000000002";
const SESSION_ID = "a1000000-0000-4000-8000-000000000003";

describe("optional session personalization history", () => {
  it("binds every read to the authenticated owner and uses bounded recent-first windows", async () => {
    const database = fakeSupabase({
      session_attempts: [
        result([attemptRow("plan-attempt")]),
        result([attemptRow("account-attempt")]),
      ],
      learning_events: [
        result([interruptionRow("plan-interruption")]),
        result([interruptionRow("account-interruption")]),
      ],
    });

    const history = await readOptionalSessionPersonalizationHistory(database.client, {
      userId: USER_ID,
      planSessionIds: [SESSION_ID, SESSION_ID],
    });

    expect(history.degradedSources).toEqual([]);
    expect(history.planAttempts.map((row) => row.id)).toEqual(["plan-attempt"]);
    expect(history.accountAttempts.map((row) => row.id)).toEqual(["account-attempt"]);

    const [planAttempts, accountAttempts] = database.queries.filter((query) => (
      query.table === "session_attempts"
    ));
    const [planInterruptions, accountInterruptions] = database.queries.filter((query) => (
      query.table === "learning_events"
    ));

    for (const query of database.queries) {
      expect(query.calls).toContainEqual(["eq", "user_id", USER_ID]);
      const selection = query.calls.find(([method]) => method === "select")?.[1];
      expect(selection).toEqual(expect.stringContaining("user_id"));
    }
    expect(planAttempts.calls).toContainEqual(["in", "plan_session_id", [SESSION_ID]]);
    expect(planAttempts.calls).toContainEqual(["order", "completed_at", { ascending: false }]);
    expect(planAttempts.calls).toContainEqual(["limit", SESSION_PLAN_ATTEMPT_HISTORY_LIMIT]);
    expect(accountAttempts.calls).not.toContainEqual(expect.arrayContaining(["in", "plan_session_id"]));
    expect(accountAttempts.calls).toContainEqual(["order", "completed_at", { ascending: false }]);
    expect(accountAttempts.calls).toContainEqual(["limit", SESSION_ACCOUNT_PERSONALIZATION_HISTORY_LIMIT]);

    expect(planInterruptions.calls).toContainEqual(["in", "plan_session_id", [SESSION_ID]]);
    expect(planInterruptions.calls).toContainEqual(["order", "occurred_at", { ascending: false }]);
    expect(planInterruptions.calls).toContainEqual(["limit", SESSION_PLAN_INTERRUPTION_HISTORY_LIMIT]);
    expect(accountInterruptions.calls).not.toContainEqual(expect.arrayContaining(["in", "plan_session_id"]));
    expect(accountInterruptions.calls).toContainEqual(["order", "occurred_at", { ascending: false }]);
    expect(accountInterruptions.calls).toContainEqual(["limit", SESSION_ACCOUNT_PERSONALIZATION_HISTORY_LIMIT]);
  });

  it("omits unavailable or ownership-indeterminate signals without rejecting the read", async () => {
    const database = fakeSupabase({
      session_attempts: [
        result([], { message: "plan attempt read failed" }),
        result([attemptRow("foreign-attempt", OTHER_USER_ID)]),
      ],
      learning_events: [
        result([interruptionRow("usable-plan-interruption")]),
        Promise.reject(new Error("account interruption read failed")),
      ],
    });

    const history = await readOptionalSessionPersonalizationHistory(database.client, {
      userId: USER_ID,
      planSessionIds: [SESSION_ID],
    });

    expect(history.planAttempts).toEqual([]);
    expect(history.planInterruptions).toHaveLength(1);
    expect(history.accountAttempts).toEqual([]);
    expect(history.accountInterruptions).toEqual([]);
    expect(history.degradedSources).toEqual([
      "plan_attempts",
      "account_attempts",
      "account_interruptions",
    ]);
  });

  it("does not mark plan history degraded when the plan has no session ids", async () => {
    const database = fakeSupabase({
      session_attempts: [result([])],
      learning_events: [result([])],
    });

    const history = await readOptionalSessionPersonalizationHistory(database.client, {
      userId: USER_ID,
      planSessionIds: [],
    });

    expect(history.degradedSources).toEqual([]);
    expect(database.queries).toHaveLength(2);
  });
});

type QueryCall = [method: string, ...args: unknown[]];
type QueryLog = { table: string; calls: QueryCall[] };
type DatabaseResult = { data: unknown; error: unknown };

function fakeSupabase(results: Record<string, Array<DatabaseResult | Promise<DatabaseResult>>>) {
  const queues = new Map(Object.entries(results));
  const queries: QueryLog[] = [];
  const client = {
    from(table: string) {
      const queryResult = queues.get(table)?.shift();
      if (!queryResult) throw new Error(`Unexpected ${table} query`);
      const log: QueryLog = { table, calls: [] };
      queries.push(log);
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "not", "order", "limit"]) {
        query[method] = (...args: unknown[]) => {
          log.calls.push([method, ...args]);
          return query;
        };
      }
      query.then = (
        resolve: (value: DatabaseResult) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(queryResult).then(resolve, reject);
      return query;
    },
  };
  return { client: client as never, queries };
}

function result(data: unknown, error: unknown = null): DatabaseResult {
  return { data, error };
}

function attemptRow(id: string, userId = USER_ID) {
  return {
    user_id: userId,
    id,
    plan_session_id: SESSION_ID,
    started_at: "2026-08-29T10:00:00.000Z",
    completed_at: "2026-08-29T10:15:00.000Z",
    actual_minutes: 15,
    correct_answers: 2,
    total_answers: 3,
    user_feedback: "about_right",
    result_data: {},
  };
}

function interruptionRow(attemptId: string) {
  return {
    user_id: USER_ID,
    plan_session_id: SESSION_ID,
    occurred_at: "2026-08-29T10:08:00.000Z",
    event_data: { attemptId },
  };
}
