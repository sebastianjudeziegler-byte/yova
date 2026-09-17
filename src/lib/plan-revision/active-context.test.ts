import { describe, expect, it, vi } from "vitest";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { DELTA_NOW, deltaFixture, deterministicDeltaPlan } from "@/evals/personalization-delta-fixture";

vi.mock("server-only", () => ({}));
import { loadActiveRevisionContext } from "@/lib/plan-revision/active-context";

// The database returns JSON, so the fixture is round-tripped the same way.
function storedContext(editedFields: unknown) {
  const plan = commitPlanStudyRoutes({ ...deterministicDeltaPlan(1), status: "active" as const }, DELTA_NOW.toISOString());
  const context = JSON.parse(JSON.stringify({
    plan, generationRequest: deltaFixture(1).request,
    sessionFingerprints: Object.fromEntries(plan.sessions.map(session => [session.id, `stored-${session.id}`])),
    protections: plan.sessions.map(session => ({ sessionId: session.id, savedWork: false, pinnedTime: false, editedFields })),
  }));
  return { plan, supabase: { rpc: async () => ({ data: context, error: null }) } as never };
}

describe("active revision context from the database", () => {
  it("hydrates a v2 marker from persisted generation inputs before checking the runtime session bound", async () => {
    const fixture = storedContext([]);
    const result = await (fixture.supabase as { rpc: () => Promise<{data: Record<string, unknown>}> }).rpc();
    const data = result.data as { plan: typeof fixture.plan; generationRequest: Record<string, unknown> };
    data.generationRequest.planModel = data.plan.planModel;
    delete data.plan.planModel;
    const original = data.plan.sessions;
    data.plan.sessions = Array.from({length: 40}, (_, index) => ({...original[index % original.length]!,sequence:index + 1}));
    const supabase = {rpc: async () => ({data,error:null})} as never;
    const context = await loadActiveRevisionContext(supabase, fixture.plan.id);
    expect(context.plan.planModel?.version).toBe("topic_plan_v2");
    expect(context.plan.sessions).toHaveLength(40);
    delete data.generationRequest.planModel;
    await expect(loadActiveRevisionContext(supabase, fixture.plan.id)).rejects.toThrow(/legacy revision/i);
  });

  it("reads a stored null edit list as no reviewed edits", async () => {
    const { plan, supabase } = storedContext(null);
    const context = await loadActiveRevisionContext(supabase, plan.id);
    expect(context.protections).toHaveLength(plan.sessions.length);
    expect(context.protections.every(protection => Array.isArray(protection.editedFields) && protection.editedFields.length === 0)).toBe(true);
  });

  it("keeps reviewed edits the learner made", async () => {
    const { plan, supabase } = storedContext(["scheduledFor", "estimatedMinutes"]);
    const context = await loadActiveRevisionContext(supabase, plan.id);
    expect(context.protections[0]!.editedFields).toEqual(["scheduledFor", "estimatedMinutes"]);
  });

  it("still rejects an edit list it does not recognize", async () => {
    const { plan, supabase } = storedContext(["everything"]);
    await expect(loadActiveRevisionContext(supabase, plan.id)).rejects.toThrow();
  });
});
