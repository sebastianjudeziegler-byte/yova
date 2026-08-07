import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { buildAgendaBalanceSuggestion, buildAgendaDayGroups, summarizeAgenda } from "@/lib/scheduling/agenda-insights";

const now = new Date(2026, 7, 6, 9, 0, 0);

function session(id: string, day: number, hour: number, minutes: number, sequence: number): LearningPlanSession {
  return { id, sequence, title: `Session ${id}`, objective: "Learn", method: "Retrieval", methodReason: "Useful", scheduledFor: new Date(2026, 7, day, hour).toISOString(), estimatedMinutes: minutes, amountLabel: `${minutes} minutes`, learningMode: "study", status: sequence === 1 ? "ready" : "upcoming" };
}

function plan(sessions: LearningPlanSession[], deadlineDay = 14): LearningPlan {
  return { id: "plan-1", learningItemId: "item-1", title: "Biology", topic: "Cells", kind: "test", deadline: new Date(2026, 7, deadlineDay, 23, 0).toISOString(), status: "active", sourceMode: "yova_generated", studyMode: "inside_yova", learningIntent: "study", rationale: "Test", createdAt: now.toISOString(), sessions };
}

describe("agenda insights", () => {
  it("groups work by day and labels crowded days", () => {
    const learningPlan = plan([session("a", 6, 10, 30, 1), session("b", 6, 14, 30, 2), session("c", 6, 18, 20, 3)]);
    const groups = buildAgendaDayGroups(learningPlan.sessions.map((item) => ({ plan: learningPlan, session: item })), now);
    expect(groups[0].totalMinutes).toBe(80);
    expect(groups[0].load).toBe("heavy");
  });

  it("summarizes actual work and deadlines", () => {
    const learningPlan = plan([session("a", 6, 10, 25, 1), session("b", 7, 10, 30, 2)]);
    const entries = learningPlan.sessions.map((item) => ({ plan: learningPlan, session: item }));
    const summary = summarizeAgenda(entries, [learningPlan], now);
    expect(summary.todayMinutes).toBe(25);
    expect(summary.weekMinutes).toBe(55);
    expect(summary.nextDeadline?.plan.title).toBe("Biology");
  });

  it("recommends a safe move away from a crowded day", () => {
    const learningPlan = plan([session("a", 6, 10, 30, 1), session("b", 6, 14, 30, 2), session("c", 6, 18, 25, 3), session("d", 10, 10, 25, 4)]);
    const entries = learningPlan.sessions.map((item) => ({ plan: learningPlan, session: item }));
    const suggestion = buildAgendaBalanceSuggestion(entries, now);
    expect(suggestion?.entry.session.id).toBe("c");
    expect(suggestion?.toDateKey).toBe("2026-08-07");
    expect(suggestion?.afterMinutes).toBe(60);
  });
});
