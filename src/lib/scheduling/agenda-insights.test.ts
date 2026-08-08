import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { buildAgendaBalanceSuggestion, buildAgendaDayGroups, buildDailyCapacityPlan, summarizeAgenda } from "@/lib/scheduling/agenda-insights";

const now = new Date(2026, 7, 6, 9, 0, 0);

function session(id: string, day: number, hour: number, minutes: number, sequence: number): LearningPlanSession {
  return { id, sequence, title: `Session ${id}`, objective: "Learn", method: "Retrieval", methodReason: "Useful", scheduledFor: new Date(2026, 7, day, hour).toISOString(), estimatedMinutes: minutes, amountLabel: `${minutes} minutes`, learningMode: "study", status: sequence === 1 ? "ready" : "upcoming" };
}

function plan(sessions: LearningPlanSession[], deadlineDay = 14, id = "plan-1", title = "Biology"): LearningPlan {
  return { id, learningItemId: `item-${id}`, title, topic: "Cells", kind: "test", deadline: new Date(2026, 7, deadlineDay, 23, 0).toISOString(), status: "active", sourceMode: "yova_generated", studyMode: "inside_yova", learningIntent: "study", rationale: "Test", createdAt: now.toISOString(), sessions };
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

  it("keeps a history workload unchanged when it already fits today's capacity", () => {
    const learningPlan = plan([session("source-analysis", 6, 10, 25, 1)], 9, "history", "History source analysis");
    const result = buildDailyCapacityPlan(learningPlan.sessions.map((item) => ({ plan: learningPlan, session: item })), 30, now);
    expect(result.status).toBe("fits");
    expect(result.projectedMinutes).toBe(25);
  });

  it("moves the less urgent learning goal when today exceeds the learner's real capacity", () => {
    const urgent = plan([session("history", 6, 10, 30, 1)], 7, "history", "History exam evidence");
    const flexible = plan([session("finance", 6, 16, 30, 1)], 13, "finance", "Personal finance foundations");
    const entries = [urgent, flexible].flatMap((item) => item.sessions.map((scheduled) => ({ plan: item, session: scheduled })));
    const result = buildDailyCapacityPlan(entries, 30, now);
    expect(result.status).toBe("move");
    expect(result.entry?.plan.id).toBe("finance");
    expect(result.toDateKey).toBe("2026-08-07");
    expect(result.projectedMinutes).toBe(30);
  });

  it("splits language-learning content when moving it would break the sequence", () => {
    const first = session("conversation", 6, 10, 45, 1);
    const next = session("retrieval", 7, 10, 20, 2);
    const learningPlan = plan([first, next], 7, "spanish", "Spanish conversation basics");
    const entries = learningPlan.sessions.map((item) => ({ plan: learningPlan, session: item }));
    const result = buildDailyCapacityPlan(entries, 20, now);
    expect(result.status).toBe("split");
    expect(result.entry?.session.id).toBe("conversation");
    expect(result.splitMinutes).toBe(20);
    expect(result.projectedMinutes).toBe(20);
  });

  it("does not claim one move fixes a day that would still exceed the learner's capacity", () => {
    const first = plan([session("biology", 6, 10, 30, 1)], 7, "biology", "Biology review");
    const second = plan([session("history", 6, 13, 30, 1)], 10, "history", "History source analysis");
    const third = plan([session("finance", 6, 16, 30, 1)], 14, "finance", "Finance foundations");
    const entries = [first, second, third].flatMap((item) => item.sessions.map((scheduled) => ({ plan: item, session: scheduled })));
    const result = buildDailyCapacityPlan(entries, 15, now);
    expect(result.status).toBe("blocked");
    expect(result.projectedMinutes).toBe(90);
  });

  it("only suggests rebalancing when the proposed move actually clears the crowded source day", () => {
    const learningPlan = plan([
      session("a", 6, 10, 30, 1),
      session("b", 6, 12, 30, 2),
      session("c", 6, 14, 10, 3),
      session("d", 6, 16, 10, 4),
      session("e", 6, 18, 10, 5),
    ]);
    const entries = learningPlan.sessions.map((item) => ({ plan: learningPlan, session: item }));
    expect(buildAgendaBalanceSuggestion(entries, now)).toBeNull();
  });

});
