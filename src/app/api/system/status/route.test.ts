import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  adminConfigured: true,
  invitationTableError: null as { code: string } | null,
  generationReadiness: {
    contractVersion: "202608310003",
    ready: true,
    studyRoutesSchema: true,
    planSessionsRoutePointer: true,
    requiredRouteRpcs: true,
    expandedMethodAgencyBoundary: true,
    methodEligibilityV3Boundary: true,
  } as Record<string, unknown> | null,
  generationReadinessError: null as { code: string } | null,
  studyProfileReadiness: {
    contractVersion: "202608310002",
    ready: true,
    pendingConfirmationColumns: true,
    confirmationRpcs: true,
    reportEmailCooldown: true,
    serviceRoleBoundary: true,
  } as Record<string, unknown> | null,
  studyProfileReadinessError: null as { code: string } | null,
  publicLaunchAbuseReadiness: {
    contractVersion: "202609040002",
    ready: true,
    aiActionsCovered: true,
    materialUploadQuota: true,
    materialChunkWriteBoundary: true,
    untrustedInsertQuotas: true,
    tutorWriteBoundary: true,
  } as Record<string, unknown> | null,
  publicLaunchAbuseReadinessError: null as { code: string } | null,
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
    rpc: async (name: string) => {
      if (name === "study_profile_public_readiness_v1") {
        return {
          data: mocks.studyProfileReadiness,
          error: mocks.studyProfileReadinessError,
        };
      }
      if (name === "public_launch_abuse_readiness_v1") {
        return {
          data: mocks.publicLaunchAbuseReadiness,
          error: mocks.publicLaunchAbuseReadinessError,
        };
      }
      return {
        data: mocks.generationReadiness,
        error: mocks.generationReadinessError,
      };
    },
  }),
}));

import { GET } from "@/app/api/system/status/route";

describe("system status tester-access readiness", () => {
  beforeEach(() => {
    mocks.adminConfigured = true;
    mocks.invitationTableError = null;
    mocks.generationReadiness = {
      contractVersion: "202608310003",
      ready: true,
      studyRoutesSchema: true,
      planSessionsRoutePointer: true,
      requiredRouteRpcs: true,
      expandedMethodAgencyBoundary: true,
      methodEligibilityV3Boundary: true,
    };
    mocks.generationReadinessError = null;
    mocks.studyProfileReadiness = {
      contractVersion: "202608310002",
      ready: true,
      pendingConfirmationColumns: true,
      confirmationRpcs: true,
      reportEmailCooldown: true,
      serviceRoleBoundary: true,
    };
    mocks.studyProfileReadinessError = null;
    mocks.publicLaunchAbuseReadiness = {
      contractVersion: "202609040002",
      ready: true,
      aiActionsCovered: true,
      materialUploadQuota: true,
      materialChunkWriteBoundary: true,
      untrustedInsertQuotas: true,
      tutorWriteBoundary: true,
    };
    mocks.publicLaunchAbuseReadinessError = null;
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
    vi.stubEnv("YOVA_PERSONALIZATION_ROLLOUT_PERCENT", "0");
    vi.stubEnv("RESEND_API_KEY", "re_system_status_test_key");
    vi.stubEnv("STUDY_PROFILE_FROM_EMAIL", "YOVA <reports@updates.yovaapp.com>");
    vi.stubEnv("CRON_SECRET", "cron-secret-that-is-at-least-thirty-two-characters");
    vi.stubEnv(
      "YOVA_DRAFT_RECEIPT_SECRET",
      "draft-receipt-secret-that-is-at-least-thirty-two-characters",
    );
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
      accountDeletion: "enabled",
      signedInGeneration: "ready",
      launchAbuseProtection: "ready",
      personalizationRollout: {
        policyVersion: "personalization_rollout_v1",
        status: "baseline",
        percent: 0,
      },
      studyProfilePublic: "ready",
      studyProfileEmail: "resend",
    });
    expect(status).not.toHaveProperty("supabasePublishableKey");
    expect(mocks.settingsFetch).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/settings",
      expect.objectContaining({ headers: { apikey: "sb_publishable_test" } }),
    );
  });

  it("reports transactional Study Profile email unavailable when Resend is incomplete", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect((await (await GET()).json()).studyProfileEmail).toBe("unavailable");

    vi.stubEnv("RESEND_API_KEY", "re_system_status_test_key");
    vi.stubEnv("STUDY_PROFILE_FROM_EMAIL", "not-an-address");
    expect((await (await GET()).json()).studyProfileEmail).toBe("unavailable");
  });

  it("fails the public Study Profile signal when double opt-in or cooldown protection is missing", async () => {
    mocks.studyProfileReadinessError = { code: "PGRST202" };
    expect((await (await GET()).json()).studyProfilePublic).toBe("unavailable");

    mocks.studyProfileReadinessError = null;
    mocks.studyProfileReadiness = {
      contractVersion: "202608310002",
      ready: false,
      pendingConfirmationColumns: true,
      confirmationRpcs: true,
      reportEmailCooldown: false,
      serviceRoleBoundary: true,
    };
    expect((await (await GET()).json()).studyProfilePublic).toBe("unavailable");
  });

  it("fails the public-launch signal when durable abuse controls are missing", async () => {
    mocks.publicLaunchAbuseReadiness = {
      contractVersion: "202609040002",
      ready: false,
      aiActionsCovered: true,
      materialUploadQuota: false,
      materialChunkWriteBoundary: true,
      untrustedInsertQuotas: true,
      tutorWriteBoundary: true,
    };

    expect((await (await GET()).json()).launchAbuseProtection).toBe("unavailable");

    mocks.publicLaunchAbuseReadinessError = { code: "PGRST202" };
    expect((await (await GET()).json()).launchAbuseProtection).toBe("unavailable");
  });

  it("fails the signed-in generation signal when its secret or database contract is missing", async () => {
    vi.stubEnv("YOVA_DRAFT_RECEIPT_SECRET", "");
    expect((await (await GET()).json()).signedInGeneration).toBe("unavailable");

    vi.stubEnv(
      "YOVA_DRAFT_RECEIPT_SECRET",
      "draft-receipt-secret-that-is-at-least-thirty-two-characters",
    );
    mocks.generationReadinessError = { code: "PGRST202" };
    expect((await (await GET()).json()).signedInGeneration).toBe("unavailable");

    mocks.generationReadinessError = null;
    mocks.generationReadiness = {
      contractVersion: "202608310003",
      ready: true,
      studyRoutesSchema: true,
      planSessionsRoutePointer: true,
      requiredRouteRpcs: true,
      expandedMethodAgencyBoundary: true,
      methodEligibilityV3Boundary: false,
    };
    expect((await (await GET()).json()).signedInGeneration).toBe("unavailable");
  });

  it("reports staged rollout configuration without treating baseline zero as database-unready", async () => {
    expect((await (await GET()).json())).toMatchObject({
      signedInGeneration: "ready",
      personalizationRollout: { status: "baseline", percent: 0 },
    });

    vi.stubEnv("YOVA_PERSONALIZATION_ROLLOUT_PERCENT", "35");
    expect((await (await GET()).json()).personalizationRollout).toEqual({
      policyVersion: "personalization_rollout_v1",
      status: "staged",
      percent: 35,
    });

    vi.stubEnv("YOVA_PERSONALIZATION_ROLLOUT_PERCENT", "invalid");
    expect((await (await GET()).json()).personalizationRollout).toEqual({
      policyVersion: "personalization_rollout_v1",
      status: "misconfigured",
      percent: null,
    });
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
    expect((await (await GET()).json()).accountDeletion).toBe("unavailable");

    vi.stubEnv("CRON_SECRET", "cron-secret-that-is-at-least-thirty-two-characters");
    mocks.adminConfigured = false;
    expect((await (await GET()).json()).accountDataExport).toBe("unavailable");
    expect((await (await GET()).json()).accountDeletion).toBe("unavailable");
  });
});
