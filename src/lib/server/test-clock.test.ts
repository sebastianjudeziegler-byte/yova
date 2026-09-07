import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRequestNow, TEST_CLOCK_HEADER } from "@/lib/server/test-clock";

const FIXED = "2026-09-02T10:00:00.000Z";
const FALLBACK = Date.parse("2026-09-07T22:23:00.000Z");

function req(headers: Record<string, string>) {
  return new Request("http://localhost:3000/api/plans/generate", { headers });
}

describe("resolveRequestNow", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the real clock in production even when both preview and clock headers are present", () => {
    vi.stubEnv("NODE_ENV", "production");
    const before = Date.now();
    const now = resolveRequestNow(
      req({ "X-Yova-Development-Preview": "plan-creator", [TEST_CLOCK_HEADER]: FIXED }),
    );
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
    expect(now).not.toBe(Date.parse(FIXED));
  });

  it("honours the test clock for a development-preview request", () => {
    const now = resolveRequestNow(
      req({ "X-Yova-Development-Preview": "plan-creator", [TEST_CLOCK_HEADER]: FIXED }),
      FALLBACK,
      "development",
    );
    expect(now).toBe(Date.parse(FIXED));
  });

  it("ignores the header entirely outside development, even with the preview header", () => {
    for (const env of ["production", "test", undefined] as const) {
      const now = resolveRequestNow(
        req({ "X-Yova-Development-Preview": "plan-creator", [TEST_CLOCK_HEADER]: FIXED }),
        FALLBACK,
        env,
      );
      expect(now).toBe(FALLBACK);
    }
  });

  it("ignores the header when the request is not a preview request", () => {
    const now = resolveRequestNow(req({ [TEST_CLOCK_HEADER]: FIXED }), FALLBACK, "development");
    expect(now).toBe(FALLBACK);
  });

  it("falls back to the real clock on garbage input", () => {
    const now = resolveRequestNow(
      req({ "X-Yova-Development-Preview": "plan-creator", [TEST_CLOCK_HEADER]: "not-a-date" }),
      FALLBACK,
      "development",
    );
    expect(now).toBe(FALLBACK);
  });
});
