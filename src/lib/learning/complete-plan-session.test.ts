import { describe, expect, it } from "vitest";
import type {
  LearningPlan,
  LearningPlanSession,
  NextSessionAdaptation,
} from "@/lib/domain";
import { completePlanSession } from "@/lib/learning/complete-plan-session";

function session(
  sequence: number,
  status: LearningPlanSession["status"],
  overrides: Partial<LearningPlanSession> = {},
): LearningPlanSession {
  return {
    id: `session-${sequence}`,
    sequence,
    title: `Target ${sequence}`,
    objective: `Learn the planned concept ${sequence}.`,
    method: sequence === 1 ? "Guided explanation" : "Retrieval practice",
    methodReason: "This method matches the planned target.",
    scheduledFor: `2026-08-${String(8 + sequence).padStart(2, "0")}T18:00:00.000Z`,
    estimatedMinutes: 25,
    amountLabel: "One bounded target · about 25 min",
    learningMode: sequence === 1 ? "learn" : "study",
    contentTargets: [`Concept ${sequence}`],
    completionEvidence: [`Explain concept ${sequence}`],
    status,
    ...overrides,
  };
}

function plan(sessions: LearningPlanSession[]): LearningPlan {
  return {
    id: "plan-1",
    learningItemId: "item-1",
    title: "World War I foundations",
    topic: "World War I",
    kind: "test",
    deadline: "2026-08-20T18:00:00.000Z",
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Teach the sequence before retrieval and transfer.",
    createdAt: "2026-08-08T18:00:00.000Z",
    sessions,
  };
}

function adaptation(next: LearningPlanSession): NextSessionAdaptation {
  return {
    planSessionId: next.id,
    title: next.title,
    objective: next.objective,
    method: "Guided repair, then retrieval practice",
    methodReason: "Repair one missed prerequisite, then continue the planned target.",
    estimatedMinutes: next.estimatedMinutes,
    amountLabel: "Repair + planned target · about 25 min",
    learningMode: "learn",
    explanation: "YOVA restored support after a meaningful gap while preserving the curriculum.",
  };
}

describe("completePlanSession", () => {
  it("completes the current session and makes the next planned target ready", () => {
    const original = plan([
      session(1, "ready"),
      session(2, "upcoming"),
      session(3, "upcoming"),
    ]);

    const result = completePlanSession({
      plan: original,
      completedSessionId: "session-1",
      completedAt: "2026-08-09T18:25:00.000Z",
    });

    expect(result.sessions.map((item) => item.status)).toEqual(["complete", "ready", "upcoming"]);
    expect(result.status).toBe("active");
  });

  it("changes delivery after a miss without replacing the next or later curriculum", () => {
    const next = session(2, "upcoming");
    const later = session(3, "upcoming");
    const original = plan([session(1, "ready"), next, later]);

    const result = completePlanSession({
      plan: original,
      completedSessionId: "session-1",
      completedAt: "2026-08-09T18:25:00.000Z",
      adaptation: adaptation(next),
    });

    expect(result.sessions[1]).toMatchObject({
      title: next.title,
      objective: next.objective,
      contentTargets: next.contentTargets,
      completionEvidence: next.completionEvidence,
      method: "Guided repair, then retrieval practice",
      learningMode: "learn",
      status: "ready",
    });
    expect(result.sessions[1]?.resource).toBeUndefined();
    expect(result.sessions[1]?.adaptationNote?.adaptedAt).toBe("2026-08-09T18:25:00.000Z");
    expect(result.sessions[2]).toEqual(later);
  });

  it("still applies a matching adaptation if the next target is already ready", () => {
    const next = session(2, "ready");
    const result = completePlanSession({
      plan: plan([session(1, "ready"), next]),
      completedSessionId: "session-1",
      completedAt: "2026-08-09T18:25:00.000Z",
      adaptation: adaptation(next),
    });

    expect(result.sessions[1]).toMatchObject({
      title: next.title,
      objective: next.objective,
      method: "Guided repair, then retrieval practice",
      status: "ready",
    });
  });

  it("adds one delayed verification after a final miss and keeps the plan active", () => {
    const followUp = session(2, "ready", {
      title: "Verify alliance escalation after a delay",
      objective: "Retrieve and apply the alliance escalation chain after time has passed.",
      estimatedMinutes: 10,
      amountLabel: "Delayed verification · about 10 min",
      reviewConcept: "alliance escalation",
      reviewType: "verify",
    });
    const original = plan([session(1, "ready")]);

    const firstResult = completePlanSession({
      plan: original,
      completedSessionId: "session-1",
      completedAt: "2026-08-09T18:25:00.000Z",
      followUpSession: followUp,
    });
    const repeatedResult = completePlanSession({
      plan: firstResult,
      completedSessionId: "session-1",
      completedAt: "2026-08-09T18:25:00.000Z",
      followUpSession: followUp,
    });

    expect(firstResult.status).toBe("active");
    expect(firstResult.sessions).toHaveLength(2);
    expect(firstResult.sessions[1]).toEqual(followUp);
    expect(repeatedResult.sessions).toHaveLength(2);
  });

  it("inserts a required verification immediately and preserves every later target", () => {
    const next = session(2, "upcoming");
    const later = session(3, "upcoming");
    const verification = session(2, "ready", {
      id: "verification-session",
      title: "Verify target 1",
      reviewConcept: "Concept 1",
      reviewType: "verify",
      topicIds: ["9a87ade4-678a-4a60-934f-35dc05d08158"],
    });

    const result = completePlanSession({
      plan: plan([session(1, "ready"), next, later]),
      completedSessionId: "session-1",
      completedAt: "2026-08-09T18:25:00.000Z",
      followUpSession: verification,
    });

    expect(result.sessions.map(({ id, sequence, status }) => ({ id, sequence, status }))).toEqual([
      { id: "session-1", sequence: 1, status: "complete" },
      { id: "verification-session", sequence: 2, status: "ready" },
      { id: "session-2", sequence: 3, status: "upcoming" },
      { id: "session-3", sequence: 4, status: "upcoming" },
    ]);
    expect(result.sessions[2]).toMatchObject({
      id: next.id,
      title: next.title,
      objective: next.objective,
      contentTargets: next.contentTargets,
    });
    expect(result.sessions[3]).toMatchObject({
      id: later.id,
      title: later.title,
      objective: later.objective,
      contentTargets: later.contentTargets,
    });
  });

  it("inserts deferred guided work as the sole next ready session without moving later timestamps", () => {
    const next = session(2, "upcoming", {
      id: "later-session",
      scheduledFor: "2026-08-10T18:00:00.000Z",
    });
    const protectedReview = session(3, "upcoming", {
      id: "protected-review",
      scheduledFor: "2026-08-11T18:00:00.000Z",
      reviewConcept: "Concept 1",
      reviewType: "verify",
    });
    const continuation = session(2, "ready", {
      id: "deferred-continuation",
      title: "Continue target 1",
      scheduledFor: "2026-08-09T18:25:00.000Z",
      topicIds: ["9a87ade4-678a-4a60-934f-35dc05d08158"],
      contentTargets: ["Deferred part of concept 1"],
      completionEvidence: ["Explain the deferred part of concept 1"],
    });

    const result = completePlanSession({
      plan: plan([session(1, "ready"), next, protectedReview]),
      completedSessionId: "session-1",
      completedAt: "2026-08-09T18:25:00.000Z",
      continuationSession: continuation,
    });

    expect(result.sessions.map(({ id, sequence, status }) => ({ id, sequence, status }))).toEqual([
      { id: "session-1", sequence: 1, status: "complete" },
      { id: "deferred-continuation", sequence: 2, status: "ready" },
      { id: "later-session", sequence: 3, status: "upcoming" },
      { id: "protected-review", sequence: 4, status: "upcoming" },
    ]);
    expect(result.sessions.filter((item) => item.status === "ready")).toHaveLength(1);
    expect(result.sessions.find((item) => item.id === "later-session")?.scheduledFor).toBe(next.scheduledFor);
    expect(result.sessions.find((item) => item.id === "protected-review")?.scheduledFor).toBe(protectedReview.scheduledFor);

    const replayed = completePlanSession({
      plan: result,
      completedSessionId: "session-1",
      completedAt: "2026-08-09T18:25:00.000Z",
      continuationSession: continuation,
    });
    expect(replayed.sessions).toEqual(result.sessions);
  });

  it("does not shift later sessions again when completion is replayed", () => {
    const verification = session(2, "ready", {
      id: "verification-session",
      reviewConcept: "Concept 1",
      reviewType: "verify",
    });
    const first = completePlanSession({
      plan: plan([session(1, "ready"), session(2, "upcoming")]),
      completedSessionId: "session-1",
      completedAt: "2026-08-09T18:25:00.000Z",
      followUpSession: verification,
    });
    const repeated = completePlanSession({
      plan: first,
      completedSessionId: "session-1",
      completedAt: "2026-08-09T18:25:00.000Z",
      followUpSession: { ...verification },
    });

    expect(repeated.sessions).toEqual(first.sessions);
  });

  it("completes a plan only when no planned or verification work remains", () => {
    const result = completePlanSession({
      plan: plan([session(1, "ready")]),
      completedSessionId: "session-1",
      completedAt: "2026-08-09T18:25:00.000Z",
    });

    expect(result.status).toBe("completed");
    expect(result.sessions[0]?.status).toBe("complete");
  });

  it("does not mutate a plan when the completed session cannot be found", () => {
    const original = plan([session(1, "ready")]);
    expect(completePlanSession({
      plan: original,
      completedSessionId: "missing",
      completedAt: "2026-08-09T18:25:00.000Z",
    })).toBe(original);
  });
});
