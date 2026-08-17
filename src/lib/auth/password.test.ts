import { describe, expect, it } from "vitest";

import {
  normalizeAuthEmail,
  normalizeDisplayName,
  validateAuthEmail,
  validateDisplayName,
  validatePassword,
} from "@/lib/auth/password";

describe("password account validation", () => {
  it("normalizes email and display name without changing a password", () => {
    expect(normalizeAuthEmail("  Learner@Example.COM ")).toBe("learner@example.com");
    expect(normalizeDisplayName("  Ada   Lovelace  ")).toBe("Ada Lovelace");
  });

  it.each([
    "",
    "missing-at.example.com",
    "two@@example.com",
    "learner@localhost",
    "learner@.example.com",
  ])("rejects invalid email %j", (email) => {
    expect(validateAuthEmail(email)).toBe("Enter a valid email address.");
  });

  it("accepts a normal email and bounded display name", () => {
    expect(validateAuthEmail("learner@example.com")).toBeNull();
    expect(validateDisplayName("Ada")).toBeNull();
    expect(validateDisplayName("   ")).toBe("Enter your first name.");
  });

  it("requires a long password and respects bcrypt's byte boundary", () => {
    expect(validatePassword("too-short")).toBe("Use at least 10 characters.");
    expect(validatePassword("long-enough-password")).toBeNull();
    expect(validatePassword("a".repeat(72))).toBeNull();
    expect(validatePassword("a".repeat(73))).toBe("Use a shorter password (72 bytes or fewer).");
    expect(validatePassword("🙂".repeat(19))).toBe("Use a shorter password (72 bytes or fewer).");
  });
});
