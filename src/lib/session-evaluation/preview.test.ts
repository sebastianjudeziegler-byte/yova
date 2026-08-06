import { describe, expect, it } from "vitest";
import { evaluatePreviewAnswer } from "@/lib/session-evaluation/preview";

const request = {
  planId: "00000000-0000-4000-8000-000000000001",
  planSessionId: "00000000-0000-4000-8000-000000000002",
  activity: {
    title: "Explain compound growth",
    prompt: "Explain why the gain can grow in the second year.",
    concept: "Compound growth",
    referenceAnswer: "Earlier gains remain in the base, so the same percentage can produce a larger gain later.",
    rubric: "A strong answer says that earlier gains remain in the base for later percentage growth.",
  },
  learnerAnswer: "Earlier gains stay in the base, so the same percentage acts on a larger amount later.",
} as const;

describe("preview answer evaluation", () => {
  it("recognizes an answer that contains the central relationship", () => {
    expect(evaluatePreviewAnswer(request).verdict).toBe("secure");
  });

  it("does not treat an unrelated answer as secure", () => {
    expect(evaluatePreviewAnswer({ ...request, learnerAnswer: "It is useful for budgeting." }).verdict).toBe("needs_review");
  });
});
