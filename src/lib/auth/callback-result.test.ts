import { describe, expect, it } from "vitest";

import { describeAuthCallbackResult } from "@/lib/auth/callback-result";

describe("authentication callback feedback", () => {
  it("explains incomplete or expired links", () => {
    expect(describeAuthCallbackResult("invalid-link")).toContain("incomplete or expired");
  });

  it("explains failed PKCE-style returns without exposing implementation details", () => {
    expect(describeAuthCallbackResult("failed")).toContain("same browser");
  });

  it("explains when a signed-in account was not invited", () => {
    expect(describeAuthCallbackResult("invite-required")).toContain("does not have private-alpha access");
  });

  it("ignores unrelated query values", () => {
    expect(describeAuthCallbackResult(null)).toBeNull();
    expect(describeAuthCallbackResult("anything-else")).toBeNull();
  });
});
