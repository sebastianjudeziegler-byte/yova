import { describe, expect, it } from "vitest";
import type { SessionInterruption } from "@/lib/domain";
import type { GuidedSessionStep } from "@/lib/learning/session-evidence";
import {
  readSessionAdjustmentSnapshot,
  resumedSessionAdjustment,
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

  it("restores the exact setup used to generate an interrupted lesson", () => {
    const stopped = {
      ...interruption("adjusted", 2, "2026-08-06T18:15:00.000Z"),
      plannedMinutes: 20,
      sessionAdjustment: {
        familiarity: "need_teaching" as const,
        availableMinutes: 20,
        knownTargets: ["ATP coupling"],
        note: "Please connect this to cellular respiration.",
      },
    };

    expect(resumedSessionAdjustment({
      interruption: stopped,
      plannedSessionMinutes: 25,
      inMemoryAdjustment: null,
    })).toEqual(stopped.sessionAdjustment);
  });

  it("preserves the selected time for older interruptions without a setup snapshot", () => {
    const stopped = {
      ...interruption("legacy-adjusted", 2, "2026-08-06T18:15:00.000Z"),
      plannedMinutes: 20,
    };

    expect(resumedSessionAdjustment({
      interruption: stopped,
      plannedSessionMinutes: 25,
    })).toEqual({
      familiarity: "as_planned",
      availableMinutes: 20,
      knownTargets: [],
      note: "",
    });
  });

  it("validates and normalizes a persisted setup snapshot", () => {
    expect(readSessionAdjustmentSnapshot({
      familiarity: "challenge_me",
      availableMinutes: 45,
      knownTargets: ["  ATP coupling  "],
      note: "  Use a harder transfer question.  ",
    })).toEqual({
      familiarity: "challenge_me",
      availableMinutes: 45,
      knownTargets: ["ATP coupling"],
      note: "Use a harder transfer question.",
    });
    expect(readSessionAdjustmentSnapshot({
      familiarity: "challenge_me",
      availableMinutes: 9,
      knownTargets: [],
      note: "",
    })).toBeUndefined();
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
        repairSupport: {
          mode: "hint_first" as const,
          modeLabel: "One clue first",
          personalizationReason: "The learner asked for a bounded hint before the complete correction.",
          title: "Use one clue, then retry the product rule",
          supportHeading: "One bounded clue",
          explanation: "Both original factors still appear in the completed derivative.",
          steps: [],
          retryPrompt: "State the complete rule again without copying the reference answer.",
          targetReminder: "The original product-rule target remains unchanged.",
        },
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
        repairSupport: {
          mode: "hint_first" as const,
          modeLabel: "One clue first",
          personalizationReason: "The learner asked for a bounded hint before the complete correction.",
          title: "Use one clue, then retry the product rule",
          supportHeading: "One bounded clue",
          explanation: "Both original factors still appear in the completed derivative.",
          steps: [],
          retryPrompt: "State the complete rule again without copying the reference answer.",
          targetReminder: "The original product-rule target remains unchanged.",
        },
      },
    };

    const restored = restoreInterruptedLesson(baseSteps, stopped);

    expect(restored.step).toBe(1);
    expect(restored.steps).toHaveLength(3);
    expect(restored.steps[1]).toMatchObject({
      evidenceRole: "immediate_repair",
      concept: "Product rule",
      repairSupport: {
        mode: "hint_first",
      },
    });
    expect(restored.steps[2].title).toBe("Use the rule");
  });

  it("appends an unfinished repair after the final completed original activity", () => {
    const baseSteps: GuidedSessionStep[] = [
      {
        methodPhase: "model",
        type: "instruction",
        concept: null,
        label: "Learn",
        title: "Build the rule",
        body: "Read the explanation before answering.",
        question: null,
        correctAnswer: null,
        feedback: null,
      },
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
    ];
    const stopped = {
      ...interruption("final-repair-pending", 2, "2026-08-06T18:15:00.000Z"),
      resumeStep: baseSteps.length,
      totalSteps: baseSteps.length + 1,
      pendingRepair: {
        concept: "Product rule",
        title: "Explain Product rule again in your own words",
        body: "State the corrected rule without looking back.",
        correctAnswer: "f'g + fg'",
        feedback: "Differentiate each factor once.",
      },
    };

    const restored = restoreInterruptedLesson(baseSteps, stopped);

    expect(restored.step).toBe(baseSteps.length);
    expect(restored.steps).toHaveLength(baseSteps.length + 1);
    expect(restored.steps[1]?.title).toBe("Choose the derivative");
    expect(restored.steps[2]).toMatchObject({
      evidenceRole: "immediate_repair",
      concept: "Product rule",
    });
  });
});
