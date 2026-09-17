import { describe, expect, it } from "vitest";
import { deterministicDeltaPlan } from "@/evals/personalization-delta-fixture";
import type { LearningPlanSession } from "@/lib/domain";
import { applySessionRevisionPatches, RevisionConflict } from "@/lib/plan-revision/revision-patch";

/**
 * Production, 17 Sept 2026: Undo on a saved plan change always failed with
 * "A changed session no longer matches this preview". The live session read
 * from the database writes its time as "2026-09-19T08:00:00+00:00"; the copy
 * stored with the change wrote the same moment as "2026-09-19T08:00:00.000Z".
 * The preimage check compared them as text.
 */
// One plan for every session here: each call to the fixture issues fresh route ids.
const BASE: LearningPlanSession = { ...deterministicDeltaPlan(1).sessions[0]!, status: "ready", resource: undefined };
function session(overrides: Partial<LearningPlanSession> = {}): LearningPlanSession {
  return { ...structuredClone(BASE), ...overrides };
}

describe("session preimage check compares times as moments", () => {
  it("accepts the same moment written with +00:00 and with .000Z", () => {
    const stored = session({ scheduledFor: "2026-09-19T08:00:00.000Z" });
    const live = session({ scheduledFor: "2026-09-19T08:00:00+00:00" });
    const after = { ...stored, title: "Restored title" };
    const result = applySessionRevisionPatches({ current: [live], patches: [{ id: live.id, before: stored, after }], protectedSessionIds: new Set() });
    expect(result[0]!.title).toBe("Restored title");
  });

  it("accepts nested timestamps written either way, and other time zones for the same moment", () => {
    const stored = session({ scheduledFor: "2026-09-19T08:00:00.000Z" });
    const live = session({ scheduledFor: "2026-09-19T10:00:00+02:00" });
    if (stored.studyRoute && live.studyRoute) {
      stored.studyRoute = { ...stored.studyRoute, identity: { ...stored.studyRoute.identity, createdAt: "2026-09-01T10:00:00.000Z" } };
      live.studyRoute = { ...live.studyRoute, identity: { ...live.studyRoute.identity, createdAt: "2026-09-01T10:00:00+00:00" } };
    }
    expect(() => applySessionRevisionPatches({ current: [live], patches: [{ id: live.id, before: stored, after: stored }], protectedSessionIds: new Set() })).not.toThrow();
  });

  it("still refuses a session whose time really changed", () => {
    const stored = session({ scheduledFor: "2026-09-19T08:00:00.000Z" });
    const live = session({ scheduledFor: "2026-09-19T09:00:00+00:00" });
    expect(() => applySessionRevisionPatches({ current: [live], patches: [{ id: live.id, before: stored, after: stored }], protectedSessionIds: new Set() })).toThrow(RevisionConflict);
  });

  it("leaves text that only looks partly like a date compared as text", () => {
    const stored = session({ title: "2026-09-19 review" });
    const live = session({ title: "2026-09-19 Review" });
    expect(() => applySessionRevisionPatches({ current: [live], patches: [{ id: live.id, before: stored, after: stored }], protectedSessionIds: new Set() })).toThrow(RevisionConflict);
  });
});
