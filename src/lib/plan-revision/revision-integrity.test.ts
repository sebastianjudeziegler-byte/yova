import { describe, expect, it } from "vitest";
import { DELTA_NOW, deltaFixture, deltaTopicId, deterministicDeltaPlan } from "@/evals/personalization-delta-fixture";
import { buildPlanRevision } from "@/lib/plan-revision/build-plan-revision";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import type { RevisionControls } from "@/lib/plan-revision/revision-schema";
import type { RevisionSessionProtection } from "@/lib/plan-revision/revision-session-scope";
import type { MapDelta } from "@/lib/plan-revision/map-delta";
import { studyRouteToLegacySessionProjection } from "@/lib/study-route/adapters";

const ETC = deltaTopicId(4);
const source: MapDelta = { operations: [{ op: "attach_source", topic_id: ETC, url: "https://example.com/respiration" }] };
const empty: RevisionControls = { excludedOperationIndexes: [], sessionEdits: [] };
function build(delta = source, controls = empty, protections: RevisionSessionProtection[] = [], plan = deterministicDeltaPlan(1)) {
  return buildPlanRevision({ ...deltaFixture(1), plan, delta, controls, protections, otherReservations: [], contextKind: "draft", now: DELTA_NOW, fill: async fixed => buildNormalPlanFallbackFill(fixed) });
}

describe("reviewed edits remain protected across later topic revisions", () => {
  it("keeps explicit learner copy in the session and its canonical displayed route", async () => {
    const plan = structuredClone(deterministicDeltaPlan(1));
    const session = plan.sessions.find(item => item.topicIds?.includes(ETC))!;
    session.title = "My ETC cause-and-effect explanation";
    session.objective = "Connect my proton-gradient notes to ATP formation without losing the distinction.";
    session.methodReason = "I chose to keep this explanation tied to the worked example in my notes.";
    const proposal = await build(source, empty, [{ sessionId: session.id, savedWork: false, pinnedTime: false, editedFields: ["title", "objective", "methodReason"] }], plan);
    const after = proposal.after.sessions.find(item => item.id === session.id)!;
    expect(after.title).toBe(session.title);
    expect(after.objective).toBe(session.objective);
    expect(after.methodReason).toBe(session.methodReason);
    const displayed = studyRouteToLegacySessionProjection(after.studyRoute!);
    expect(displayed.methodReason).toBe(session.methodReason);
  });

  it("excluding a line also excludes its method/time controls", async () => {
    const plan = structuredClone(deterministicDeltaPlan(1));
    const session = plan.sessions.find(item => item.topicIds?.includes(ETC))!;
    const proposal = await build(source, { excludedOperationIndexes: [0], sessionEdits: [{ sessionId: session.id, durationMinutes: 45 }] }, [], plan);
    expect(proposal.after.sessions).toEqual(plan.sessions);
    expect(proposal.canApply).toBe(false);
  });

  it("an explicitly selected time can move a pin out of a removed availability window", async () => {
    const plan = structuredClone(deterministicDeltaPlan(1));
    const session = plan.sessions.find(item => item.topicIds?.includes(ETC))!;
    const request = deltaFixture(1).request;
    // First let the same composer choose a valid replacement in the new window.
    const delta: MapDelta = { operations: [{ op: "set_availability", availability: request.availability.map(slot => ({ ...slot, window: "20:00–22:00", minutes: 120 })) }] };
    const unpinned = await build(delta, empty, [], plan);
    expect(unpinned.canApply).toBe(true);
    const time = unpinned.after.sessions.find(item => item.id === session.id)!.scheduledFor;
    const pinned = await build(delta, { excludedOperationIndexes: [], sessionEdits: [{ sessionId: session.id, scheduledFor: time }] }, [{ sessionId: session.id, savedWork: false, pinnedTime: true, editedFields: ["scheduledFor"] }], plan);
    expect(pinned.capacity.status, pinned.capacity.explanation).not.toBe("insufficient");
    expect(pinned.after.sessions.find(item => item.id === session.id)!.scheduledFor).toBe(time);
    const blocked = await build(delta, empty, [{ sessionId: session.id, savedWork: false, pinnedTime: true, editedFields: ["scheduledFor"] }], plan);
    expect(blocked.canApply).toBe(false);
    expect(blocked.capacity.explanation).toContain("fixed time");
  });
});
