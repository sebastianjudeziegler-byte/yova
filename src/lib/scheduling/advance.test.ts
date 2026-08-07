import { describe, expect, it } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import {
  applyAdvancedSchedule,
  buildAdvancedSchedule,
  isSessionAheadOfSchedule,
} from "@/lib/scheduling/advance";

const plan: LearningPlan = {
  id: "plan-1",
  learningItemId: "item-1",
  title: "Biology test",
  topic: "Cellular respiration",
  kind: "test",
  deadline: "2026-08-12T18:00:00.000Z",
  status: "active",
  sourceMode: "yova_generated",
  studyMode: "inside_yova",
  learningIntent: "learn",
  rationale: "Build understanding before retrieval.",
  createdAt: "2026-08-06T18:00:00.000Z",
  sessions: [
    {
      id: "session-1",
      sequence: 1,
      title: "Build the model",
      objective: "Understand the stages.",
      method: "Self-explanation",
      methodReason: "A model comes first.",
      scheduledFor: "2026-08-08T18:00:00.000Z",
      estimatedMinutes: 25,
      amountLabel: "25 min",
      learningMode: "learn",
      status: "ready",
    },
    {
      id: "session-2",
      sequence: 2,
      title: "Retrieve the model",
      objective: "Recall the stages.",
      method: "Retrieval practice",
      methodReason: "Recall checks the model.",
      scheduledFor: "2026-08-10T18:00:00.000Z",
      estimatedMinutes: 25,
      amountLabel: "25 min",
      learningMode: "study",
      status: "upcoming",
    },
  ],
};

describe("advance a plan when the learner works ahead", () => {
  it("detects a ready session that is meaningfully ahead of schedule", () => {
    expect(isSessionAheadOfSchedule(plan.sessions[0], new Date("2026-08-06T18:00:00.000Z"))).toBe(true);
    expect(isSessionAheadOfSchedule(plan.sessions[0], new Date("2026-08-08T17:58:00.000Z"))).toBe(false);
  });

  it("pulls the current and remaining sessions forward while preserving their spacing", () => {
    const updates = buildAdvancedSchedule(plan, new Date("2026-08-06T18:00:00.000Z"));
    expect(updates).toEqual([
      {
        planSessionId: "session-1",
        previousScheduledFor: "2026-08-08T18:00:00.000Z",
        scheduledFor: "2026-08-06T18:00:00.000Z",
      },
      {
        planSessionId: "session-2",
        previousScheduledFor: "2026-08-10T18:00:00.000Z",
        scheduledFor: "2026-08-08T18:00:00.000Z",
      },
    ]);

    const updatedPlan = applyAdvancedSchedule(plan, updates);
    expect(updatedPlan.sessions.map((session) => session.scheduledFor)).toEqual([
      "2026-08-06T18:00:00.000Z",
      "2026-08-08T18:00:00.000Z",
    ]);
  });

  it("does not offer a schedule shift when the next session is already due", () => {
    expect(buildAdvancedSchedule(plan, new Date("2026-08-08T18:00:00.000Z"))).toEqual([]);
  });
});
