import { describe, expect, it } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import { rankPlansForHome } from "@/lib/learning/home-recommendations";

const now = new Date("2026-08-07T17:00:00-07:00");

describe("home recommendation ranking", () => {
  it("places overdue work first, then urgent deadlines, then the next scheduled session", () => {
    const plans = [
      plan("later", "2026-08-10T18:00:00-07:00", null),
      plan("urgent", "2026-08-08T18:00:00-07:00", "2026-08-09T17:00:00-07:00"),
      plan("overdue", "2026-08-06T18:00:00-07:00", null),
    ];

    expect(rankPlansForHome(plans, now).map((item) => item.id)).toEqual([
      "overdue",
      "urgent",
      "later",
    ]);
  });

  it("omits plans that do not have a ready session", () => {
    const complete = plan("complete", "2026-08-06T18:00:00-07:00", null);
    complete.sessions[0].status = "complete";

    expect(rankPlansForHome([complete], now)).toEqual([]);
  });

  it("omits non-operational plans even when stale ready sessions remain", () => {
    const archived = plan("archived", "2026-08-06T18:00:00-07:00", null);
    archived.status = "archived";
    const draft = plan("draft", "2026-08-06T19:00:00-07:00", null);
    draft.status = "draft";
    const completed = plan("completed", "2026-08-06T20:00:00-07:00", null);
    completed.status = "completed";
    const active = plan("active", "2026-08-07T18:00:00-07:00", null);

    expect(rankPlansForHome([archived, draft, completed, active], now).map((item) => item.id)).toEqual([
      "active",
    ]);
  });
});

function plan(id: string, scheduledFor: string, deadline: string | null): LearningPlan {
  return {
    id,
    learningItemId: `item-${id}`,
    title: id,
    topic: id,
    kind: "topic",
    deadline,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Test plan",
    createdAt: "2026-08-01T12:00:00-07:00",
    sessions: [{
      id: `session-${id}`,
      sequence: 1,
      title: `Session ${id}`,
      objective: `Learn ${id}`,
      method: "Self-explanation",
      methodReason: "Build understanding",
      scheduledFor,
      estimatedMinutes: 20,
      amountLabel: "Focused session · about 20 min",
      learningMode: "learn",
      status: "ready",
    }],
  };
}
