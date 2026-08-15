import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  adminConfigured: true,
  invitationTableError: null as { code: string } | null,
  publicConfig: {
    url: "https://project.supabase.co",
    publishableKey: "sb_publishable_test",
  } as { url: string; publishableKey: string } | null,
  settingsFetch: vi.fn(),
}));

vi.mock("@/lib/openai/config", () => ({
  isOpenAIPlanConfigured: () => true,
  isOpenAISessionConfigured: () => true,
  isOpenAITutorConfigured: () => true,
}));
vi.mock("@/lib/supabase/config", () => ({
  getSupabasePublicConfig: () => mocks.publicConfig,
  isSupabaseConfigured: () => mocks.publicConfig !== null,
}));
vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => mocks.adminConfigured,
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: async () => ({ error: mocks.invitationTableError }),
    }),
  }),
}));

import { GET } from "@/app/api/system/status/route";

describe("system status tester-access readiness", () => {
  beforeEach(() => {
    mocks.adminConfigured = true;
    mocks.invitationTableError = null;
    mocks.publicConfig = {
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable_test",
    };
    mocks.settingsFetch.mockReset().mockResolvedValue(new Response(
      JSON.stringify({ disable_signup: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", mocks.settingsFetch);
    vi.stubEnv("AUTH_INVITE_ONLY", "true");
    vi.stubEnv("AUTH_EMAIL_CODE_VERIFICATION", "true");
  });

  it("reports invite readiness only when storage and the Supabase signup policy are ready", async () => {
    const response = await GET();
    const status = await response.json();

    expect(status).toMatchObject({
      testerAccess: "invite-only",
      testerInvitations: "founder-managed",
      emailVerification: "code-and-link",
      publicSignup: "disabled",
    });
    expect(status).not.toHaveProperty("supabasePublishableKey");
    expect(mocks.settingsFetch).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/settings",
      expect.objectContaining({ headers: { apikey: "sb_publishable_test" } }),
    );
  });

  it("fails the public readiness signal when the migration or signup lock is missing", async () => {
    mocks.invitationTableError = { code: "42P01" };
    mocks.settingsFetch.mockResolvedValue(new Response(
      JSON.stringify({ disable_signup: false }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const response = await GET();
    const status = await response.json();

    expect(status.testerInvitations).toBe("unavailable");
    expect(status.publicSignup).toBe("enabled");
  });
});
