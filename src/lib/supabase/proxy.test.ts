import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
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
  getSupabasePublicConfig: () => ({
    url: "https://project.supabase.co",
    publishableKey: "sb_publishable_test",
  }),
}));

import { isPublicInviteOnlyPath, updateSupabaseSession } from "@/lib/supabase/proxy";

describe("invite-only proxy access", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_INVITE_ONLY", "true");
    mocks.claims = null;
    mocks.accessGranted = false;
    mocks.accessError = null;
    mocks.rpc.mockReset().mockImplementation(async () => ({
      data: mocks.accessGranted,
      error: mocks.accessError,
    }));
  });

  it("keeps public trust and auth routes outside the tester gate", () => {
    expect(isPublicInviteOnlyPath("/privacy")).toBe(true);
    expect(isPublicInviteOnlyPath("/auth/confirm")).toBe(true);
    expect(isPublicInviteOnlyPath("/api/system/status")).toBe(true);
    expect(isPublicInviteOnlyPath("/")).toBe(false);
    expect(isPublicInviteOnlyPath("/api/sessions/generate")).toBe(false);
  });

  it("allows the signed-out landing page but blocks private APIs", async () => {
    const pageResponse = await updateSupabaseSession(request("/"));
    const apiResponse = await updateSupabaseSession(request("/api/sessions/generate"));

    expect(pageResponse.headers.get("x-middleware-next")).toBe("1");
    expect(apiResponse.status).toBe(401);
    await expect(apiResponse.json()).resolves.toEqual({
      error: "Sign in with an invited tester account.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("allows a tester only after the private claim RPC grants access", async () => {
    mocks.claims = { sub: "tester-user" };
    mocks.accessGranted = true;

    const response = await updateSupabaseSession(request("/"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.rpc).toHaveBeenCalledWith("claim_yova_tester_access");
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
