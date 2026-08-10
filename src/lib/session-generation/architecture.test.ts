import { describe, expect, it } from "vitest";
import {
  allowsLegacySessionFallback,
  LEGACY_SESSION_ARCHITECTURE,
  STREAMED_SESSION_ARCHITECTURE,
  readSessionArchitectureVersion,
  usesStreamedTeaching,
} from "@/lib/session-generation/architecture";

describe("session architecture versioning", () => {
  it("treats missing and unknown versions as legacy so existing plans do not change", () => {
    expect(readSessionArchitectureVersion(undefined)).toBe(LEGACY_SESSION_ARCHITECTURE);
    expect(readSessionArchitectureVersion({})).toBe(LEGACY_SESSION_ARCHITECTURE);
    expect(readSessionArchitectureVersion({ sessionArchitectureVersion: "future" })).toBe(LEGACY_SESSION_ARCHITECTURE);
  });

  it("opts in only plans explicitly stamped for streamed teaching", () => {
    const plan = { sessionArchitectureVersion: STREAMED_SESSION_ARCHITECTURE };
    expect(readSessionArchitectureVersion(plan)).toBe(STREAMED_SESSION_ARCHITECTURE);
    expect(usesStreamedTeaching(plan)).toBe(true);
  });

  it("never substitutes a legacy built-in lesson for a streamed plan", () => {
    expect(allowsLegacySessionFallback({ sessionArchitectureVersion: STREAMED_SESSION_ARCHITECTURE })).toBe(false);
    expect(allowsLegacySessionFallback({ sessionArchitectureVersion: LEGACY_SESSION_ARCHITECTURE })).toBe(true);
  });
});
