import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockFixture, BLOCK_ROUTE_ID } from "@/evals/brief-c-block-fixture";
import { CachedGeneratedSessionV19Schema } from "@/lib/session-generation/schema";
import { initialBlockProgress } from "@/lib/session-blocks/progress";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn(), evaluate: vi.fn(), reserve: vi.fn(), settle: vi.fn(), consume: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/openai/answer-evaluator", () => ({ evaluateAnswerWithOpenAI: mocks.evaluate }));
vi.mock("@/lib/server/ai-usage", () => ({ reserveAIRequest: mocks.reserve, settleAIRequestClaim: mocks.settle, consumeAIRequestClaimAfterProviderFailure: mocks.consume }));
vi.mock("@/lib/server/rate-limit", () => ({ checkAnswerEvaluationRateLimit: () => ({ allowed: true }), requestRateLimitKey: () => "block-test" }));
import { POST } from "./route";

const resource = CachedGeneratedSessionV19Schema.parse(blockFixture());
let stored = { resource, answerKeys: [
  { questionId: "atp-products", answer: "ADP and inorganic phosphate", requiredIdeas: ["Both hydrolysis products"], explanation: "ATP reacts with water to form ADP and inorganic phosphate, not glucose or oxygen.", workedSolution: [], sourceIds: ["lecture-page-1"] },
  { questionId: "atp-coupling", answer: "The favorable reaction supplies free energy to the coupled process.", requiredIdeas: ["Favorable hydrolysis supplies free energy to the coupled process"], explanation: "The favorable free-energy change can drive the coupled process.", workedSolution: [], sourceIds: ["lecture-page-1"] },
], progress: initialBlockProgress(resource.block.id), progressVersion: 0 };
const binding = { planId: "c0000000-0000-4000-8000-000000000090", planSessionId: "c0000000-0000-4000-8000-000000000091", routeRevisionId: BLOCK_ROUTE_ID, blockId: resource.block.id };
const post = (action: Record<string, unknown>) => POST(new Request("https://yova.test/api/sessions/block", { method: "POST", body: JSON.stringify({ ...binding, ...action }), headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  stored = { ...stored, progress: initialBlockProgress(resource.block.id), progressVersion: 0 };
  mocks.user.mockResolvedValue({ data: { user: { id: "c0000000-0000-4000-8000-000000000099" } }, error: null });
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name === "read_session_work_block_v1") return { data: structuredClone(stored), error: null };
    if (name === "save_session_work_block_progress_v1") { stored.progress = args.requested_progress; stored.progressVersion += 1; return { data: stored.progressVersion, error: null }; }
    throw new Error("Unexpected block RPC");
  });
  mocks.reserve.mockResolvedValue({ allowed: true, claimId: "claim" });
  mocks.settle.mockResolvedValue(true);
  mocks.evaluate.mockResolvedValue({ verdict: "secure", feedback: "Your answer connects favorable hydrolysis to the coupled process.", matchedIdeas: ["Free energy drives coupled work"], missingIdeas: [] });
});

describe("server-owned block attempts", () => {
  it("resumes a server-prepared development preview without requiring a cloud account", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    const blockStore = await import("@/lib/session-blocks/store");
    const prepare = Reflect.get(blockStore, "saveDevelopmentBlock") as undefined | ((ids: typeof binding, resource: typeof stored.resource, keys: typeof stored.answerKeys) => void);
    prepare?.(binding, stored.resource, stored.answerKeys);
    const response = await POST(new Request("http://localhost/api/sessions/block", { method: "POST", headers: { "Content-Type": "application/json", "X-Yova-Development-Preview": "guided-session" }, body: JSON.stringify({ ...binding, action: "state" }) }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.progress.attempts).toEqual([]); expect(body.solutions).toEqual({});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("a source tick saves progress without recording a score or completion", async () => {
    const response = await post({ action: "source_complete", sourceId: "lecture-page-1" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.progress.sourceCompletedIds).toEqual(["lecture-page-1"]);
    expect(body.progress.attempts).toEqual([]); expect(body.summary).toBeUndefined();
    expect(body.progress.complete).toBe(false);
    expect(mocks.rpc.mock.calls.find(([name]) => name === "save_session_work_block_progress_v1")?.[1].checked_summary).toBeNull();
  });
  it("ignores no authority fields: client scores, keys and topic IDs are rejected", async () => {
    for (const fields of [{ outcome: "secure" }, { referenceAnswer: "ATP" }, { topicId: resource.topicIds[0] }, { conceptEvidence: [] }]) {
      expect((await post({ action: "answer", questionId: "atp-products", answer: "ADP and inorganic phosphate", ...fields })).status).toBe(422);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses the saved answer key and source when grading an explanation", async () => {
    const response = await post({ action: "answer", questionId: "atp-coupling", answer: "Hydrolysis releases free energy that drives the coupled work." });
    expect(response.status).toBe(200);
    expect(mocks.evaluate.mock.calls[0]![0].activity.referenceAnswer).toBe(stored.answerKeys[1]!.answer);
    expect(mocks.evaluate.mock.calls[0]![0].activity.prompt).toContain(resource.block.sources[0]!.text);
    expect((await response.json()).progress.attempts[0].feedback).toMatch(/coupled process/);
  });
  it("resume and reveal reuse reviewed content without generating or grading again", async () => {
    await post({ action: "answer", questionId: "atp-products", answer: "ADP and inorganic phosphate" });
    await post({ action: "answer", questionId: "atp-products", answer: "ADP and glucose" });
    const first = await (await post({ action: "state" })).json();
    expect(first.progress.attempts).toHaveLength(1); expect(first.progress.attempts[0].outcome).toBe("secure");
    expect(first.solutions["atp-coupling"]).toBeUndefined();
    const revealed = await (await post({ action: "reveal", questionId: "atp-coupling" })).json();
    expect(revealed.solutions["atp-coupling"].answer).toBe(stored.answerKeys[1]!.answer);
    expect(revealed.progress.attempts[1].outcome).toBe("unscored");
    expect(JSON.stringify(revealed)).not.toContain('"answerKeys"');
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
  it("a failed answer check leaves earlier progress intact", async () => {
    await post({ action: "source_complete", sourceId: "lecture-page-1" });
    await post({ action: "answer", questionId: "atp-products", answer: "ADP and inorganic phosphate" });
    const before = structuredClone(stored.progress);
    mocks.evaluate.mockRejectedValue(new Error("Checking is temporarily unavailable."));
    const response = await post({ action: "answer", questionId: "atp-coupling", answer: "The favorable reaction drives the process." });
    expect(response.status).toBe(409); expect((await response.json()).error).toMatch(/saved/);
    expect(stored.progress).toEqual(before); expect(mocks.consume).toHaveBeenCalledWith(expect.anything(), "claim");
  });
  it("source done cannot skip the check, and finishing returns server-checked evidence only", async () => {
    await post({ action: "source_complete", sourceId: "lecture-page-1" });
    expect((await post({ action: "complete" })).status).toBe(409);
    await post({ action: "answer", questionId: "atp-products", answer: "ADP and inorganic phosphate" });
    await post({ action: "answer", questionId: "atp-coupling", answer: "The favorable reaction drives the process." });
    const response = await post({ action: "complete" }); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.summary.conceptEvidence).toHaveLength(2);
    expect(body.progress.receipt).toMatch(/short check/);
    expect(body.summary.conceptEvidence.every((item: { routeRevisionId: string }) => item.routeRevisionId === BLOCK_ROUTE_ID)).toBe(true);
  });
});
