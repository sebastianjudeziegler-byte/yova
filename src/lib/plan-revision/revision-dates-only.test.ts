import { describe, expect, it, vi } from "vitest";
import { DELTA_NOW, deltaFixture, deterministicDeltaPlan } from "@/evals/personalization-delta-fixture";
import { buildPlanRevision } from "@/lib/plan-revision/build-plan-revision";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import type { LearningPlanSession } from "@/lib/domain";
import type { RevisionControls } from "@/lib/plan-revision/revision-schema";
import type { MapDelta } from "@/lib/plan-revision/map-delta";

/**
 * Brief 2.5 root cause 3 (findings 17, 18, 64). A deadline change rewrote
 * every block to Concept Mapping, and moving a block renamed, re-methoded and
 * re-dated it, because both rebuilt the block through the plan composer.
 * Spec section 5: a deadline change re-spaces remaining work and touches
 * nothing else; moving a block changes its date and nothing else.
 */
const MINUTE = 60_000, DAY = 86_400_000;
const end = (session: LearningPlanSession) => Date.parse(session.scheduledFor) + session.estimatedMinutes * MINUTE;
const without = (session: LearningPlanSession, ...fields: (keyof LearningPlanSession)[]) => Object.fromEntries(Object.entries(session).filter(([key]) => !fields.includes(key as keyof LearningPlanSession)));
const withoutDate = (session: LearningPlanSession) => without(session, "scheduledFor");

function build(plan: ReturnType<typeof deterministicDeltaPlan>, delta: MapDelta, controls: RevisionControls, request = deltaFixture(1).request) {
  const fill = vi.fn(async (fixed: Parameters<typeof buildNormalPlanFallbackFill>[0]) => buildNormalPlanFallbackFill(fixed));
  const proposal = buildPlanRevision({ ...deltaFixture(1), request, plan, delta, controls, protections: [], otherReservations: [], contextKind: "active", now: DELTA_NOW, fill });
  return { proposal, fill };
}

describe("schedule edits change dates and nothing else", () => {
  it("an earlier deadline moves only the blocks that no longer fit, and only their dates", async () => {
    const plan = structuredClone(deterministicDeltaPlan(1));
    const sessions = [...plan.sessions].sort((a, b) => end(a) - end(b));
    // A deadline that the last block no longer meets, with room left before it.
    const deadline = new Date(Date.parse(sessions.at(-1)!.scheduledFor) - MINUTE).toISOString();
    expect(end(sessions.at(-1)!)).toBeGreaterThan(Date.parse(deadline));
    const { proposal: pending, fill } = build(plan, { operations: [{ op: "set_deadline", iso: deadline }] }, { excludedOperationIndexes: [], sessionEdits: [] });
    const proposal = await pending;
    expect(proposal.canApply, proposal.capacity.explanation).toBe(true);
    expect(proposal.after.deadline).toBe(deadline);
    for (const before of plan.sessions) {
      const after = proposal.after.sessions.find(session => session.id === before.id)!;
      expect(withoutDate(after), `${before.title}: only its date may change`).toEqual(withoutDate(before));
      expect(end(after), `${before.title} ends before the new deadline`).toBeLessThanOrEqual(Date.parse(deadline));
    }
    expect(proposal.after.sessions.filter(session => session.scheduledFor !== plan.sessions.find(item => item.id === session.id)!.scheduledFor).length).toBeGreaterThan(0);
    // No block is rebuilt, so no provider copy is requested.
    expect(fill).not.toHaveBeenCalled();
  });

  it("moving a block changes its date and nothing else, and leaves every other block byte-identical", async () => {
    const plan = structuredClone(deterministicDeltaPlan(1));
    const target = [...plan.sessions].sort((a, b) => a.sequence - b.sequence).find(session => session.learningMode === "study")!;
    // The inline move keeps the wall-clock time and changes the day, onto a day
    // with no other block near that time.
    const clash = (start: number) => plan.sessions.some(session => session.id !== target.id
      && Date.parse(session.scheduledFor) - 5 * MINUTE < start + target.estimatedMinutes * MINUTE && end(session) + 5 * MINUTE > start);
    let moved = Date.parse(target.scheduledFor) + DAY;
    while (clash(moved)) moved += DAY;
    const scheduledFor = new Date(moved).toISOString();
    const request = deltaFixture(1).request;
    const { proposal: pending, fill } = build(plan, { operations: [{ op: "set_availability", availability: request.availability }] },
      { excludedOperationIndexes: [], sessionEdits: [{ sessionId: target.id, operationIndex: 0, scheduledFor }] }, request);
    const proposal = await pending;
    expect(proposal.canApply, proposal.capacity.explanation).toBe(true);
    const after = proposal.after.sessions.find(session => session.id === target.id)!;
    expect(after.scheduledFor).toBe(scheduledFor);
    expect(after.method).toBe(target.method);
    expect(after.title).toBe(target.title);
    expect(without(after, "scheduledFor", "revisionEditedFields")).toEqual(without(target, "scheduledFor", "revisionEditedFields"));
    expect(after.revisionEditedFields).toContain("scheduledFor");
    for (const before of plan.sessions.filter(session => session.id !== target.id)) {
      expect(JSON.stringify(proposal.after.sessions.find(session => session.id === before.id)), before.title).toBe(JSON.stringify(before));
    }
    expect(fill).not.toHaveBeenCalled();
  });
});
