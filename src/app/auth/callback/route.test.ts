import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
  }),
}));

import { GET } from "@/app/auth/callback/route";

describe("authentication callback redirect", () => {
  beforeEach(() => {
    mocks.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
  });

  it("returns to an internal YOVA path after exchanging the code", async () => {
    const response = await GET(callbackRequest("/agenda?view=week"));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("valid-code");
    expect(response.headers.get("location")).toBe("https://yova.example/agenda?view=week");
  });

  it("falls back to YOVA root for a backslash-based cross-origin path", async () => {
    const response = await GET(callbackRequest("/\\attacker.example"));

    expect(response.headers.get("location")).toBe("https://yova.example/");
  });

  it.each([
    "https://attacker.example/",
    "//attacker.example/",
  ])("falls back to YOVA root for non-internal destination %s", async (destination) => {
    const response = await GET(callbackRequest(destination));

    expect(response.headers.get("location")).toBe("https://yova.example/");
  });
});

function callbackRequest(next: string) {
  const url = new URL("https://yova.example/auth/callback");
  url.searchParams.set("code", "valid-code");
  url.searchParams.set("next", next);
  return new NextRequest(url);
}
