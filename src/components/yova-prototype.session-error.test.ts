import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  formatGuidedSessionAllowanceReset,
  guidedSessionAllowanceFallbackNotice,
  guidedSessionAllowanceResetAtFromHeaders,
  SessionGenerationRecovery,
} from "@/components/yova-prototype";
import {
  buildGuidedSessionFailureState,
  classifyGuidedSessionGenerationFailure,
} from "@/lib/session-generation/failure-state";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { buildFallbackMethodBriefing } from "@/lib/learning/fallback-method-briefing";

vi.mock("@/components/brand-mark", () => ({ BrandMark: () => null }));

const handlers = {
  onExit: vi.fn(),
  onOpenGoal: vi.fn(),
  onStartMethod: vi.fn(),
  onRetry: vi.fn(),
  onReviewSetup: vi.fn(),
};

function renderRecovery({
  response,
  body,
  fallbackOutcome = "unavailable" as const,
  now = Date.UTC(2026, 7, 19, 12, 0, 0),
}: {
  response: { status: number; headers: Headers } | null;
  body: unknown;
  fallbackOutcome?: "unavailable" | "time_fit_rejected" | "coverage_rejected";
  now?: number;
}) {
  const failureState = buildGuidedSessionFailureState({
    cause: classifyGuidedSessionGenerationFailure({ response, body, now }),
    fallbackOutcome,
  });
  return renderToStaticMarkup(createElement(SessionGenerationRecovery, {
    plan: null,
    session: null,
    briefing: null,
    coverage: null,
    failureState,
    issue: "Reference: request-id.",
    canStartMethod: false,
    ...handlers,
  }));
}

describe("SessionGenerationRecovery", () => {
  it("names a quality-check failure and removes the deterministic retry loop", () => {
    const html = renderRecovery({
      response: { status: 502, headers: new Headers() },
      body: {
        code: "guided_session_quality_checks_failed",
        error: "The lesson did not pass YOVA's learning checks.",
        retryable: false,
      },
    });

    expect(html).toContain("LESSON QUALITY CHECK");
    expect(html).toContain("did not pass YOVA&#x27;s quality checks");
    expect(html).not.toContain("Try preparing the guided lesson again");
    expect(html).toContain("Review session setup");
    expect(html).toContain("Open the goal");
  });

  it("retains retry for a transient failure alongside non-retry recovery", () => {
    const html = renderRecovery({
      response: { status: 503, headers: new Headers() },
      body: { error: "The provider could not answer." },
    });

    expect(html).toContain("GUIDED LESSON TEMPORARILY UNAVAILABLE");
    expect(html).toContain("YOVA could not reach the guided-lesson service");
    expect(html).toContain("could not build an offline lesson for this session configuration");
    expect(html).toContain("Try preparing the guided lesson again");
    expect(html).toContain("Review session setup");
    expect(html).toContain("Open the goal");
  });

  it("renders a distinct allowance state with the server-derived reset and no retry", () => {
    const resetAt = "2026-08-19T13:00:00.000Z";
    const html = renderRecovery({
      response: {
        status: 429,
        headers: new Headers({ "Retry-After": "3600" }),
      },
      body: {
        code: "guided_session_allowance_exhausted",
        retryable: false,
      },
    });

    expect(formatGuidedSessionAllowanceReset(resetAt)).toContain("2026");
    expect(html).toContain("session-quota-state");
    expect(html).toContain("GUIDED SESSION ALLOWANCE USED");
    expect(html).toContain(`dateTime="${resetAt}"`);
    expect(html).not.toContain("LESSON SERVICE INTERRUPTED");
    expect(html).not.toContain("Try preparing the guided lesson again");
  });

  it("stays allowance-specific when Retry-After is absent", () => {
    const html = renderRecovery({
      response: { status: 429, headers: new Headers() },
      body: { code: "guided_session_allowance_exhausted" },
    });

    expect(html).toContain("GUIDED SESSION ALLOWANCE USED");
    expect(html).toContain("did not provide a readable reset time");
    expect(html).not.toContain("LESSON SERVICE INTERRUPTED");
  });

  it("names a time-fit rejection precisely", () => {
    const html = renderRecovery({
      response: { status: 503, headers: new Headers() },
      body: { error: "The provider could not answer." },
      fallbackOutcome: "time_fit_rejected",
    });

    expect(html).toContain("YOVA could not reach the guided-lesson service");
    expect(html).toContain("offline lesson needs more time than this session allows");
    expect(html).toContain("Review session setup");
  });

  it("does not hand an inside-YOVA beginner an unsupported method workpad", () => {
    const session: LearningPlanSession = {
      id: "session-1",
      sequence: 1,
      title: "Build the first mental model",
      objective: "Explain an unfamiliar relationship accurately.",
      method: "Self-explanation",
      methodReason: "A complete model must come before unsupported practice.",
      scheduledFor: "2026-08-19T18:00:00.000Z",
      estimatedMinutes: 15,
      amountLabel: "One model and explanation",
      learningMode: "learn",
      contentTargets: ["The unfamiliar relationship"],
      completionEvidence: ["Explain the relationship without hidden support"],
      status: "ready",
    };
    const plan: LearningPlan = {
      id: "plan-1",
      learningItemId: "item-1",
      title: "An unfamiliar topic",
      topic: "An unfamiliar topic",
      kind: "topic",
      deadline: null,
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "learn",
      rationale: "Build a first model inside YOVA.",
      createdAt: "2026-08-19T17:00:00.000Z",
      sessions: [session],
    };
    const failureState = buildGuidedSessionFailureState({
      cause: classifyGuidedSessionGenerationFailure({
        response: { status: 502, headers: new Headers() },
        body: { code: "guided_session_quality_checks_failed", retryable: false },
      }),
      fallbackOutcome: "unavailable",
    });
    const html = renderToStaticMarkup(createElement(SessionGenerationRecovery, {
      plan,
      session,
      briefing: buildFallbackMethodBriefing(plan, session),
      coverage: null,
      failureState,
      issue: null,
      canStartMethod: false,
      ...handlers,
    }));

    expect(html).toContain("This teaching-first session still needs an initial subject explanation");
    expect(html).not.toContain("METHOD WORKPAD");
    expect(html).not.toContain("Use the study method");
    expect(html).toContain("Review session setup");
  });
});

describe("guided-session allowance fallback copy", () => {
  const now = Date.UTC(2026, 7, 19, 12, 0, 0);

  it("recognizes the lesson fallback header and preserves an unreadable reset", () => {
    expect(guidedSessionAllowanceResetAtFromHeaders(new Headers({
      "X-Yova-Fallback-Reason": "guided_session_allowance_exhausted",
      "Retry-After": "900",
    }), now)).toBe("2026-08-19T12:15:00.000Z");
    expect(guidedSessionAllowanceResetAtFromHeaders(new Headers({
      "X-Yova-Fallback-Reason": "guided_session_allowance_exhausted",
      "Retry-After": "invalid",
    }), now)).toBeNull();
    expect(guidedSessionAllowanceResetAtFromHeaders(new Headers({
      "Retry-After": "900",
    }), now)).toBeUndefined();

    const notice = guidedSessionAllowanceFallbackNotice(
      "2026-08-19T12:15:00.000Z",
      "A safe built-in explanation was loaded instead",
    );
    expect(notice).toContain("2026");
    expect(notice).toContain("safe built-in explanation");
    expect(notice).not.toMatch(/service interrupted|try again/i);
  });
});
