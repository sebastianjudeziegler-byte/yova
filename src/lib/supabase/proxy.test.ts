import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  publicConfig: {
    url: "https://project.supabase.co",
    publishableKey: "sb_publishable_test",
  } as null | { url: string; publishableKey: string },
  claims: null as null | { sub: string },
  accessGranted: false,
  accessError: null as null | { message: string },
  rpc: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({ data: { claims: mocks.claims } }),
    },
    rpc: (name: string) => mocks.rpc(name),
  }),
}));
vi.mock("@/lib/supabase/config", () => ({
  getSupabasePublicConfig: () => mocks.publicConfig,
}));

import { isPublicInviteOnlyPath, updateSupabaseSession } from "@/lib/supabase/proxy";

describe("invite-only proxy access", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_INVITE_ONLY", "true");
    mocks.publicConfig = {
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable_test",
    };
    mocks.claims = null;
    mocks.accessGranted = false;
    mocks.accessError = null;
    mocks.rpc.mockReset().mockImplementation(async () => ({
      data: mocks.accessGranted,
      error: mocks.accessError,
    }));
  });

  it.each([
    "/privacy",
    "/terms",
    "/support",
    "/robots.txt",
    "/sitemap.xml",
    "/manifest.webmanifest",
    "/opengraph-image",
    "/twitter-image",
    "/auth/confirm",
    "/api/system/status",
    "/api/errors",
    "/api/internal/account-export-cleanup",
    "/study-profile",
    "/study-profile/report/private-token",
    "/study-profile/waitlist/confirm",
    "/study-profile/opengraph-image",
    "/study-profile/twitter-image",
    "/api/study-profile/events",
    "/api/study-profile/responses",
    "/api/study-profile/waitlist",
    "/api/study-profile/waitlist/confirm",
    "/api/study-profile/reports/private-token",
    "/api/study-profile/interest/private-token",
  ])("keeps the public route outside the tester gate: %s", (pathname) => {
    expect(isPublicInviteOnlyPath(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/study-profile/setup",
    "/study-profile/report/private-token/extra",
    "/founder/testers",
    "/api/support",
    "/api/sessions/generate",
    "/api/study-profile/private-admin",
  ])("keeps the private route inside the tester gate: %s", (pathname) => {
    expect(isPublicInviteOnlyPath(pathname)).toBe(false);
  });

  it("allows the signed-out marketing shell but blocks private pages and APIs", async () => {
    const pageResponse = await updateSupabaseSession(request("/"));
    const setupResponse = await updateSupabaseSession(request("/study-profile/setup"));
    const apiResponse = await updateSupabaseSession(request("/api/sessions/generate"));

    expect(pageResponse.headers.get("x-middleware-next")).toBe("1");
    expect(setupResponse.status).toBe(307);
    expect(setupResponse.headers.get("location")).toBe("https://yova.example/?auth=invite-required");
    expect(apiResponse.status).toBe(401);
    await expect(apiResponse.json()).resolves.toEqual({
      error: "Sign in with an invited tester account.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps the public Study Profile available to signed-out and uninvited visitors", async () => {
    const signedOutPage = await updateSupabaseSession(request("/study-profile"));
    const signedOutApi = await updateSupabaseSession(request("/api/study-profile/responses"));

    mocks.claims = { sub: "uninvited-user" };
    const uninvitedReport = await updateSupabaseSession(request("/study-profile/report/private-token", true));
    const uninvitedApi = await updateSupabaseSession(request("/api/study-profile/interest/private-token", true));

    for (const response of [signedOutPage, signedOutApi, uninvitedReport, uninvitedApi]) {
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("lets the cron route reach its own bearer-secret check", async () => {
    const response = await updateSupabaseSession(request("/api/internal/account-export-cleanup"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed on private routes when Supabase configuration is unavailable", async () => {
    mocks.publicConfig = null;

    const publicResponse = await updateSupabaseSession(request("/study-profile"));
    const privatePageResponse = await updateSupabaseSession(request("/study-profile/setup"));
    const privateApiResponse = await updateSupabaseSession(request("/api/sessions/generate"));

    expect(publicResponse.headers.get("x-middleware-next")).toBe("1");
    expect(privatePageResponse.status).toBe(503);
    expect(privateApiResponse.status).toBe(503);
  });

  it("allows a tester only after the private claim RPC grants access", async () => {
    mocks.claims = { sub: "tester-user" };
    mocks.accessGranted = true;

    const response = await updateSupabaseSession(request("/"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.rpc).toHaveBeenCalledWith("claim_yova_tester_access");
  });

  it("leaves every route open when invite-only mode is disabled", async () => {
    vi.stubEnv("AUTH_INVITE_ONLY", "false");

    const pageResponse = await updateSupabaseSession(request("/study-profile/setup"));
    const apiResponse = await updateSupabaseSession(request("/api/sessions/generate"));

    expect(pageResponse.headers.get("x-middleware-next")).toBe("1");
    expect(apiResponse.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("clears an uninvited session and denies both pages and APIs", async () => {
    mocks.claims = { sub: "uninvited-user" };

    const pageResponse = await updateSupabaseSession(request("/", true));
    const apiResponse = await updateSupabaseSession(request("/api/plans/status", true));

    expect(pageResponse.status).toBe(307);
    expect(pageResponse.headers.get("location")).toBe("https://yova.example/?auth=invite-required");
    expect(pageResponse.headers.get("set-cookie")).toContain("sb-project-auth-token=");
    expect(pageResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(apiResponse.status).toBe(403);
  });

  it("fails closed when the access RPC is unavailable", async () => {
    mocks.claims = { sub: "tester-user" };
    mocks.accessError = { message: "function missing" };

    const response = await updateSupabaseSession(request("/"));

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toContain("could not verify private-alpha access");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

function request(pathname: string, authenticatedCookie = false) {
  return new NextRequest(`https://yova.example${pathname}`, {
    headers: authenticatedCookie
      ? { cookie: "sb-project-auth-token=opaque-session" }
      : undefined,
  });
}
