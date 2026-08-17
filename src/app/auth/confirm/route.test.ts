import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  configured: true,
  adminConfigured: true,
  verifyOtp: vi.fn(),
  ledgerUpdate: vi.fn(),
}));

vi.mock("@/lib/site-url", () => ({
  getSiteUrl: () => new URL("https://yova.example"),
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => mocks.configured,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp: mocks.verifyOtp } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => mocks.adminConfigured,
  createSupabaseAdminClient: () => ({
    from: () => ({
      update: (values: unknown) => ({
        eq: (column: string, value: string) => mocks.ledgerUpdate(values, column, value),
      }),
    }),
  }),
}));

import { GET, POST } from "@/app/auth/confirm/route";

describe("tester invitation confirmation route", () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.adminConfigured = true;
    mocks.verifyOtp.mockReset().mockResolvedValue({
      data: {
        user: {
          id: "tester-user-1",
          email: "Tester@Example.com",
          email_confirmed_at: "2026-08-14T11:00:00.000Z",
        },
      },
      error: null,
    });
    mocks.ledgerUpdate.mockReset().mockResolvedValue({ error: null });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only a bounded supported token hash", async () => {
    const wrongType = await GET(getRequest("a".repeat(64), "oauth"));
    const malformed = await GET(getRequest("contains.dot.and spaces", "invite"));

    expect(wrongType.status).toBe(303);
    expect(wrongType.headers.get("location")).toBe("https://yova.example/?auth=invalid-link");
    expect(malformed.headers.get("location")).toBe("https://yova.example/?auth=invalid-link");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("renders an inert no-store landing without consuming a scanner-prefetched token", async () => {
    const tokenHash = "a".repeat(64);
    const response = await GET(getRequest(tokenHash, "invite"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin");
    expect(response.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(html).toContain('<form method="post" action="/auth/confirm">');
    expect(html).toContain(`name="token_hash" value="${tokenHash}"`);
    expect(html).toContain("Accept invitation and open YOVA");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.ledgerUpdate).not.toHaveBeenCalled();
  });

  it.each(["invite", "email"] as const)(
    "verifies tester %s only on an explicit same-origin POST and redirects to fixed YOVA root",
    async (type) => {
      const tokenHash = "b".repeat(64);
      const response = await POST(postRequest(tokenHash, type, "https://attacker.example"));

      expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: tokenHash, type });
      expect(mocks.ledgerUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_user_id: "tester-user-1",
          status: "joined",
          joined_at: expect.any(String),
        }),
        "email",
        "tester@example.com",
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("https://yova.example/");
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("confirms a public signup without writing to the tester ledger", async () => {
    const tokenHash = "e".repeat(64);
    const response = await POST(postRequest(tokenHash, "signup"));

    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: tokenHash, type: "email" });
    expect(mocks.ledgerUpdate).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://yova.example/");
  });

  it("establishes a recovery session before opening the password form", async () => {
    const tokenHash = "f".repeat(64);
    const response = await POST(postRequest(tokenHash, "recovery"));

    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: tokenHash, type: "recovery" });
    expect(mocks.ledgerUpdate).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://yova.example/auth/set-password?source=recovery");
  });

  it("offers password creation after an invite only when password accounts are enabled", async () => {
    vi.stubEnv("AUTH_PASSWORD_ACCOUNTS", "true");

    const response = await POST(postRequest("g".repeat(64), "invite"));

    expect(response.headers.get("location")).toBe("https://yova.example/auth/set-password?source=invite");
  });

  it("rejects a cross-origin or non-form POST before consuming the token", async () => {
    const tokenHash = "c".repeat(64);
    const crossOrigin = await POST(postRequest(tokenHash, "invite", undefined, {
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    }));
    const json = new NextRequest("https://yova.example/auth/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://yova.example" },
      body: JSON.stringify({ token_hash: tokenHash, type: "invite" }),
    });
    const nonForm = await POST(json);

    expect(crossOrigin.headers.get("location")).toBe("https://yova.example/?auth=invalid-link");
    expect(nonForm.headers.get("location")).toBe("https://yova.example/?auth=invalid-link");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects a browser POST with an opaque origin before consuming the token", async () => {
    const response = await POST(postRequest("c".repeat(64), "signup", undefined, {
      Origin: "null",
      "Sec-Fetch-Site": "same-origin",
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://yova.example/?auth=invalid-link");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("fails closed when Supabase rejects an expired or reused token", async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { code: "otp_expired", status: 403 },
    });

    const response = await POST(postRequest("d".repeat(64), "invite"));

    expect(response.headers.get("location")).toBe("https://yova.example/?auth=failed");
    expect(mocks.ledgerUpdate).not.toHaveBeenCalled();
  });
});

function getRequest(tokenHash: string, type: string, origin = "https://yova.example") {
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  return new NextRequest(url);
}

function postRequest(
  tokenHash: string,
  type: "invite" | "email" | "signup" | "recovery",
  untrustedQueryOrigin?: string,
  headers: Record<string, string> = {},
) {
  const url = new URL("/auth/confirm", "https://yova.example");
  if (untrustedQueryOrigin) url.searchParams.set("next", untrustedQueryOrigin);
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://yova.example",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: new URLSearchParams({ token_hash: tokenHash, type }),
  });
}
