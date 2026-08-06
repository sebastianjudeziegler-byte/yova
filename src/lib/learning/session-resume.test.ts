import { describe, expect, it } from "vitest";
import type { SessionInterruption } from "@/lib/domain";
import type { GuidedSessionStep } from "@/lib/learning/session-evidence";
import {
  restoreInterruptedLesson,
  resumableSessionProgress,
} from "@/lib/learning/session-resume";

function interruption(
  id: string,
  completedSteps: number,
  interruptedAt: string,
  planSessionId = "session-1",
): SessionInterruption {
  return {
    id,
    planId: "plan-1",
    planSessionId,
    startedAt: "2026-08-06T18:00:00.000Z",
    interruptedAt,
    plannedMinutes: 25,
    actualMinutes: 5,
    completedSteps,
    totalSteps: 5,
  };
}

describe("resumableSessionProgress", () => {
  it("returns the latest valid interruption after a learner stops more than once", () => {
    const result = resumableSessionProgress("session-1", [
      interruption("first", 1, "2026-08-06T18:05:00.000Z"),
      interruption("second", 3, "2026-08-06T18:15:00.000Z"),
    ]);

    expect(result?.id).toBe("second");
    expect(result?.completedSteps).toBe(3);
  });

  it("ignores another session and interruptions without a usable resume point", () => {
    const result = resumableSessionProgress("session-1", [
      interruption("not-started", 0, "2026-08-06T18:20:00.000Z"),
      interruption("finished", 5, "2026-08-06T18:25:00.000Z"),
      interruption("other-session", 2, "2026-08-06T18:30:00.000Z", "session-2"),
    ]);

    expect(result).toBeNull();
  });

  it("restores an unfinished repair before the next original activity", () => {
    const baseSteps: GuidedSessionStep[] = [
      {
        methodPhase: "retrieve",
        type: "multiple_choice",
        concept: "Product rule",
        label: "Check",
        title: "Choose the derivative",
        body: "Answer before checking.",
        question: ["f'g + fg'", "f'g'"],
        correctAnswer: "f'g + fg'",
        feedback: "Differentiate each factor once.",
      },
      {
        methodPhase: "transfer",
        type: "free_response",
        concept: "Product rule transfer",
        label: "Apply",
        title: "Use the rule",
        body: "Apply it to a new example.",
        question: null,
        correctAnswer: "Use two derivative terms.",
        feedback: "Each factor changes in one term.",
      },
    ];
    const stopped = {
      ...interruption("repair-pending", 1, "2026-08-06T18:15:00.000Z"),
      resumeStep: 1,
      pendingRepair: {
        concept: "Product rule",
        title: "Explain Product rule again in your own words",
        body: "State the corrected rule without looking back.",
        correctAnswer: "f'g + fg'",
        feedback: "Differentiate each factor once.",
      },
    };

    const restored = restoreInterruptedLesson(baseSteps, stopped);

    expect(restored.step).toBe(1);
    expect(restored.steps).toHaveLength(3);
    expect(restored.steps[1]).toMatchObject({
      evidenceRole: "immediate_repair",
      concept: "Product rule",
    });
    expect(restored.steps[2].title).toBe("Use the rule");
  });
});
