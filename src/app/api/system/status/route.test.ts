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
    vi.stubEnv("AUTH_PASSWORD_ACCOUNTS", "false");
    vi.stubEnv("AUTH_CAPTCHA_ENABLED", "false");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("CRON_SECRET", "cron-secret-that-is-at-least-thirty-two-characters");
  });

  it("reports invite readiness only when storage and the Supabase signup policy are ready", async () => {
    const response = await GET();
    const status = await response.json();

    expect(status).toMatchObject({
      testerAccess: "invite-only",
      testerInvitations: "founder-managed",
      emailVerification: "code-and-link",
      passwordAccounts: "disabled",
      captchaClient: "disabled",
      publicSignup: "disabled",
      accountDataExport: "enabled",
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

  it("reports public password accounts ready when the Turnstile client is configured", async () => {
    vi.stubEnv("AUTH_INVITE_ONLY", "false");
    vi.stubEnv("AUTH_PASSWORD_ACCOUNTS", "true");
    vi.stubEnv("AUTH_CAPTCHA_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "turnstile-public-key");
    mocks.settingsFetch.mockResolvedValue(new Response(
      JSON.stringify({ disable_signup: false }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const response = await GET();
    const status = await response.json();

    expect(status).toMatchObject({
      authentication: "supabase-password-and-email",
      testerAccess: "open",
      passwordAccounts: "enabled",
      captchaClient: "turnstile",
      publicSignup: "enabled",
    });
    expect(status).not.toHaveProperty("captchaProtection");
  });

  it("keeps client readiness separate when Supabase signup settings cannot be checked", async () => {
    vi.stubEnv("AUTH_CAPTCHA_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "turnstile-public-key");
    mocks.settingsFetch.mockResolvedValue(new Response(null, { status: 503 }));

    const status = await (await GET()).json();
    expect(status.captchaClient).toBe("turnstile");
    expect(status.publicSignup).toBe("unknown");
  });

  it("reports a requested CAPTCHA with no site key as misconfigured", async () => {
    vi.stubEnv("AUTH_PASSWORD_ACCOUNTS", "true");
    vi.stubEnv("AUTH_CAPTCHA_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");

    const status = await (await GET()).json();
    expect(status.captchaClient).toBe("misconfigured");
  });

  it("reports an unused site key as misconfigured", async () => {
    vi.stubEnv("AUTH_CAPTCHA_ENABLED", "false");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "turnstile-public-key");

    const status = await (await GET()).json();
    expect(status.captchaClient).toBe("misconfigured");
  });

  it("reports account-data export unavailable without both cleanup credentials", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect((await (await GET()).json()).accountDataExport).toBe("unavailable");

    vi.stubEnv("CRON_SECRET", "cron-secret-that-is-at-least-thirty-two-characters");
    mocks.adminConfigured = false;
    expect((await (await GET()).json()).accountDataExport).toBe("unavailable");
  });
});
