import { describe, expect, it } from "vitest";
import type {
  LearningPlan,
  LearningPlanSession,
  SessionCompletion,
} from "@/lib/domain";
import { buildConceptReviewAgenda } from "@/lib/learning/concept-review-agenda";
import { completePlanSession } from "@/lib/learning/complete-plan-session";
import {
  approvedPostSessionChanges,
  buildPostSessionDecision,
} from "@/lib/personalization/post-session-decision";

function plannedSession(
  sequence: number,
  title: string,
  target: string,
  status: LearningPlanSession["status"],
): LearningPlanSession {
  return {
    id: `session-${sequence}`,
    sequence,
    title,
    objective: `Understand and use ${target}.`,
    method: sequence < 3 ? "Guided explanation and self-explanation" : "Mixed retrieval and transfer",
    methodReason: sequence < 3
      ? "Build the model before reducing support."
      : "Retrieve and transfer the connected model.",
    scheduledFor: `2026-08-${String(8 + sequence).padStart(2, "0")}T18:00:00.000Z`,
    estimatedMinutes: 25,
    amountLabel: "One focused target and evidence check · about 25 min",
    learningMode: sequence < 3 ? "learn" : "study",
    contentTargets: [target],
    completionEvidence: [`Explain and apply ${target}.`],
    status,
  };
}

function journeyPlan(): LearningPlan {
  return {
    id: "plan-ww1",
    learningItemId: "item-ww1",
    title: "World War I foundations",
    topic: "World War I",
    kind: "test",
    deadline: "2026-08-20T18:00:00.000Z",
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Build the causal model before retrieval and transfer.",
    createdAt: "2026-08-08T18:00:00.000Z",
    sessions: [
      plannedSession(1, "Trace the road to war", "the alliance and mobilization chain", "ready"),
      plannedSession(2, "Connect stalemate and total war", "trench warfare and total mobilization", "upcoming"),
      plannedSession(3, "Explain causes, change, and consequences", "causal comparison across the war", "upcoming"),
    ],
  };
}

function completion(
  session: LearningPlanSession,
  overrides: Partial<SessionCompletion> = {},
): SessionCompletion {
  return {
    id: `completion-${session.sequence}`,
    planId: "plan-ww1",
    planSessionId: session.id,
    startedAt: `2026-08-${String(8 + session.sequence).padStart(2, "0")}T18:00:00.000Z`,
    completedAt: `2026-08-${String(8 + session.sequence).padStart(2, "0")}T18:25:00.000Z`,
    plannedMinutes: 25,
    actualMinutes: 25,
    correctAnswers: 1,
    totalAnswers: 3,
    feedback: "too_difficult",
    observedGap: session.contentTargets?.[0] ?? session.objective,
    conceptEvidence: [{
      concept: session.contentTargets?.[0] ?? session.objective,
      outcome: "needs_review",
      activityType: "free_response",
    }],
    confidenceEvidence: [],
    ...overrides,
  };
}

function applyApprovedDecision(
  plan: LearningPlan,
  completedSession: LearningPlanSession,
  result: SessionCompletion,
) {
  const nextSession = plan.sessions.find((session) => session.sequence === completedSession.sequence + 1) ?? null;
  const changes = approvedPostSessionChanges(
    buildPostSessionDecision(completedSession, nextSession, result),
    true,
  );
  return completePlanSession({
    plan,
    completedSessionId: completedSession.id,
    completedAt: result.completedAt,
    adaptation: changes.adaptation,
    followUpSession: changes.followUpSession,
  });
}

describe("adversarial adaptive plan journeys", () => {
  it("preserves every curriculum target through repeated misses across sessions", () => {
    const initial = journeyPlan();
    const originalTargets = initial.sessions.map((session) => ({
      title: session.title,
      objective: session.objective,
      contentTargets: session.contentTargets,
      completionEvidence: session.completionEvidence,
    }));

    const afterFirstMiss = applyApprovedDecision(initial, initial.sessions[0]!, completion(initial.sessions[0]!));
    const second = afterFirstMiss.sessions[1]!;
    const afterSecondMiss = applyApprovedDecision(afterFirstMiss, second, completion(second));

    expect(afterFirstMiss.sessions[1]).toMatchObject({
      title: originalTargets[1]?.title,
      objective: originalTargets[1]?.objective,
      contentTargets: originalTargets[1]?.contentTargets,
      learningMode: "learn",
      status: "ready",
    });
    expect(afterSecondMiss.sessions[2]).toMatchObject({
      title: originalTargets[2]?.title,
      objective: originalTargets[2]?.objective,
      contentTargets: originalTargets[2]?.contentTargets,
      status: "ready",
    });
    expect(afterSecondMiss.sessions.map((session) => ({
      title: session.title,
      objective: session.objective,
      contentTargets: session.contentTargets,
      completionEvidence: session.completionEvidence,
    }))).toEqual(originalTargets);
    expect(afterSecondMiss.sessions.map((session) => session.status)).toEqual([
      "complete",
      "complete",
      "ready",
    ]);
  });

  it("changes challenge after work is too easy while retaining the planned target", () => {
    const initial = journeyPlan();
    const current = initial.sessions[0]!;
    const next = initial.sessions[1]!;
    const strongResult = completion(current, {
      correctAnswers: 3,
      totalAnswers: 3,
      feedback: "too_easy",
      observedGap: "No major gap was detected",
      conceptEvidence: [{
        concept: current.contentTargets![0]!,
        outcome: "secure",
        activityType: "free_response",
      }],
    });

    const updated = applyApprovedDecision(initial, current, strongResult);

    expect(updated.sessions[1]).toMatchObject({
      title: next.title,
      objective: next.objective,
      contentTargets: next.contentTargets,
      method: "Independent application and mixed practice",
      learningMode: "study",
    });
  });

  it("honors a declined plan change while still preserving missed evidence for review", () => {
    const initial = journeyPlan();
    const current = initial.sessions[0]!;
    const next = initial.sessions[1]!;
    const result = completion(current);
    const decision = buildPostSessionDecision(current, next, result);
    const declined = approvedPostSessionChanges(decision, false);
    const updated = completePlanSession({
      plan: initial,
      completedSessionId: current.id,
      completedAt: result.completedAt,
      adaptation: declined.adaptation,
      followUpSession: declined.followUpSession,
    });
    const reviewAgenda = buildConceptReviewAgenda(
      [updated],
      [result],
      new Date("2026-08-10T19:00:00.000Z"),
    );

    expect(updated.sessions[1]).toMatchObject({
      title: next.title,
      method: next.method,
      learningMode: next.learningMode,
      status: "ready",
    });
    expect(reviewAgenda[0]).toMatchObject({
      concept: current.contentTargets![0],
      timing: "due",
      action: "start_next_session",
    });
  });

  it("adds a bounded delayed check after a final miss instead of falsely completing the goal", () => {
    const initial = journeyPlan();
    const prepared = {
      ...initial,
      sessions: initial.sessions.map((session, index) => ({
        ...session,
        status: index < 2 ? "complete" as const : "ready" as const,
      })),
    };
    const finalSession = prepared.sessions[2]!;
    const updated = applyApprovedDecision(prepared, finalSession, completion(finalSession));

    expect(updated.status).toBe("active");
    expect(updated.sessions).toHaveLength(4);
    expect(updated.sessions[3]).toMatchObject({
      sequence: 4,
      estimatedMinutes: 10,
      learningMode: "study",
      status: "ready",
      reviewConcept: finalSession.contentTargets![0],
    });
  });
});
