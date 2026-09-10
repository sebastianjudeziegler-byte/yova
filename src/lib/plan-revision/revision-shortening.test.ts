import { describe, expect, it, vi } from "vitest";
import { deltaFixture, deterministicDeltaPlan } from "@/evals/personalization-delta-fixture";
import { buildPlanRevision } from "@/lib/plan-revision/build-plan-revision";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";

// A shorter window changes the packaging, not the amount of accepted work.
describe("reviewed shorter sessions retain the accepted work", () => {
  it("keeps every remaining part and leaves unrelated sessions byte-identical", async () => {
    const fixture = deltaFixture(1);
    const plan = structuredClone(deterministicDeltaPlan(1));
    const original = plan.sessions.find(session => session.estimatedMinutes > 10)!;
    const proposal = await buildPlanRevision({ ...fixture, plan, contextKind: "active",
      delta: { operations: [{ op: "set_availability", availability: fixture.request.availability }] },
      controls: { excludedOperationIndexes: [], sessionEdits: [{ sessionId: original.id, operationIndex: 0, durationMinutes: 10 }] },
      protections: [], otherReservations: [], fill: async fixed => buildNormalPlanFallbackFill(fixed),
    });
    expect(proposal.canApply, proposal.capacity.explanation).toBe(true);
    const parts = proposal.after.sessions.filter(session => session.id === original.id || !plan.sessions.some(before => before.id === session.id));
    expect(parts).toHaveLength(Math.ceil(original.estimatedMinutes / 10));
    expect(parts.every(session => session.estimatedMinutes === 10)).toBe(true);
    expect(parts.map(session => session.title)).toEqual(parts.map((_, index) => expect.stringContaining(`Part ${index + 1} of ${parts.length}`)));
    expect(parts[0]!.method).toBe(original.method);
    expect(parts[0]!.learningMode).toBe(original.learningMode);
    for (const session of plan.sessions.filter(session => session.id !== original.id)) {
      expect(JSON.stringify(proposal.after.sessions.find(after => after.id === session.id))).toBe(JSON.stringify(session));
    }
  });
  it("shows capacity choices instead of saving only the first part when the rest cannot fit", async () => {
    const fixture = deltaFixture(1);
    const plan = structuredClone(deterministicDeltaPlan(1));
    const original = plan.sessions.find(session => session.estimatedMinutes > 10)!;
    plan.sessions = [original];
    const request = { ...fixture.request, deadline: "2026-09-07T09:15:00.000Z", availability: [{ day: "Monday", window: "Morning", minutes: 15 }] };
    plan.deadline = request.deadline;
    plan.schedulePreferences = { timeZone: "UTC", availability: request.availability };
    const fill = vi.fn(async (fixed: Parameters<typeof buildNormalPlanFallbackFill>[0]) => buildNormalPlanFallbackFill(fixed));
    const proposal = await buildPlanRevision({ ...fixture, request, plan, contextKind: "active",
      delta: { operations: [{ op: "set_availability", availability: request.availability }] },
      controls: { excludedOperationIndexes: [], sessionEdits: [{ sessionId: original.id, operationIndex: 0, durationMinutes: 10 }] },
      protections: [], otherReservations: [], fill,
    });
    expect(proposal.canApply).toBe(false);
    expect(proposal.capacity.status).toBe("insufficient");
    expect(proposal.capacity.choices.map(choice => choice.label)).toEqual(["Move a block", "Shorten scope", "Add time"]);
    expect(proposal.after.sessions).toEqual(plan.sessions);
    expect(fill).not.toHaveBeenCalled();
  });

});
