import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_OPTION_MAX_LENGTH,
  DIAGNOSTIC_QUESTION_MAX_LENGTH,
  DiagnosticResponseSchema,
  PlanDiagnosticQuestionSchema,
} from "@/lib/plan-generation/schema";

describe("placement question round trip", () => {
  const longQuestion = "In cells, ATP is useful because it can donate a phosphate group to another molecule. ".repeat(4).trim().slice(0, DIAGNOSTIC_QUESTION_MAX_LENGTH);
  const longOption = "o".repeat(DIAGNOSTIC_OPTION_MAX_LENGTH);

  it("accepts every generated question length back as a diagnostic response", () => {
    const generated = PlanDiagnosticQuestionSchema.parse({
      id: crypto.randomUUID(),
      topicId: crypto.randomUUID(),
      prompt: longQuestion,
      options: [longOption, "b", "c", "I don't know yet"],
      correctAnswer: longOption,
    });

    const echoed = DiagnosticResponseSchema.safeParse({
      questionId: generated.id,
      topicId: generated.topicId,
      question: generated.prompt,
      answer: generated.correctAnswer,
      evaluation: "correct",
    });

    expect(echoed.success).toBe(true);
  });
});
