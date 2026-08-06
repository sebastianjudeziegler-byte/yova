import { describe, expect, it } from "vitest";

import {
  isCompleteEmailVerificationCode,
  normalizeEmailVerificationCode,
} from "@/lib/auth/verification-code";

describe("email verification codes", () => {
  it("keeps only the first six digits", () => {
    expect(normalizeEmailVerificationCode("12 34-5678")).toBe("123456");
  });

  it("recognizes a complete six-digit code", () => {
    expect(isCompleteEmailVerificationCode("123456")).toBe(true);
    expect(isCompleteEmailVerificationCode("12345")).toBe(false);
    expect(isCompleteEmailVerificationCode("12345a")).toBe(false);
  });
});
