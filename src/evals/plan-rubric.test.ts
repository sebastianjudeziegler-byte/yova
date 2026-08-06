import { describe, expect, it } from "vitest";
import { buildPlanEvaluationCases } from "@/evals/plan-cases";
import { evaluatePlanDraft } from "@/evals/plan-rubric";
import { GeneratedPlanDraftSchema } from "@/lib/plan-generation/schema";

describe("evaluatePlanDraft", () => {
  const evaluationCase = buildPlanEvaluationCases(new Date("2026-08-05T12:00:00.000Z"))[1];

  it("accepts a task-aligned, time-bounded calculus plan", () => {
    const draft = GeneratedPlanDraftSchema.parse({
      title: "Derivative Rules",
      topic: "Product and quotient rules",
      kind: "topic",
      deadline: evaluationCase.request.deadline,
      rationale: "Worked examples establish the decision process before support fades into mixed independent practice.",
      sessions: [
        session(1, "Study worked examples", "Trace complete product-rule examples and explain each decision.", "Worked examples", "Examples come first because the learner cannot yet choose the rule independently."),
        session(2, "Solve with fading support", "Complete similar problems with fewer prompts.", "Faded problem practice", "Support fades after one complete model so the learner performs more of each step."),
        session(3, "Mixed independent practice", "Solve mixed product-rule and quotient-rule problems.", "Mixed practice", "Mixed problems check whether the learner can select the correct rule without a label."),
      ],
    });

    expect(evaluatePlanDraft(draft, evaluationCase.request, evaluationCase.taskFamily)).toMatchObject({
      passed: true,
      score: 100,
      requiredFailures: [],
    });
  });

  it("rejects a generic plan that is too long and overclaims a learning style", () => {
    const draft = GeneratedPlanDraftSchema.parse({
      title: "Derivative Rules",
      topic: "Product and quotient rules",
      kind: "topic",
      deadline: evaluationCase.request.deadline,
      rationale: "Because you are a visual learner, you learn best from summaries.",
      sessions: [
        session(1, "Read a summary", "Read a general summary of the chapter.", "Passive reading", "This is a generic first activity that does not use the task evidence.", 60),
        session(2, "Read another summary", "Read another general summary of the chapter.", "Passive reading", "This repeats the same generic activity without meaningful progression.", 60),
      ],
    });

    const result = evaluatePlanDraft(draft, evaluationCase.request, evaluationCase.taskFamily);
    expect(result.passed).toBe(false);
    expect(result.requiredFailures).toContain("Methods fit the task");
    expect(result.requiredFailures).toContain("No fixed brain or learning-style claims");
  });
});

function session(sequence: number, title: string, objective: string, method: string, methodReason: string, estimatedMinutes = 25) {
  const scheduledTimes = [
    "2026-08-08T09:00:00-07:00",
    "2026-08-10T18:00:00-07:00",
    "2026-08-12T15:00:00-07:00",
  ];
  return {
    title,
    objective,
    method,
    methodReason,
    scheduledFor: scheduledTimes[sequence - 1],
    estimatedMinutes,
    amountLabel: `${estimatedMinutes} minutes of focused work`,
    learningMode: sequence < 3 ? "learn" as const : "study" as const,
  };
}
