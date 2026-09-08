import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

const expectedPrivateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
};

describe("founder PII privacy hardening", () => {
  it("applies private headers to founder pages and APIs after the global rule", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const globalIndex = rules.findIndex((rule) => rule.source === "/:path*");

    expect(globalIndex).toBeGreaterThanOrEqual(0);
    for (const source of ["/founder/:path*", "/api/founder/:path*"]) {
      const ruleIndex = rules.findIndex((rule) => rule.source === source);
      const rule = rules[ruleIndex];

      expect(rule, `${source} header rule`).toBeDefined();
      expect(ruleIndex).toBeGreaterThan(globalIndex);
      expect(headerRecord(rule?.headers ?? [])).toMatchObject(expectedPrivateHeaders);
    }
  });

  it("discloses limited operational review of individual records", () => {
    const privacyNotice = readFileSync(
      resolve(process.cwd(), "src/app/privacy/page.tsx"),
      "utf8",
    );

    expect(privacyNotice).toContain(
      "A limited authorized YOVA operator may review individual lead and account records when needed for support, invitations, email delivery, and launch operations.",
    );
  });
});

function headerRecord(headers: readonly { key: string; value: string }[]) {
  return Object.fromEntries(
    headers.map(({ key, value }) => [key.toLowerCase(), value]),
  );
}
