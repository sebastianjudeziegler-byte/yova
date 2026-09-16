import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AllowanceLimitMessage, guidedSessionAllowanceBlocksNewStart } from "@/components/guided-session-allowance-notice";

const visibleText = (html: string) => html.replace(/<[^>]+>/g, " ");

// Brief 1.5 item 8 follow-up (founder, 16 Sept): the allowance is enforced on the
// pre-session card. At the limit the card shows this message instead of Start;
// otherwise nothing about the allowance, and never a count, is shown.
describe("AllowanceLimitMessage", () => {
  it("shows nothing while new sessions are available, and never a count", () => {
    const allowance = { kind: "available" as const, remainingToday: 3, retryAfterSeconds: 0 as const, resetAt: null };
    expect(renderToStaticMarkup(createElement(AllowanceLimitMessage, { allowance }))).toBe("");
    expect(guidedSessionAllowanceBlocksNewStart(allowance)).toBe(false);
  });

  it("names the exact server reset when the day is spent, and blocks only a new session", () => {
    const allowance = { kind: "exhausted" as const, remainingToday: 0 as const, retryAfterSeconds: 7_200, resetAt: "2026-08-20T00:00:00.000Z" };
    const html = renderToStaticMarkup(createElement(AllowanceLimitMessage, { allowance }));
    expect(html).toContain("You have used today&#x27;s guided sessions.");
    expect(html).toContain('dateTime="2026-08-20T00:00:00.000Z"');
    expect(html).toContain("A session you already started can still continue.");
    expect(visibleText(html)).not.toMatch(/\b0\b|remaining/);
    expect(guidedSessionAllowanceBlocksNewStart(allowance)).toBe(true);
    expect(guidedSessionAllowanceBlocksNewStart(allowance, true)).toBe(false);
  });

  it("explains a short server pause without a count", () => {
    const allowance = { kind: "temporarily_limited" as const, remainingToday: 4, retryAfterSeconds: 30, resetAt: "2026-08-19T20:01:00.000Z" };
    const html = renderToStaticMarkup(createElement(AllowanceLimitMessage, { allowance }));
    expect(html).toContain("Too many sessions started in a short time.");
    expect(visibleText(html)).not.toMatch(/\b4\b|remaining/);
    expect(guidedSessionAllowanceBlocksNewStart(allowance)).toBe(true);
  });

  it("shows nothing during the first server check, which still holds Start", () => {
    const allowance = { kind: "unavailable" as const, remainingToday: null, retryAfterSeconds: null, resetAt: null };
    expect(renderToStaticMarkup(createElement(AllowanceLimitMessage, { allowance }))).toBe("");
    expect(guidedSessionAllowanceBlocksNewStart(allowance, false, true)).toBe(true);
  });
});
