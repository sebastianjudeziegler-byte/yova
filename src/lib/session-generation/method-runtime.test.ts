import { describe, expect, it } from "vitest";
import { GeneratedSessionActivitySchema } from "@/lib/session-generation/schema";
import {
  MethodRuntimeSchema,
  hasMethodRuntime,
  methodRuntimeKindFor,
  methodRuntimeMismatch,
  validateAttachedMethodRuntimes,
  type MethodRuntime,
} from "@/lib/session-generation/method-runtime";

const retrievalRound: MethodRuntime = {
  kind: "retrieval_round",
  sourceClosedReminder: "Close your notes before answering anything below.",
  prompts: [
    { prompt: "What does NADH carry?", expectedAnswer: "High-energy electrons", hint: null },
    { prompt: "Where does the Krebs cycle occur?", expectedAnswer: "Mitochondrial matrix", hint: null },
    { prompt: "What is FADH2 for?", expectedAnswer: "Carrying electrons to complex II", hint: null },
  ],
};

function workedExample(overrides: Partial<Extract<MethodRuntime, { kind: "worked_example" }>> = {}) {
  return {
    kind: "worked_example" as const,
    problem: "Differentiate y = x^2 sin x",
    steps: [
      { statement: "Identify u and v", why: "The product rule needs both factors named before differentiating." },
      { statement: "Form uv' + vu'", why: "Each factor changes, so both contributions must be counted." },
    ],
    fadedProblem: "Differentiate y = x^3 cos x",
    fadedSteps: [
      { statement: "Identify u and v", prompt: null, expectedAnswer: null },
      { statement: "Form the derivative", prompt: "What is the full derivative?", expectedAnswer: "3x^2 cos x - x^3 sin x" },
    ],
    ...overrides,
  };
}

describe("method runtime schema", () => {
  it("accepts a well-formed retrieval round", () => {
    expect(MethodRuntimeSchema.parse(retrievalRound).kind).toBe("retrieval_round");
  });

  it("rejects a retrieval round too small to be a round", () => {
    expect(() => MethodRuntimeSchema.parse({
      ...retrievalRound,
      prompts: retrievalRound.prompts.slice(0, 1),
    })).toThrow();
  });

  it("accepts a worked example that fades at least one step", () => {
    expect(MethodRuntimeSchema.parse(workedExample()).kind).toBe("worked_example");
  });

  it("rejects a worked example where nothing is actually faded", () => {
    expect(() => MethodRuntimeSchema.parse(workedExample({
      fadedSteps: [
        { statement: "Identify u and v", prompt: null, expectedAnswer: null },
        { statement: "Form the derivative", prompt: null, expectedAnswer: null },
      ],
    }))).toThrow(/at least one step the learner must supply/);
  });

  it("rejects a faded step with no answer to check against", () => {
    expect(() => MethodRuntimeSchema.parse(workedExample({
      fadedSteps: [
        { statement: "Identify u and v", prompt: null, expectedAnswer: null },
        { statement: "Form the derivative", prompt: "What is the derivative?", expectedAnswer: null },
      ],
    }))).toThrow(/expected answer/);
  });
});

describe("method runtime routing", () => {
  it("maps the methods that have a runtime", () => {
    expect(methodRuntimeKindFor("retrieval_practice")).toBe("retrieval_round");
    expect(methodRuntimeKindFor("spaced_retrieval")).toBe("retrieval_round");
    expect(methodRuntimeKindFor("worked_example_fading")).toBe("worked_example");
    expect(methodRuntimeKindFor("practice_test_error_repair")).toBe("error_repair");
  });

  it("leaves methods without a runtime on the generic path", () => {
    expect(methodRuntimeKindFor("self_explanation")).toBeNull();
    expect(hasMethodRuntime("self_explanation")).toBe(false);
  });

  it("accepts a runtime that matches the routed method", () => {
    expect(methodRuntimeMismatch("retrieval_practice", retrievalRound)).toBeNull();
  });

  it("catches a session claiming one method and delivering another", () => {
    expect(methodRuntimeMismatch("worked_example_fading", retrievalRound))
      .toContain("uses worked_example");
  });

  it("catches a runtime attached to a method that has none", () => {
    expect(methodRuntimeMismatch("self_explanation", retrievalRound))
      .toContain("does not use a method runtime");
  });

  it("allows a method with a runtime to still generate without one", () => {
    // Generation may fall back to the generic path; that is degraded, not invalid.
    expect(methodRuntimeMismatch("retrieval_practice", null)).toBeNull();
  });
});

describe("activities generated before method runtimes existed", () => {
  it("still parse, and carry no runtime", () => {
    const legacyActivity = {
      type: "instruction",
      methodPhase: "orient",
      topicId: null,
      concept: null,
      estimatedMinutes: 3,
      requiredForCompletion: true,
      label: "Orient",
      title: "What this session covers",
      body: "You will recall the stages of cellular respiration without your notes.",
      teaching: null,
      choices: [],
      correctAnswer: null,
      feedback: null,
    };

    const parsed = GeneratedSessionActivitySchema.parse(legacyActivity);
    expect(parsed.methodRuntime ?? null).toBeNull();
  });
});

describe("attached method runtimes", () => {
  it("accepts exactly one matching runtime", () => {
    expect(validateAttachedMethodRuntimes("retrieval_practice", [null, retrievalRound, null]))
      .toBeNull();
  });

  it("accepts a session that fell back to the generic path", () => {
    expect(validateAttachedMethodRuntimes("retrieval_practice", [null, null])).toBeNull();
  });

  it("rejects the same method being delivered twice in one session", () => {
    expect(validateAttachedMethodRuntimes("retrieval_practice", [retrievalRound, retrievalRound]))
      .toContain("attached to 2 activities");
  });

  it("rejects a runtime belonging to a different method", () => {
    expect(validateAttachedMethodRuntimes("worked_example_fading", [retrievalRound]))
      .toContain("uses worked_example");
  });
});
