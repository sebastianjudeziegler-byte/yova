import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
import { POST } from "@/app/api/materials/attach/route";
describe("active-plan material attachment route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, rpc: mocks.rpc }); });
  it("requires a topic and reviewed revision instead of globally replacing sources", async () => {
    const response = await POST();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "plan_revision_preview_required", error: expect.stringContaining("topic") });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("still requires the authenticated owner", async () => {
    mocks.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
    expect((await POST()).status).toBe(401);
  });
});
