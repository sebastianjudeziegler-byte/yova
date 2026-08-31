import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LearningPlanSession, SessionCompletion } from "@/lib/domain";
import { PostSessionPersonalizationReceipt } from "@/components/post-session-personalization-receipt";

const session: LearningPlanSession = {
  id: "10000000-0000-4000-8000-000000000002",
  sequence: 1,
  title: "Explain cellular respiration",
  objective: "Explain how the stages connect.",
  method: "Feynman Technique",
  methodReason: "Build and test a connected explanation.",
  scheduledFor: "2026-08-30T16:00:00.000Z",
  estimatedMinutes: 25,
  amountLabel: "One explanation and check · about 25 min",
  learningMode: "learn",
  status: "ready",
};

const completion: SessionCompletion = {
  id: "10000000-0000-4000-8000-000000000005",
  planId: "10000000-0000-4000-8000-000000000001",
  planSessionId: session.id,
  startedAt: "2026-08-30T16:00:00.000Z",
  completedAt: "2026-08-30T16:24:00.000Z",
  plannedMinutes: 25,
  actualMinutes: 24,
  correctAnswers: 3,
  totalAnswers: 3,
  feedback: "about_right",
  observedGap: "No major gap detected.",
  completionMode: "guided",
  conceptEvidence: [{
    concept: "Glycolysis",
    outcome: "secure",
    activityType: "free_response",
  }],
  confidenceEvidence: [],
};

describe("PostSessionPersonalizationReceipt", () => {
  it("renders the four required receipt sections without claiming a route revision", () => {
    const html = renderToStaticMarkup(createElement(PostSessionPersonalizationReceipt, {
      session,
      completion,
      decision: null,
    }));

    expect(html).toContain("You said");
    expect(html).toContain("YOVA saw");
    expect(html).toContain("Next change");
    expect(html).toContain("Not sure yet");
    expect(html).toContain("Challenge felt: About right.");
    expect(html).toContain("Recorded checks: 3 of 3 correct.");
    expect(html).toContain("Legacy session · no saved route revision");
    expect(html).not.toContain("works best for you");
  });
});
