import { describe, expect, it } from "vitest";
import { sanitizeProductErrorRoutePath } from "@/lib/monitoring/route-privacy";

describe("sanitizeProductErrorRoutePath", () => {
  it("redacts a Study Profile report bearer token", () => {
    const token = "private_report_token_abcdefghijklmnopqrstuvwxyz0123456789";

    const routePath = sanitizeProductErrorRoutePath(
      `/study-profile/report/${token}`,
    );

    expect(routePath).toBe("/study-profile/report/private");
    expect(routePath).not.toContain(token);
  });

  it("redacts malformed report path values instead of trying to validate a secret", () => {
    expect(sanitizeProductErrorRoutePath("/study-profile/report/short"))
      .toBe("/study-profile/report/private");
  });

  it("preserves ordinary product route paths", () => {
    expect(sanitizeProductErrorRoutePath("/agenda"))
      .toBe("/agenda");
    expect(sanitizeProductErrorRoutePath("/study-profile"))
      .toBe("/study-profile");
  });
});
