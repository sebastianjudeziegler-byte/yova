import { describe, expect, it } from "vitest";
import {
  GeneratedScopeJudgmentSchema,
  ScopeJudgmentSchema,
} from "@/lib/knowledge-map/schema";

const validScopeJudgment = {
  band: "unit_or_exam" as const,
  label: "Derivative rules for Calc Unit 3",
  minimumSessions: 3,
  recommendedSessions: 5,
  maximumSessions: 7,
  minimumTeachingSessions: 3,
  explanation: "The learner needs several connected derivative rules for an upcoming unit test.",
};

describe("scope judgment labels", () => {
  it("keeps legacy persisted labels readable while rejecting incomplete new output", () => {
    const persisted = {
      ...validScopeJudgment,
      label: "Calc Unit 3 test on derivative basics and implicit on",
    };

    expect(ScopeJudgmentSchema.safeParse(persisted).success).toBe(true);
    expect(GeneratedScopeJudgmentSchema.safeParse(persisted).success).toBe(false);
  });

  it.each([
    "Derivative rules and",
    "Derivative rules THE",
    "Derivative rules of.",
    "Derivative rules To",
    "Derivative rules on",
    "Derivative rules because",
    "Derivative rules whereas",
    "Derivative rules including",
    "Derivative rules concerning",
  ])("rejects a generated label ending in a dangling word: %s", (label) => {
    expect(GeneratedScopeJudgmentSchema.safeParse({
      ...validScopeJudgment,
      label,
    }).success).toBe(false);
  });

  it("accepts a concise complete generated label", () => {
    expect(GeneratedScopeJudgmentSchema.safeParse(validScopeJudgment).success).toBe(true);
  });

  it.each([
    "Greater Than and Less Than",
    "Plus and Minus",
  ])("keeps a complete mathematical phrase ending in a content word: %s", (label) => {
    expect(GeneratedScopeJudgmentSchema.safeParse({
      ...validScopeJudgment,
      label,
    }).success).toBe(true);
  });
});
