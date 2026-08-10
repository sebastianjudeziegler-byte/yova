import { describe, expect, it } from "vitest";
import { normalizeStreamedActivityPhaseTypes } from "@/lib/session-generation/streamed-skeleton";
import {
  StreamedGeneratedSessionActivitySchema,
  type StreamedGeneratedSessionActivity,
} from "@/lib/session-generation/schema";

const topicId = "11111111-1111-4111-8111-111111111111";

function activity(input: unknown): StreamedGeneratedSessionActivity {
  return StreamedGeneratedSessionActivitySchema.parse(input);
}

describe("streamed skeleton normalization", () => {
  it("turns a reflection-shaped instruction into a real reflection", () => {
    const [result] = normalizeStreamedActivityPhaseTypes([activity({
      topicId,
      methodPhase: "reflect",
      estimatedMinutes: 1,
      requiredForCompletion: false,
      label: "Reflect",
      title: "Name the useful connection",
      body: "State which relationship helped the model make sense and what you will revisit later.",
      teaching: null,
      lessonBrief: null,
      practiceIntent: null,
      misconceptionSummary: null,
      type: "instruction",
      concept: null,
      choices: [],
      correctAnswer: null,
      feedback: null,
    })]);

    expect(result).toMatchObject({ type: "reflection", methodPhase: "reflect", topicId: null });
  });

  it("keeps a real question and treats it as transfer instead of reflection", () => {
    const [result] = normalizeStreamedActivityPhaseTypes([activity({
      topicId,
      methodPhase: "reflect",
      estimatedMinutes: 2,
      requiredForCompletion: true,
      label: "Check",
      title: "Apply the membrane model",
      body: "Which change would require direct energy input from the cell?",
      teaching: null,
      lessonBrief: null,
      practiceIntent: "independent_transfer",
      misconceptionSummary: null,
      type: "multiple_choice",
      concept: "Active transport",
      choices: ["Moving ions against their gradient", "Osmosis", "Simple diffusion"],
      correctAnswer: "Moving ions against their gradient",
      feedback: "Active transport moves substances against a gradient and therefore requires cellular energy.",
    })]);

    expect(result).toMatchObject({ type: "multiple_choice", methodPhase: "transfer" });
  });
});
