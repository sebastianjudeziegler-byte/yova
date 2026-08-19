import { describe, expect, it } from "vitest";
import { ErrorReportRequestSchema } from "@/lib/monitoring/schema";
import {
  BUILT_IN_FALLBACK_OUTCOMES,
  builtInFallbackOutcome,
  sessionFallbackErrorCode,
} from "@/lib/session-generation/fallback-observation";

describe("built-in fallback outcome observation", () => {
  it.each([
    {
      expected: "unavailable",
      decision: {
        fallbackAvailable: false,
        fitsAvailableTime: false,
        coverageAccepted: false,
      },
    },
    {
      expected: "time_fit_rejected",
      decision: {
        fallbackAvailable: true,
        fitsAvailableTime: false,
        coverageAccepted: false,
      },
    },
    {
      expected: "coverage_rejected",
      decision: {
        fallbackAvailable: true,
        fitsAvailableTime: true,
        coverageAccepted: false,
      },
    },
    {
      expected: "loaded",
      decision: {
        fallbackAvailable: true,
        fitsAvailableTime: true,
        coverageAccepted: true,
      },
    },
  ] as const)("classifies $expected without learner content", ({ decision, expected }) => {
    expect(builtInFallbackOutcome(decision)).toBe(expected);
  });

  it("keeps the outcome vocabulary closed and queryable", () => {
    expect(BUILT_IN_FALLBACK_OUTCOMES).toEqual([
      "loaded",
      "unavailable",
      "time_fit_rejected",
      "coverage_rejected",
    ]);
  });

  it.each([
    [false, true, true, true, "guided_session_generation_failed_fallback_loaded"],
    [true, false, false, false, "guided_session_generation_timeout_fallback_unavailable"],
    [false, true, false, false, "guided_session_generation_failed_fallback_time_fit_rejected"],
    [true, true, true, false, "guided_session_generation_timeout_fallback_coverage_rejected"],
  ] as const)("builds a bounded monitoring code", (
    generationTimedOut,
    fallbackAvailable,
    fitsAvailableTime,
    coverageAccepted,
    expected,
  ) => {
    const errorCode = sessionFallbackErrorCode({
      generationTimedOut,
      fallbackAvailable,
      fitsAvailableTime,
      coverageAccepted,
    });

    expect(errorCode).toBe(expected);
    expect(errorCode).toMatch(/^[a-z0-9_]{3,80}$/);
    expect(ErrorReportRequestSchema.safeParse({
      surface: "session_generation",
      errorCode,
      requestId: "7f764e1d-3758-4eeb-b43e-12a01a19dcf9",
      routePath: "/",
    }).success).toBe(true);
  });
});
