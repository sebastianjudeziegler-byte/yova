import { describe, expect, it } from "vitest";
import type { LearningPlanSession, SessionCompletion } from "@/lib/domain";
import { buildPostSessionDecision } from "@/lib/personalization/post-session-decision";
import { buildPostSessionPersonalizationReceipt } from "@/lib/personalization/post-session-personalization-receipt";
import { adaptLegacySessionToStudyRoute } from "@/lib/study-route/adapters";

const PLAN_ID = "10000000-0000-4000-8000-000000000001";
const SESSION_ID = "10000000-0000-4000-8000-000000000002";
const NEXT_SESSION_ID = "10000000-0000-4000-8000-000000000003";

const baseSession: LearningPlanSession = {
  id: SESSION_ID,
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

const nextSession: LearningPlanSession = {
  ...baseSession,
  id: NEXT_SESSION_ID,
  sequence: 2,
  title: "Apply cellular respiration",
  objective: "Use the stages in a new case.",
  status: "upcoming",
};

function routedSession(): LearningPlanSession {
  const route = adaptLegacySessionToStudyRoute({
    plan: {
      id: PLAN_ID,
      learningItemId: "10000000-0000-4000-8000-000000000004",
      title: "Biology",
      topic: "Cellular respiration",
      kind: "topic",
      deadline: null,
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "learn",
      rationale: "Prepare for an assessment.",
      createdAt: "2026-08-30T12:00:00.000Z",
      sessions: [baseSession],
    },
    session: baseSession,
  }).route;
  if (!route) throw new Error("Expected a legacy route adapter result.");
  return {
    ...baseSession,
    studyRoute: {
      ...route,
      explanation: {
        ...route.explanation,
        learnerDeclarations: ["You prefer a supported start for unfamiliar material."],
        observations: [],
        uncertainties: ["There is not enough comparable evidence to prefer one valid method."],
      },
    },
  };
}

function completion(
  session: LearningPlanSession,
  overrides: Partial<SessionCompletion> = {},
): SessionCompletion {
  return {
    id: "10000000-0000-4000-8000-000000000005",
    planId: PLAN_ID,
    planSessionId: session.id,
    routeRevisionId: session.studyRoute?.identity.routeRevisionId,
    startedAt: "2026-08-30T16:00:00.000Z",
    completedAt: "2026-08-30T16:24:00.000Z",
    plannedMinutes: 25,
    actualMinutes: 24,
    correctAnswers: 2,
    totalAnswers: 3,
    feedback: "too_difficult",
    observedGap: "electron transport chain",
    completionMode: "guided",
    conceptEvidence: [
      { concept: "Glycolysis", outcome: "secure", activityType: "free_response" },
      { concept: "Electron transport chain", outcome: "needs_review", activityType: "free_response" },
    ],
    confidenceEvidence: [],
    ...overrides,
  };
}

describe("buildPostSessionPersonalizationReceipt", () => {
  it("separates declarations, observations, the deterministic next rule, and uncertainty", () => {
    const session = routedSession();
    const result = completion(session);
    const decision = buildPostSessionDecision(session, nextSession, result);
    const receipt = buildPostSessionPersonalizationReceipt({
      session,
      completion: result,
      decision,
      adaptationAgencyMode: "help_me_choose",
    });

    expect(receipt.routeBasis).toBe("matched");
    expect(receipt.routeRevisionId).toBe(session.studyRoute?.identity.routeRevisionId);
    expect(receipt.youSaid.map((item) => item.text)).toEqual([
      "You prefer a supported start for unfamiliar material.",
      "Challenge felt: Too difficult.",
    ]);
    expect(receipt.yovaSaw.map((item) => item.text)).toEqual([
      "Recorded checks: 2 of 3 correct.",
      "Showing strength in this session: Glycolysis.",
      "Needs another check: Electron transport chain.",
    ]);
    expect(receipt.nextChange[0]).toMatchObject({
      text: "Proposed, awaiting your confirmation: Adjust how the next session begins.",
      evidenceRef: expect.stringContaining("decision:adapt_next_session"),
    });
    expect(receipt.notSureYet.map((item) => item.text)).toContain(
      "There is not enough comparable evidence to prefer one valid method.",
    );
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.youSaid[0])).toBe(true);
  });

  it("states the exact YOVA Decides and I'll Customize dispositions", () => {
    const session = routedSession();
    const result = completion(session);
    const decision = buildPostSessionDecision(session, nextSession, result);

    const automatic = buildPostSessionPersonalizationReceipt({
      session,
      completion: result,
      decision,
      adaptationAgencyMode: "yova_decides",
    });
    expect(automatic.nextChange[0]?.text).toBe(
      "Applies when you finish: Adjust how the next session begins.",
    );

    const customized = buildPostSessionPersonalizationReceipt({
      session,
      completion: result,
      decision,
      adaptationAgencyMode: "ill_customize",
    });
    expect(customized.nextChange[0]?.text).toBe(
      "Recommendation only: Adjust how the next session begins. Your selected route stays in place unless you choose this change.",
    );
  });

  it("does not turn self-reviewed practice into observed knowledge or a method change", () => {
    const session = routedSession();
    const result = completion(session, {
      routeRevisionId: session.studyRoute?.identity.routeRevisionId,
      correctAnswers: 0,
      totalAnswers: 0,
      completionMode: "unguided_practice",
      observedGap: "Unguided practice completed; no topic evidence was recorded.",
      conceptEvidence: [],
    });
    const receipt = buildPostSessionPersonalizationReceipt({
      session,
      completion: result,
      decision: null,
    });

    expect(receipt.yovaSaw).toEqual([expect.objectContaining({
      text: "This session was self-reviewed, so YOVA recorded no checked knowledge evidence.",
    })]);
    expect(receipt.nextChange).toEqual([expect.objectContaining({
      text: "No knowledge-based personalization change is made from ungraded practice.",
    })]);
    expect(receipt.notSureYet.map((item) => item.text)).toContain(
      "Knowledge after this ungraded practice remains unverified.",
    );
  });

  it("refuses to attribute declarations from a different route revision", () => {
    const session = routedSession();
    const result = completion(session, {
      routeRevisionId: "10000000-0000-4000-8000-000000000099",
    });
    const receipt = buildPostSessionPersonalizationReceipt({
      session,
      completion: result,
      decision: null,
    });

    expect(receipt.routeBasis).toBe("mismatch");
    expect(receipt.youSaid.map((item) => item.text)).toEqual([
      "Challenge felt: Too difficult.",
    ]);
    expect(receipt.notSureYet[0]?.text).toBe(
      "The executed route revision does not match the current saved recipe.",
    );
  });

  it("uses an explicit no-evidence boundary when semantic evaluation was unavailable", () => {
    const session = routedSession();
    const result = completion(session, {
      correctAnswers: 0,
      totalAnswers: 0,
      observedGap: "No scorable evaluator result was available.",
      conceptEvidence: [],
      confidenceEvidence: [],
    });
    const receipt = buildPostSessionPersonalizationReceipt({
      session,
      completion: result,
      decision: null,
    });

    expect(receipt.yovaSaw[0]?.text).toBe(
      "No scorable knowledge check was recorded, so YOVA added no knowledge evidence.",
    );
    expect(receipt.yovaSaw[0]?.evidenceRef).toContain("no_scorable_evidence");
  });
});
