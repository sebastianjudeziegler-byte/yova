import { describe, expect, it } from "vitest";
import type { LearningPlan, SessionCompletion } from "@/lib/domain";
import { interleavedKeyPointsForSession } from "@/lib/routing/route-for-session";
import { baselineObservedGap, baselineOutcomeTopicId, nextReadyBaselineSession } from "./continuation";

const now = new Date("2026-09-17T12:00:00Z");
const plan = { sessions: [
  { id: "current", sequence: 1, topicIds: ["intro"], learningMode: "learn", status: "ready", scheduledFor: "2026-09-17T10:00:00Z" },
  { id: "next", sequence: 2, topicIds: ["advanced"], learningMode: "learn", status: "upcoming", scheduledFor: "2026-09-17T11:00:00Z" },
], knowledgeMap: { topics: [{ id: "intro", prerequisiteTopicIds: [], status: "not_started" }, { id: "advanced", prerequisiteTopicIds: ["intro"], status: "not_started" }] } } as unknown as LearningPlan;

describe("optional next-ready work", () => {
  it("offers the existing next due activity once the completed block satisfies its prerequisite", () => {
    expect(nextReadyBaselineSession(plan, "current", now)?.id).toBe("next");
  });
  it("does not pull a future spaced session forward, or skip an unfinished prerequisite", () => {
    const future = { ...plan, sessions: plan.sessions.map((session) => session.id === "next" ? { ...session, scheduledFor: "2026-09-18T12:00:00Z" } : session) };
    expect(nextReadyBaselineSession(future, "current", now)).toBeNull();
    const unfinished = { ...plan, sessions: [...plan.sessions, { ...plan.sessions[0]!, id: "still-learning", sequence: 3, status: "upcoming" as const }] };
    expect(nextReadyBaselineSession(unfinished, "current", now)).toBeNull();
  });
  it("does not invent additional activity when the queue is empty", () => {
    expect(nextReadyBaselineSession({ ...plan, sessions: [plan.sessions[0]!] }, "current", now)).toBeNull();
  });
  it("offers the next prerequisite-ready learn block when only its suggested date is later", () => {
    const future = { ...plan, sessions: plan.sessions.map(session => session.id === "next" ? { ...session, scheduledFor: "2026-09-18T12:00:00Z", workload: { suggestedDate: true } as NonNullable<typeof session.workload> } : session) };
    expect(nextReadyBaselineSession(future, "current", now)?.id).toBe("next");
    const unfinished = { ...future, sessions: [...future.sessions, { ...plan.sessions[0]!, id: "unfinished-prerequisite", sequence: 3 }] };
    expect(nextReadyBaselineSession(unfinished, "current", now)).toBeNull();
    const fixed = { ...future, sessions: future.sessions.map(session => session.workload ? { ...session, workload: { ...session.workload, suggestedDate: false } } : session) };
    expect(nextReadyBaselineSession(fixed, "current", now)).toBeNull();
  });
  it("never offers future practice early or skips it to reach a later learning block", () => {
    const futurePractice = { ...plan.sessions[1]!, learningMode: "study" as const, scheduledFor: "2026-09-18T12:00:00Z", workload: { suggestedDate: true } as NonNullable<LearningPlan["sessions"][number]["workload"]> };
    const laterLearn = { ...futurePractice, id: "later-learn", learningMode: "learn" as const, sequence: 3 };
    expect(nextReadyBaselineSession({ ...plan, sessions: [plan.sessions[0]!, futurePractice, laterLearn] }, "current", now)).toBeNull();
  });
});

describe("saved feedback description", () => {
  const comparison = { missing: ["State the membrane condition"], incorrect: ["Water direction is reversed"] };
  it("uses checked revision gaps without rewriting the original comparison", () => {
    const result = { escalated: false, comparison, revision: { status: "checked" as const, comparison: { missing: [], incorrect: [] } } };
    expect(baselineObservedGap(result, 3)).toBe("Correction feedback: no remaining gaps named.");
    expect(result.comparison.incorrect).toEqual(["Water direction is reversed"]);
  });
  it("distinguishes an unchecked correction and unavailable comparison from a clean result", () => {
    expect(baselineObservedGap({ escalated: false, comparison, revision: { status: "unchecked", comparison: null } }, 3)).toContain("Correction unchecked. Original comparison:");
    expect(baselineObservedGap({ escalated: false, comparison: null, comparisonUnavailable: true }, 3)).toContain("Comparison unavailable");
  });
});

describe("completion topic provenance", () => {
  it("retains an actual interleaved related topic outside the session's primary topic", () => {
    const completions = [{ conceptEvidence: [
      { topicId: "intro", concept: "Introductory mechanism is understood.", outcome: "secure" },
      { topicId: "advanced", concept: "The advanced mechanism changes the result.", outcome: "secure" },
    ] }] as unknown as SessionCompletion[];
    const points = interleavedKeyPointsForSession({ plan, topic: plan.knowledgeMap!.topics[0]!, completions });
    const related = points.find(point => point.sourceTopicId === "advanced")!;
    expect(related).toBeDefined();
    expect(baselineOutcomeTopicId({ plan, session: plan.sessions[0]!, sourceTopicId: related.sourceTopicId, interleavedTopicIds: points.flatMap(point => point.sourceTopicId ? [point.sourceTopicId] : []) })).toBe("advanced");
  });
  it("never relabels a supplied unknown or unexecuted topic as the primary topic", () => {
    expect(baselineOutcomeTopicId({ plan, session: plan.sessions[0]!, sourceTopicId: "unknown", interleavedTopicIds: ["unknown"] })).toBeUndefined();
    expect(baselineOutcomeTopicId({ plan, session: plan.sessions[0]!, sourceTopicId: "advanced" })).toBeUndefined();
  });
  it("keeps single-topic legacy fallback only when an origin was not supplied", () => {
    expect(baselineOutcomeTopicId({ plan, session: plan.sessions[0]! })).toBe("intro");
    expect(baselineOutcomeTopicId({ plan, session: { ...plan.sessions[0]!, topicIds: ["intro", "advanced"] } })).toBeUndefined();
  });
});
