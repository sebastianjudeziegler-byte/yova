import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  getUser: vi.fn(),
  readStatus: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createServer }));
vi.mock("@/lib/server/ai-usage", () => ({ readAIUsageStatus: mocks.readStatus }));

import { GET } from "@/app/api/sessions/allowance/route";

describe("guided-session allowance status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      error: null,
    });
    mocks.createServer.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.readStatus.mockResolvedValue({
      allowed: true,
      limitedBy: null,
      remainingToday: 4,
      retryAfterSeconds: 0,
      resetAt: null,
    });
  });

  it("requires an authenticated account and never attempts a usage read while signed out", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await GET();

    expect(result.status).toBe(401);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.readStatus).not.toHaveBeenCalled();
  });

  it("returns the remaining daily allowance without claiming a request", async () => {
    const result = await GET();

    expect(result.status).toBe(200);
    expect(result.headers.get("Retry-After")).toBeNull();
    expect(result.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    await expect(result.json()).resolves.toEqual({
      status: "available",
      remainingToday: 4,
      retryAfterSeconds: 0,
      resetAt: null,
    });
    expect(mocks.readStatus).toHaveBeenCalledWith(expect.anything(), "session_generation");
  });

  it("returns the database-derived reset and matching Retry-After when daily allowance is spent", async () => {
    mocks.readStatus.mockResolvedValue({
      allowed: false,
      limitedBy: "day",
      remainingToday: 0,
      retryAfterSeconds: 12_600,
      resetAt: "2026-08-20T00:00:00.000Z",
    });

    const result = await GET();

    expect(result.status).toBe(200);
    expect(result.headers.get("Retry-After")).toBe("12600");
    await expect(result.json()).resolves.toEqual({
      status: "exhausted",
      remainingToday: 0,
      retryAfterSeconds: 12_600,
      resetAt: "2026-08-20T00:00:00.000Z",
    });
  });

  it("does not describe a short burst limit as a spent daily allowance", async () => {
    mocks.readStatus.mockResolvedValue({
      allowed: false,
      limitedBy: "minute",
      remainingToday: 7,
      retryAfterSeconds: 18,
      resetAt: "2026-08-19T20:01:00.000Z",
    });

    const result = await GET();

    expect(result.status).toBe(200);
    expect(result.headers.get("Retry-After")).toBe("18");
    await expect(result.json()).resolves.toMatchObject({
      status: "temporarily_limited",
      remainingToday: 7,
    });
  });

  it("returns a private structured error when the durable usage read is unavailable", async () => {
    mocks.readStatus.mockRejectedValue(new Error("database unavailable"));

    const result = await GET();

    expect(result.status).toBe(503);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    await expect(result.json()).resolves.toEqual({
      error: "YOVA could not check the guided-session allowance right now.",
    });
  });
});
