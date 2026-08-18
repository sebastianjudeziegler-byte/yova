import { describe, expect, it } from "vitest";
import type { DeadlineMilestone, LearningPlan, PlanStatus } from "@/lib/domain";
import {
  availableLearningItemIds,
  filterAgendaMilestones,
  filterAvailablePlans,
  filterOperationalPlans,
  filterTutorThreads,
  isAvailablePlanStatus,
  isOperationalPlanStatus,
} from "@/lib/learning/plan-visibility";

describe("plan visibility", () => {
  const statuses: PlanStatus[] = ["draft", "active", "completed", "archived"];

  it("treats only active plans as operational", () => {
    expect(statuses.filter(isOperationalPlanStatus)).toEqual(["active"]);
    expect(filterOperationalPlans(statuses.map(plan))).toMatchObject([
      { id: "active", status: "active" },
    ]);
  });

  it("keeps active and completed plans available for safe historical context", () => {
    expect(statuses.filter(isAvailablePlanStatus)).toEqual(["active", "completed"]);
    expect(filterAvailablePlans(statuses.map(plan)).map((item) => item.id)).toEqual([
      "active",
      "completed",
    ]);
    expect([...availableLearningItemIds(statuses.map(plan))]).toEqual([
      "item-active",
      "item-completed",
    ]);
  });

  it("rejects unknown lifecycle values instead of making them visible", () => {
    expect(isOperationalPlanStatus("deleted")).toBe(false);
    expect(isAvailablePlanStatus("paused")).toBe(false);
    expect(isAvailablePlanStatus(null)).toBe(false);
  });
});

describe("Agenda milestone visibility", () => {
  const plans = (["draft", "active", "completed", "archived"] as const).map(plan);
  const milestones = [
    milestone("standalone", null),
    milestone("active-link", "item-active"),
    milestone("draft-link", "item-draft"),
    milestone("completed-link", "item-completed"),
    milestone("archived-link", "item-archived"),
    milestone("deleted-link", "item-deleted"),
  ];

  it("keeps standalone and operational-plan deadlines in their original order", () => {
    expect(filterAgendaMilestones(milestones, plans).map((item) => item.id)).toEqual([
      "standalone",
      "active-link",
    ]);
  });

  it("fails closed for linked milestones when the plan was deleted or never loaded", () => {
    expect(filterAgendaMilestones([
      milestone("orphan", "item-missing"),
    ], [])).toEqual([]);
  });
});

describe("tutor thread visibility", () => {
  const threads = [
    { id: "general", learningItemId: null },
    { id: "active", learningItemId: "item-active" },
    { id: "completed", learningItemId: "item-completed" },
    { id: "archived", learningItemId: "item-archived" },
    { id: "draft", learningItemId: "item-draft" },
    { id: "deleted", learningItemId: "item-deleted" },
  ];

  it("keeps general, active-plan, and completed-plan conversations only", () => {
    const availableIds = availableLearningItemIds(
      (["draft", "active", "completed", "archived"] as const).map(plan),
    );

    expect(filterTutorThreads(threads, availableIds).map((thread) => thread.id)).toEqual([
      "general",
      "active",
      "completed",
    ]);
  });

  it("hides orphaned plan conversations", () => {
    expect(filterTutorThreads([
      { id: "orphan", learningItemId: "item-deleted" },
    ], new Set())).toEqual([]);
  });
});

function plan(status: PlanStatus): LearningPlan {
  return {
    id: status,
    learningItemId: `item-${status}`,
    title: status,
    topic: status,
    kind: "topic",
    deadline: null,
    status,
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Visibility fixture",
    createdAt: "2026-08-18T12:00:00.000Z",
    sessions: [],
  };
}

function milestone(id: string, linkedLearningItemId: string | null): DeadlineMilestone {
  return {
    id,
    title: id,
    description: "Visibility fixture",
    dueAt: "2026-08-19T12:00:00.000Z",
    status: "open",
    linkedLearningItemId,
    createdAt: "2026-08-18T12:00:00.000Z",
  };
}
