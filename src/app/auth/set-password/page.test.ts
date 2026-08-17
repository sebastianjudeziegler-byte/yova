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
      data: { user: { id: "user-1", email: "learner@example.com" } },
      error: null,
    });
    mocks.redirect.mockClear();
  });

  it("renders only after a cookie-backed user is verified", async () => {
    const result = await SetPasswordPage({ searchParams: Promise.resolve({ source: "recovery" }) });

    expect(result.props.source).toBe("recovery");
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
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
