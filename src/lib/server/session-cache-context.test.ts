import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  buildSessionCacheContext,
  sessionCacheContextMatches,
  sessionCacheRouteRevisionMatches,
} from "@/lib/server/session-cache-context";

describe("generated-session cache context", () => {
  it("matches only the exact selected time and learner adjustment", () => {
    const adjusted = buildSessionCacheContext({
      plannedMinutes: 25,
      adjustment: {
        familiarity: "need_teaching",
        availableMinutes: 20,
        knownTargets: ["ATP"],
        note: "Explain energy coupling first",
      },
    });

    expect(sessionCacheContextMatches(adjusted, buildSessionCacheContext({
      plannedMinutes: 25,
      adjustment: {
        familiarity: "need_teaching",
        availableMinutes: 20,
        knownTargets: ["ATP"],
        note: "Explain energy coupling first",
      },
    }))).toBe(true);
    expect(sessionCacheContextMatches(adjusted, buildSessionCacheContext({
      plannedMinutes: 25,
      adjustment: null,
    }))).toBe(false);
    expect(sessionCacheContextMatches(adjusted, buildSessionCacheContext({
      plannedMinutes: 25,
      adjustment: {
        familiarity: "need_teaching",
        availableMinutes: 20,
        knownTargets: ["ATP"],
        note: "Also cover redox reactions",
      },
    }))).toBe(false);
  });

  it("does not store the learner note in cache metadata", () => {
    const context = buildSessionCacheContext({
      plannedMinutes: 25,
      adjustment: {
        familiarity: "as_planned",
        availableMinutes: null,
        knownTargets: [],
        note: "private direction",
      },
    });

    expect(JSON.stringify(context)).not.toContain("private direction");
    expect(context.adjustmentFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("invalidates an older cache when a versioned generation contract changes", () => {
    const legacy = buildSessionCacheContext({
      plannedMinutes: 10,
      adjustment: null,
    });
    const scheduled = buildSessionCacheContext({
      plannedMinutes: 10,
      adjustment: null,
      contractKey: JSON.stringify({
        contract: "scheduled_review_v1",
        topicIds: ["11111111-1111-4111-8111-111111111111"],
        contentTargets: ["Electron transport chain"],
      }),
    });
    const sameScheduled = buildSessionCacheContext({
      plannedMinutes: 10,
      adjustment: null,
      contractKey: JSON.stringify({
        contract: "scheduled_review_v1",
        topicIds: ["11111111-1111-4111-8111-111111111111"],
        contentTargets: ["Electron transport chain"],
      }),
    });
    const changedTarget = buildSessionCacheContext({
      plannedMinutes: 10,
      adjustment: null,
      contractKey: JSON.stringify({
        contract: "scheduled_review_v1",
        topicIds: ["11111111-1111-4111-8111-111111111111"],
        contentTargets: ["Chemiosmosis"],
      }),
    });

    expect(scheduled.contractFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(sessionCacheContextMatches(legacy, scheduled)).toBe(false);
    expect(sessionCacheContextMatches(scheduled, sameScheduled)).toBe(true);
    expect(sessionCacheContextMatches(scheduled, changedTarget)).toBe(false);
    expect(JSON.stringify(scheduled)).not.toContain("Electron transport chain");
  });

  it("never reuses generated content across committed route revisions", () => {
    const first = buildSessionCacheContext({
      plannedMinutes: 25,
      adjustment: null,
      routeRevisionId: "11111111-1111-4111-8111-111111111111",
    });
    const same = buildSessionCacheContext({
      plannedMinutes: 25,
      adjustment: null,
      routeRevisionId: "11111111-1111-4111-8111-111111111111",
    });
    const successor = buildSessionCacheContext({
      plannedMinutes: 25,
      adjustment: null,
      routeRevisionId: "22222222-2222-4222-8222-222222222222",
    });
    const legacy = buildSessionCacheContext({
      plannedMinutes: 25,
      adjustment: null,
    });

    expect(sessionCacheContextMatches(first, same)).toBe(true);
    expect(sessionCacheContextMatches(first, successor)).toBe(false);
    expect(sessionCacheContextMatches(legacy, first)).toBe(false);
    expect(sessionCacheContextMatches(first, legacy)).toBe(false);
    expect(first.scopeFingerprint).not.toBe(successor.scopeFingerprint);
  });

  it("requires both cached route receipts to match while preserving legacy-only reuse", () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const successor = "22222222-2222-4222-8222-222222222222";

    expect(sessionCacheRouteRevisionMatches(first, first, first)).toBe(true);
    expect(sessionCacheRouteRevisionMatches(first, first, successor)).toBe(false);
    expect(sessionCacheRouteRevisionMatches(successor, first, first)).toBe(false);
    expect(sessionCacheRouteRevisionMatches(first, undefined, first)).toBe(false);
    expect(sessionCacheRouteRevisionMatches(undefined, first, first)).toBe(false);
    expect(sessionCacheRouteRevisionMatches(undefined, undefined, first)).toBe(false);

    expect(sessionCacheRouteRevisionMatches(undefined, undefined, undefined)).toBe(true);
    expect(sessionCacheRouteRevisionMatches(first, first, undefined)).toBe(false);
  });
});
