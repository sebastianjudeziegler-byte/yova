import { describe, expect, it } from "vitest";
import {
  guidedSessionAllowanceStateFromResponse,
  type GuidedSessionAllowanceStatusResponseLike,
} from "@/lib/session-generation/allowance-status";

function response(status: number, headers: Record<string, string> = {}): GuidedSessionAllowanceStatusResponseLike {
  return { status, headers: new Headers(headers) };
}

describe("guided-session allowance preflight state", () => {
  it("preserves available remaining sessions", () => {
    expect(guidedSessionAllowanceStateFromResponse(response(200), {
      status: "available",
      remainingToday: 4,
      retryAfterSeconds: 0,
      resetAt: null,
    })).toEqual({
      kind: "available",
      remainingToday: 4,
      retryAfterSeconds: 0,
      resetAt: null,
    });
  });

  it("uses the server's exact daily reset rather than recreating quota policy", () => {
    expect(guidedSessionAllowanceStateFromResponse(
      response(200, { "Retry-After": "12600" }),
      {
        status: "exhausted",
        remainingToday: 0,
        retryAfterSeconds: 12_600,
        resetAt: "2026-08-20T00:00:00.000Z",
      },
    )).toEqual({
      kind: "exhausted",
      remainingToday: 0,
      retryAfterSeconds: 12_600,
      resetAt: "2026-08-20T00:00:00.000Z",
    });
  });

  it("keeps a minute-window pause distinct from spent daily allowance", () => {
    expect(guidedSessionAllowanceStateFromResponse(response(200), {
      status: "temporarily_limited",
      remainingToday: 7,
      retryAfterSeconds: 18,
      resetAt: "2026-08-19T20:01:00.000Z",
    })).toMatchObject({
      kind: "temporarily_limited",
      remainingToday: 7,
      retryAfterSeconds: 18,
    });
  });

  it("fails open when the status endpoint or payload is unavailable", () => {
    expect(guidedSessionAllowanceStateFromResponse(response(503), { error: "unavailable" })).toEqual({
      kind: "unavailable",
      remainingToday: null,
      retryAfterSeconds: null,
      resetAt: null,
    });
    expect(guidedSessionAllowanceStateFromResponse(response(200), {
      status: "exhausted",
      remainingToday: 3,
      retryAfterSeconds: 60,
      resetAt: "tomorrow",
    })).toEqual({
      kind: "unavailable",
      remainingToday: null,
      retryAfterSeconds: null,
      resetAt: null,
    });
  });
});
