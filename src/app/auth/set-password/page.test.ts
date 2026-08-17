import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  configured: true,
  getUser: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

import SetPasswordPage from "@/app/auth/set-password/page";

describe("authenticated password-setting page", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("AUTH_PASSWORD_ACCOUNTS", "true");
    mocks.configured = true;
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: { id: "user-1", email: "learner@example.com", email_confirmed_at: "2026-08-17T12:00:00.000Z" } },
      error: null,
    });
    mocks.redirect.mockClear();
  });

  it("renders only after a cookie-backed user is verified", async () => {
    const result = await SetPasswordPage({ searchParams: Promise.resolve({ source: "account" }) });

    expect(result.props.source).toBe("account");
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["account", "invite", "recovery"] as const)(
    "rejects a user-controlled %s source until the provider confirms the email",
    async (source) => {
      mocks.getUser.mockResolvedValue({
        data: { user: { id: "user-1", email: "learner@example.com", email_confirmed_at: null } },
        error: null,
      });

      await expect(SetPasswordPage({ searchParams: Promise.resolve({ source }) }))
        .rejects.toThrow("REDIRECT:/?auth=invalid-link");
    },
  );

  it.each(["invite", "recovery"] as const)("keeps a provider-confirmed %s flow available", async (source) => {
    const result = await SetPasswordPage({ searchParams: Promise.resolve({ source }) });
    expect(result.props.source).toBe(source);
  });

  it("rejects a missing recovery session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { code: "not_authenticated" } });

    await expect(SetPasswordPage({ searchParams: Promise.resolve({ source: "recovery" }) }))
      .rejects.toThrow("REDIRECT:/?auth=invalid-link");
  });

  it("stays unavailable while the password feature flag is off", async () => {
    vi.stubEnv("AUTH_PASSWORD_ACCOUNTS", "false");

    await expect(SetPasswordPage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("REDIRECT:/?auth=invalid-link");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
});
