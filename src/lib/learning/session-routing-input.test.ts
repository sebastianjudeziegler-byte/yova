import { describe, expect, it } from "vitest";
import { buildLearningScienceRoutingBrief } from "@/lib/learning/method-router";
import {
  learnerStatedTaskType,
  sessionRoutingInput,
  type SessionRoutingContext,
} from "@/lib/learning/session-routing-input";

function context(goalTopic: string, sessionWording: string): SessionRoutingContext {
  return {
    learningGoal: {
      learningIntent: "learn",
      title: "A saved goal title",
      topic: goalTopic,
      kind: "topic",
    },
    session: {
      learningMode: "learn",
      title: sessionWording,
      objective: sessionWording,
      method: "",
      methodReason: "",
    },
    learnerProfile: null,
    recentResults: [],
    recentInterruptions: [],
  };
}

describe("what the learner said the task is", () => {
  it("reads an unambiguous goal", () => {
    expect(learnerStatedTaskType("Memorize the three states of matter")).toBe("memorization");
  });

  it("declines to guess from an ambiguous goal", () => {
    expect(learnerStatedTaskType("Get better at this before the test")).toBeNull();
  });
});

describe("building the routing input for a session", () => {
  const memorizeGoal = "Memorize the parts of a plant cell and what each organelle does";
  const conceptualWording = "Understand why the chloroplast structure explains how it captures light energy";

  it("carries the learner's task type so generated wording cannot override it", () => {
    const routing = buildLearningScienceRoutingBrief(
      sessionRoutingInput(context(memorizeGoal, conceptualWording)),
    );

    expect(routing.taskType).toBe("memorization");
  });

  it("falls back to the session wording when the goal does not commit", () => {
    const routing = buildLearningScienceRoutingBrief(
      sessionRoutingInput(context("Get ready for what is coming up", conceptualWording)),
    );

    expect(routing.taskType).toBe("conceptual_learning");
  });

  it("lets a caller override presentation fields without losing the learner's task", () => {
    // The streamed generator forces teaching mode and ignores prior results.
    const input = sessionRoutingInput(context(memorizeGoal, conceptualWording), {
      sessionLearningMode: "learn",
      recentResults: [],
      interruptionCount: 0,
    });

    expect(input.sessionLearningMode).toBe("learn");
    expect(input.taskTypeOverride).toBe("memorization");
  });

  it("counts interruptions from the context", () => {
    const base = context(memorizeGoal, conceptualWording);
    const input = sessionRoutingInput({ ...base, recentInterruptions: [{}, {}] });

    expect(input.interruptionCount).toBe(2);
  });
});
