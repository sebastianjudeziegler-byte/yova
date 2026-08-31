import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

const expectedPrivateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
};

describe("private Study Profile route headers", () => {
  it("keeps the assessment document from referring its replaced private URL", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const rule = rules.find((candidate) => candidate.source === "/study-profile");

    expect(rule).toBeDefined();
    expect(headerRecord(rule?.headers ?? []))
      .toMatchObject({ "referrer-policy": "no-referrer" });
  });

  it("applies privacy headers to report and confirmation routes", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();

    for (const source of [
      "/study-profile/report/:token",
      "/api/study-profile/reports/:token",
      "/api/study-profile/interest/:token",
      "/study-profile/waitlist/confirm",
      "/api/study-profile/waitlist/confirm",
    ]) {
      const rule = rules.find((candidate) => candidate.source === source);
      expect(rule, `${source} header rule`).toBeDefined();
      expect(headerRecord(rule?.headers ?? [])).toMatchObject(expectedPrivateHeaders);
    }
  });

  it("keeps scoped overrides after the global security-header rule", async () => {
    const rules = await nextConfig.headers!();
    const globalIndex = rules.findIndex((rule) => rule.source === "/:path*");

    expect(globalIndex).toBeGreaterThanOrEqual(0);
    expect(rules.findIndex((rule) => rule.source === "/study-profile"))
      .toBeGreaterThan(globalIndex);
    expect(rules.findIndex((rule) => rule.source === "/study-profile/report/:token"))
      .toBeGreaterThan(globalIndex);
    expect(rules.findIndex((rule) => rule.source === "/api/study-profile/reports/:token"))
      .toBeGreaterThan(globalIndex);
    expect(rules.findIndex((rule) => rule.source === "/api/study-profile/interest/:token"))
      .toBeGreaterThan(globalIndex);
    expect(rules.findIndex((rule) => rule.source === "/study-profile/waitlist/confirm"))
      .toBeGreaterThan(globalIndex);
    expect(rules.findIndex((rule) => rule.source === "/api/study-profile/waitlist/confirm"))
      .toBeGreaterThan(globalIndex);
  });
});

function headerRecord(headers: readonly { key: string; value: string }[]) {
  return Object.fromEntries(
    headers.map(({ key, value }) => [key.toLowerCase(), value]),
  );
}
