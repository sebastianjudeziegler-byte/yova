import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  GuidedSessionAllowanceNotice,
  guidedSessionAllowanceBlocksNewStart,
  guidedSessionStartLabel,
} from "@/components/guided-session-allowance-notice";

describe("GuidedSessionAllowanceNotice", () => {
  it("shows the durable remaining count while new sessions are available", () => {
    const allowance = {
      kind: "available" as const,
      remainingToday: 3,
      retryAfterSeconds: 0 as const,
      resetAt: null,
    };
    const html = renderToStaticMarkup(createElement(GuidedSessionAllowanceNotice, {
      allowance,
      surface: "home",
    }));

    expect(html).toContain("3 guided sessions available today");
    expect(guidedSessionAllowanceBlocksNewStart(allowance)).toBe(false);
    expect(guidedSessionStartLabel(allowance, "Start session")).toBe("Start session");
  });

  it("uses the exact server reset and blocks only a new session when the day is spent", () => {
    const allowance = {
      kind: "exhausted" as const,
      remainingToday: 0 as const,
      retryAfterSeconds: 7_200,
      resetAt: "2026-08-20T00:00:00.000Z",
    };
    const html = renderToStaticMarkup(createElement(GuidedSessionAllowanceNotice, {
      allowance,
      surface: "agenda",
    }));

    expect(html).toContain("Daily guided-session allowance used");
    expect(html).toContain('dateTime="2026-08-20T00:00:00.000Z"');
    expect(html).toContain("continue a session that was already saved");
    expect(guidedSessionAllowanceBlocksNewStart(allowance)).toBe(true);
    expect(guidedSessionAllowanceBlocksNewStart(allowance, true)).toBe(false);
    expect(guidedSessionStartLabel(allowance, "Start")).toBe("Allowance used today");
    expect(guidedSessionStartLabel(allowance, "Continue", true)).toBe("Continue");
  });

  it("distinguishes a short server pause from daily exhaustion", () => {
    const allowance = {
      kind: "temporarily_limited" as const,
      remainingToday: 4,
      retryAfterSeconds: 30,
      resetAt: "2026-08-19T20:01:00.000Z",
    };
    const html = renderToStaticMarkup(createElement(GuidedSessionAllowanceNotice, {
      allowance,
      surface: "home",
    }));

    expect(html).toContain("briefly paused");
    expect(html).toContain("4 guided sessions remain today");
    expect(html).not.toContain("allowance used");
    expect(guidedSessionAllowanceBlocksNewStart(allowance)).toBe(true);
  });

  it("blocks only new work while the initial server preflight is pending", () => {
    const allowance = {
      kind: "unavailable" as const,
      remainingToday: null,
      retryAfterSeconds: null,
      resetAt: null,
    };
    const html = renderToStaticMarkup(createElement(GuidedSessionAllowanceNotice, {
      allowance,
      surface: "home",
      checking: true,
    }));

    expect(html).toContain("Checking today&#x27;s guided-session allowance");
    expect(guidedSessionAllowanceBlocksNewStart(allowance, false, true)).toBe(true);
    expect(guidedSessionAllowanceBlocksNewStart(allowance, true, true)).toBe(false);
    expect(guidedSessionStartLabel(allowance, "Start", false, true)).toBe("Checking allowance…");
  });
});
