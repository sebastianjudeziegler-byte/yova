import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { emptyOnboardingAnswers } from "@/lib/onboarding/answers";
import { routeSession } from "@/lib/routing/session-route";
import { PreSessionCard, type PreSessionCardProps } from "./pre-session-card";

const route = routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: false, topicHasProblems: false, answers: emptyOnboardingAnswers() });
const session = { id: "s1", title: "Glycolysis", estimatedMinutes: 25, topicIds: [] } as unknown as LearningPlanSession;
const plan = { id: "p1", title: "Biology", status: "active", sessions: [session] } as unknown as LearningPlan;

function render(overrides: Partial<PreSessionCardProps>) {
  return renderToStaticMarkup(createElement(PreSessionCard, {
    plan, session, topic: null, insideRoute: route, route, source: null, studyLocation: "inside", canStudyOutside: true, revisionClient: null,
    allowance: { kind: "available", remainingToday: 3, retryAfterSeconds: 0, resetAt: null }, allowanceChecking: false,
    onStudyLocationChange: vi.fn(), onChangeProduceStep: vi.fn(), onStart: vi.fn(), onExit: vi.fn(),
    ...overrides,
  }));
}

// Founder decision (16 Sept): the allowance is enforced here, and only here.
describe("pre-session card allowance", () => {
  it("offers Start and shows no allowance or count while sessions are available", () => {
    const html = render({});
    expect(html).toMatch(/>Start/);
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/allowance|remaining|guided sessions|\b3\b/i);
  });

  it("at the limit, shows the limit message instead of Start", () => {
    const html = render({ allowance: { kind: "exhausted", remainingToday: 0, retryAfterSeconds: 7_200, resetAt: "2026-08-20T00:00:00.000Z" } });
    expect(html).toContain("You have used today&#x27;s guided sessions.");
    expect(html).not.toMatch(/>Start/);
  });

  it("holds Start, without a message, while the allowance is first checked", () => {
    const html = render({ allowance: { kind: "unavailable", remainingToday: null, retryAfterSeconds: null, resetAt: null }, allowanceChecking: true });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start/);
    expect(html).not.toMatch(/guided sessions/i);
  });
});
