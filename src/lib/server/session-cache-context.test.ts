import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  buildSessionCacheContext,
  sessionCacheContextMatches,
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
});
