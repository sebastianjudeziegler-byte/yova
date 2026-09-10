import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DELTA_NOW, deltaFixture, deltaTopicId, deterministicDeltaPlan } from "@/evals/personalization-delta-fixture";
import { buildPlanRevision } from "@/lib/plan-revision/build-plan-revision";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { issuePlanRevisionProposalReceipt } from "@/lib/plan-revision/proposal-receipt";
import { PlanRevisionProposalSchema } from "@/lib/plan-revision/revision-schema";
import type { LearningPlan } from "@/lib/domain";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ load: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/plan-revision/active-context", () => ({ loadActiveRevisionContext: mocks.load }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
import { applyPlanRevision } from "@/lib/plan-revision/apply-service";
import { undoPlanRevision } from "@/lib/plan-revision/undo-service";
const userId = "a0000000-0000-4000-8000-000000000001";
const options = { userId, developmentPreview: false, now: DELTA_NOW };
const emptyHistory = { from: () => { const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) }; return chain; } };
function context(plan: LearningPlan) { return { plan, generationRequest: deltaFixture(1).request, sessionFingerprints: Object.fromEntries(plan.sessions.map(session => [session.id, `stored-${session.id}`])), protections: [] }; }
async function fixture() {
  const before = commitPlanStudyRoutes({ ...deterministicDeltaPlan(1), status: "active" as const }, DELTA_NOW.toISOString());
  const built = await buildPlanRevision({ ...deltaFixture(1), plan: before, delta: { operations: [{ op: "mark_covered", topic_id: deltaTopicId(4) }] }, controls: { excludedOperationIndexes: [], sessionEdits: [] }, protections: [], otherReservations: [], contextKind: "active", fill: async fixed => buildNormalPlanFallbackFill(fixed) });
  const proposal = PlanRevisionProposalSchema.parse({ ...built, sessionFingerprints: context(before).sessionFingerprints, fixedEvents: [] });
  const signed = issuePlanRevisionProposalReceipt({ proposal, ...options });
  return { before, proposal, input: { action: "apply" as const, proposal, proposalReceipt: signed.receipt } };
}

describe("active revision guards at the save boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("YOVA_DRAFT_RECEIPT_SECRET", "active-revision-tests-secret-01234567890123456789"); });
  it.each(["opened", "edited"])("keeps a %s session unchanged when it changed after preview", async change => {
    const { before, proposal, input } = await fixture();
    const changed = structuredClone(before);
    const session = changed.sessions.find(item => item.topicIds?.includes(deltaTopicId(4)))!;
    if (change === "edited") session.title = "My explicit edited title";
    const current = context(changed);
    mocks.load.mockResolvedValue({ ...current, protections: change === "opened" ? [{ sessionId: session.id, savedWork: true, pinnedTime: false, editedFields: [] }] : [] });
    await expect(applyPlanRevision({ ...options, input, supabase: emptyHistory as never })).rejects.toThrow(/saved work|latest version/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(proposal.before.sessions.find(item => item.id === session.id)!.title).not.toBe("My explicit edited title");
  });
  it("keeps later unrelated completion and measured map evidence when saving the reviewed topic", async () => {
    const { before, proposal, input } = await fixture();
    const current = structuredClone(before);
    const other = current.sessions.find(item => !item.topicIds?.includes(deltaTopicId(4)))!;
    other.status = "complete";
    current.knowledgeMap!.topics.find(item => item.id === other.topicIds![0])!.status = "evidenced";
    mocks.load.mockResolvedValueOnce(context(current));
    mocks.rpc.mockImplementation(async (_name, { payload }) => {
      expect(payload.sessions).toHaveLength(1);
      expect(payload.sessions[0].id).not.toBe(other.id);
      expect(payload.knowledgeMap.topics.find((item: { id: string }) => item.id === other.topicIds![0]).status).toBe("evidenced");
      const saved = { ...current, revisionId: proposal.revisionId, knowledgeMap: payload.knowledgeMap, sessions: current.sessions.map(item => payload.sessions.find((patch: { id: string }) => patch.id === item.id)?.after ?? item) };
      mocks.load.mockResolvedValueOnce(context(saved));
      return { data: { ok: true }, error: null };
    });
    const result = await applyPlanRevision({ ...options, input, supabase: emptyHistory as never });
    expect(result.plan.sessions.find(item => item.id === other.id)).toEqual(other);
    expect(result.receipt.message).toContain("everything else unchanged");
  });
  it("acknowledges an already saved Undo after a lost response without overwriting newer work", async () => {
    const { before, proposal } = await fixture();
    const current = structuredClone(before);
    current.revisionId = proposal.baseRevisionId;
    current.sessions[0]!.status = "complete";
    mocks.load.mockResolvedValue(context(current));
    const hex = createHash("sha256").update(`undo-plan-revision:${proposal.id}`).digest("hex");
    const undoId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
    const receipt = { revisionId: proposal.baseRevisionId, previousRevisionId: proposal.revisionId, message: "Previous revision restored; everything else unchanged." };
    const supabase = { from: () => { let id = ""; const chain = { select: () => chain, eq: (key: string, value: string) => { if (key === "id") id = value; return chain; }, maybeSingle: async () => ({ data: id === undoId ? { receipt } : id === proposal.id ? { proposal } : null, error: null }) }; return chain; } };
    const result = await undoPlanRevision({ ...options, supabase: supabase as never, input: { action: "undo", planId: before.id, expectedRevisionId: proposal.revisionId } });
    expect(result.receipt).toEqual(receipt);
    expect(result.plan.sessions[0]!.status).toBe("complete");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
