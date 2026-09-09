import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), openAIConfigured: vi.fn(), redirect: vi.fn(), reserve: vi.fn(), sessionRows: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/openai/config", () => ({ isOpenAISessionConfigured: mocks.openAIConfigured }));
vi.mock("@/lib/openai/plan-redirector", () => ({ redirectPlanWithOpenAI: mocks.redirect }));
vi.mock("@/lib/server/ai-usage", () => ({ reserveAIRequest: mocks.reserve }));
import { PATCH } from "@/app/api/plans/adjust/route";
function request(extra: Record<string, unknown> = {}) { return new Request("http://localhost/api/plans/adjust", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: "22222222-2222-4222-8222-222222222222", deadline: null, studyMode: "inside_yova", futureSessionMinutes: 25, ...extra }) }); }
describe("protected plan adjustment route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionRows = [{ title: "Link reaction", status: "upcoming" }, { title: "Glycolysis", status: "complete" }];
    mocks.getUser.mockResolvedValue({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null });
    mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.rpc });
  });
  it.each([{ futureSessionMinutes: 10 }, { includeDeferred: true }, { studyMode: "outside_yova" }, { deadline: "2026-10-01T18:00:00Z" }])("requires a reviewed delta for legacy mutation %j", async extra => {
    const response = await PATCH(request(extra));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "plan_revision_preview_required", error: expect.stringContaining("Your plan is unchanged") });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([false, true])("leaves the plan unchanged when a custom topic rewrite is unverified (provider: %s)", async (providerEnabled) => {
    mocks.openAIConfigured.mockReturnValue(providerEnabled);
    mocks.redirect.mockRejectedValueOnce(new Error("The revised content did not preserve the unfinished topic map."));
    const before = structuredClone(mocks.sessionRows);
    const response = await PATCH(request({ direction: "Replace the next Link reaction session with photosynthesis and chloroplasts instead. Leave my completed Glycolysis session unchanged." }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "plan_direction_unverified",
      error: expect.stringContaining("Your plan is unchanged"),
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sessionRows).toEqual(before);
  });

  it("does not treat a scope-changing request containing teach as a safe preset", async () => {
    const response = await PATCH(request({ direction: "Teach photosynthesis instead of the link reaction." }));
    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a provider-accepted wrong-topic rewrite without charging or changing the saved plan", async () => {
    mocks.openAIConfigured.mockReturnValue(true);
    mocks.redirect.mockImplementation(async (input: { sessions: Array<Record<string, unknown>> }) => input.sessions.map(row => ({
      ...row,
      title: "Photosynthesis: Purpose and Chloroplast Location",
      objective: "Explain photosynthesis and chloroplasts with one concrete example.",
      step_data: { ...(row.step_data as Record<string, unknown>), contentTargets: ["What photosynthesis is and where it happens"], completionEvidence: ["Explain how photosynthesis happens in chloroplasts"] },
    })));
    const before = structuredClone(mocks.sessionRows);
    const response = await PATCH(request({ direction: "Replace the next glycolysis session with photosynthesis and chloroplasts instead. Keep the same schedule." }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("Your plan is unchanged") });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sessionRows).toEqual(before);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

});
