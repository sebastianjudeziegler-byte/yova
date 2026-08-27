import { describe, expect, it } from "vitest";
import type { DeadlineMilestone, LearningPlan, PlanStatus } from "@/lib/domain";
import {
  availableLearningItemIds,
  canPresentPlanAsCompleted,
  filterAgendaMilestones,
  filterAvailablePlans,
  filterOperationalPlans,
  filterTutorThreads,
  isAvailablePlanStatus,
  isOperationalPlan,
  isOperationalPlanStatus,
  recoverRunnablePlanLifecycle,
} from "@/lib/learning/plan-visibility";

describe("plan visibility", () => {
  const statuses: PlanStatus[] = ["draft", "active", "completed", "archived"];

  it("treats only active plans as operational", () => {
    expect(statuses.filter(isOperationalPlanStatus)).toEqual(["active"]);
    expect(filterOperationalPlans(statuses.map(plan))).toMatchObject([
      { id: "active", status: "active" },
    ]);
  });

  it("reopens only a legacy completed plan that still has runnable work", () => {
    const unfinishedLegacy = {
      ...plan("completed"),
      id: "legacy-unfinished",
      sessions: [{ status: "ready" as const }, { status: "upcoming" as const }],
    };

    expect(isOperationalPlan(unfinishedLegacy)).toBe(true);
    expect(filterOperationalPlans([
      plan("active"),
      plan("completed"),
      unfinishedLegacy,
      { ...plan("archived"), sessions: [{ status: "ready" as const }] },
    ]).map((item) => item.id)).toEqual(["active", "legacy-unfinished"]);
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

  it("does not present a legacy completed plan as complete while runnable sessions remain", () => {
    expect(canPresentPlanAsCompleted({
      status: "completed",
      sessions: [{ status: "ready" }, { status: "upcoming" }],
    })).toBe(false);
    expect(canPresentPlanAsCompleted({
      status: "completed",
      sessions: [{ status: "complete" }, { status: "skipped" }],
    })).toBe(true);
    expect(canPresentPlanAsCompleted({
      status: "active",
      sessions: [{ status: "complete" }],
    })).toBe(false);
  });

  it("repairs an unrelated completed plan with obsolete undersized content parts at the read boundary", () => {
    const corrupted = {
      ...plan("completed"),
      id: "plate-tectonics",
      title: "Plate tectonics",
      sessions: [
        obsoleteSplitSession("content-1", "ready", 8, 1, "Practice plate boundaries · about 8 min"),
        obsoleteSplitSession("content-2", "upcoming", 7, 2, "Explain mantle convection"),
        {
          ...session("review", "upcoming", 5, "Verify continental drift · about 5 min"),
          reviewConcept: "continental drift",
          reviewType: "verify" as const,
        },
      ],
    };

    const recovered = recoverRunnablePlanLifecycle(corrupted);

    expect(recovered.status).toBe("active");
    expect(recovered.sessions.map((item) => ({
      id: item.id,
      minutes: item.estimatedMinutes,
      amountLabel: item.amountLabel,
    }))).toEqual([
      {
        id: "content-1",
        minutes: 10,
        amountLabel: "Practice plate boundaries · about 10 min",
      },
      {
        id: "content-2",
        minutes: 10,
        amountLabel: "Explain mantle convection · about 10 min",
      },
      {
        id: "review",
        minutes: 5,
        amountLabel: "Verify continental drift · about 5 min",
      },
    ]);
    expect(recovered.sessions[2]).toMatchObject({
      reviewConcept: "continental drift",
      reviewType: "verify",
    });
  });

  it("repairs safely fingerprinted obsolete parts in an already-active plan", () => {
    const active = {
      ...plan("active"),
      sessions: [
        obsoleteSplitSession("part-1", "ready", 8, 1, "Part 1 · about 8 min"),
        obsoleteSplitSession("part-2", "upcoming", 7, 2, "Part 2 · about 7 min"),
      ],
    };

    const recovered = recoverRunnablePlanLifecycle(active);

    expect(recovered.status).toBe("active");
    expect(recovered.sessions.map((item) => item.estimatedMinutes)).toEqual([10, 10]);
  });

  it("does not inflate an unrelated short session without obsolete split provenance", () => {
    const active = {
      ...plan("active"),
      sessions: [session("short-work", "ready", 8, "A bounded short check")],
    };

    expect(recoverRunnablePlanLifecycle(active)).toBe(active);
  });

  it("does not rewrite a fingerprinted part with saved interruption progress", () => {
    const interrupted = obsoleteSplitSession(
      "interrupted-part",
      "ready",
      8,
      1,
      "Interrupted part · about 8 min",
    );
    const active = { ...plan("active"), sessions: [interrupted] };

    expect(recoverRunnablePlanLifecycle(
      active,
      new Set([interrupted.id]),
    )).toBe(active);
  });

  it("does not mutate a routed session while recovering obsolete legacy splits", () => {
    const routedPart = {
      ...obsoleteSplitSession(
        "routed-part",
        "ready",
        8,
        1,
        "Routed part · about 8 min",
      ),
      studyRoute: {} as NonNullable<LearningPlan["sessions"][number]["studyRoute"]>,
    };
    const active = { ...plan("active"), sessions: [routedPart] };

    expect(recoverRunnablePlanLifecycle(active)).toBe(active);
    expect(active.sessions[0]).toMatchObject({
      estimatedMinutes: 8,
      amountLabel: "Routed part · about 8 min",
      studyRoute: routedPart.studyRoute,
    });
  });

  it("does not reopen genuine completed or archived plans", () => {
    const genuinelyComplete = {
      ...plan("completed"),
      sessions: [session("done", "complete", 15, "Done")],
    };
    const archived = {
      ...plan("archived"),
      sessions: [session("orphan", "ready", 8, "Old")],
    };

    expect(recoverRunnablePlanLifecycle(genuinelyComplete)).toBe(genuinelyComplete);
    expect(recoverRunnablePlanLifecycle(archived)).toBe(archived);
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

  it("restores a linked deadline when a legacy completed plan still has runnable work", () => {
    const unfinishedLegacy = {
      ...plan("completed"),
      sessions: [{ status: "ready" as const }],
    };
    expect(filterAgendaMilestones([
      milestone("legacy-link", "item-completed"),
    ], [unfinishedLegacy]).map((item) => item.id)).toEqual(["legacy-link"]);
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

function session(
  id: string,
  status: LearningPlan["sessions"][number]["status"],
  estimatedMinutes: number,
  amountLabel: string,
): LearningPlan["sessions"][number] {
  return {
    id,
    sequence: 1,
    title: id,
    objective: `Understand ${id}`,
    method: "Self-explanation",
    methodReason: "Build a coherent mental model.",
    scheduledFor: "2026-08-19T12:00:00.000Z",
    estimatedMinutes,
    amountLabel,
    learningMode: "learn",
    status,
  };
}

function obsoleteSplitSession(
  id: string,
  status: LearningPlan["sessions"][number]["status"],
  estimatedMinutes: number,
  segmentIndex: number,
  amountLabel: string,
): LearningPlan["sessions"][number] {
  return {
    ...session(id, status, estimatedMinutes, amountLabel),
    originSessionId: "10000000-1000-4000-8000-100000000001",
    originalContentMinutes: 15,
    segmentIndex,
    segmentCount: 2,
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
