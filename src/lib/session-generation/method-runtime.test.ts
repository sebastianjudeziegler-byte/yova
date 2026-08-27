import { describe, expect, it } from "vitest";
import { GeneratedSessionActivitySchema } from "@/lib/session-generation/schema";
import {
  MethodRuntimeSchema,
  hasMethodRuntime,
  methodRuntimeKindFor,
  methodRuntimeMismatch,
  methodRuntimeKeepIndex,
  validateAttachedMethodRuntimes,
  type MethodRuntime,
} from "@/lib/session-generation/method-runtime";

const TARGET_A = "11111111-1111-4111-8111-111111111111";
const TARGET_B = "22222222-2222-4222-8222-222222222222";

const retrievalRound: MethodRuntime = {
  kind: "retrieval_round",
  sourceClosedReminder: "Close your notes before answering anything below.",
  prompts: [
    { prompt: "What does NADH carry?", expectedAnswer: "High-energy electrons", hint: null },
    { prompt: "Where does the Krebs cycle occur?", expectedAnswer: "Mitochondrial matrix", hint: null },
    { prompt: "What is FADH2 for?", expectedAnswer: "Carrying electrons to complex II", hint: null },
  ],
};

const broadRecallRound: MethodRuntime = {
  kind: "retrieval_round",
  format: "broad_recall_v1",
  sourceClosedReminder: "Close the source before writing everything you can reconstruct.",
  prompts: [{
    prompt: "Reconstruct the complete role of electron carriers in cellular respiration.",
    expectedAnswer: "NADH and FADH2 carry high-energy electrons to the electron transport chain.",
    hint: null,
  }],
  comparisonInstructions: "Only after the recall attempt, reopen the source and compare it line by line.",
  gapChecklist: [
    "Which carriers were named?",
    "Where does each carrier deliver its electrons?",
  ],
  correctionInstruction: "Correct only the missing or inaccurate relationships in your own words.",
  transferPrompt: {
    sourceClosedReminder: "Close the source again before answering the transfer question.",
    prompt: "Predict what changes if complex II can no longer accept electrons from FADH2.",
    expectedAnswer: "FADH2-derived electrons would not enter through complex II, reducing downstream proton pumping and ATP production.",
  },
  targetBindings: [{
    targetId: TARGET_A,
    evidenceId: `blurting-final-check:${TARGET_A}`,
    concept: "Electron-carrier roles",
    comparisonCriterion: "Names each carrier and its exact delivery point in the pathway.",
    transferSuccessCriterion: "Predicts the downstream consequence of blocking the carrier pathway.",
  }, {
    targetId: TARGET_B,
    evidenceId: `blurting-final-check:${TARGET_B}`,
    concept: "Electron transport consequences",
    comparisonCriterion: "Connects electron transfer to proton pumping and ATP production.",
    transferSuccessCriterion: "Explains the causal effect on proton pumping and ATP production.",
  }],
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

  it("keeps a missing format on the legacy 3-10 prompt-set contract", () => {
    const before = JSON.stringify(retrievalRound);
    const parsed = MethodRuntimeSchema.parse(retrievalRound);

    expect(parsed).toEqual(retrievalRound);
    expect(JSON.stringify(parsed)).toBe(before);
    expect(parsed).not.toHaveProperty("format");
    expect(parsed).not.toHaveProperty("comparisonInstructions");
    expect(parsed).not.toHaveProperty("gapChecklist");
    expect(parsed).not.toHaveProperty("correctionInstruction");
    expect(parsed).not.toHaveProperty("transferPrompt");
    expect(parsed).not.toHaveProperty("targetBindings");
  });

  it("accepts one complete broad-recall sequence without retaining learner text", () => {
    const parsed = MethodRuntimeSchema.parse({
      ...broadRecallRound,
      learnerText: "This draft must never enter the resource.",
      prompts: [{
        ...broadRecallRound.prompts[0],
        learnerAnswer: "Neither should this nested draft.",
      }],
    });

    expect(parsed).toMatchObject({
      format: "broad_recall_v1",
      prompts: [{ prompt: broadRecallRound.prompts[0].prompt }],
      gapChecklist: broadRecallRound.gapChecklist,
      transferPrompt: { prompt: broadRecallRound.transferPrompt?.prompt },
      targetBindings: broadRecallRound.targetBindings,
    });
    expect(parsed).not.toHaveProperty("learnerText");
    expect(parsed.kind).toBe("retrieval_round");
    if (parsed.kind === "retrieval_round") {
      expect(parsed.prompts[0]).not.toHaveProperty("learnerAnswer");
    }
  });

  it("requires exactly one prompt and every compare-repair-transfer stage for broad recall", () => {
    expect(() => MethodRuntimeSchema.parse({
      ...broadRecallRound,
      prompts: retrievalRound.prompts,
    })).toThrow(/exactly one minimally cued prompt/);
  });

  it.each([
    ["comparisonInstructions", /delayed source-comparison instructions/],
    ["gapChecklist", /bounded gap checklist/],
    ["correctionInstruction", /correction instruction/],
    ["transferPrompt", /fresh closed-source transfer prompt/],
    ["targetBindings", /server-owned target bindings/],
  ] as const)("requires the broad-recall %s stage", (field, expectedError) => {
    expect(() => MethodRuntimeSchema.parse({
      ...broadRecallRound,
      [field]: null,
    })).toThrow(expectedError);
  });

  it("forbids a hint on the minimally cued broad prompt", () => {
    expect(() => MethodRuntimeSchema.parse({
      ...broadRecallRound,
      prompts: [{
        ...broadRecallRound.prompts[0],
        hint: "Think about NADH first.",
      }],
    })).toThrow(/must not cue the initial blurt/);
  });

  it("bounds broad-recall gap checklists to 1-6 items", () => {
    expect(() => MethodRuntimeSchema.parse({
      ...broadRecallRound,
      gapChecklist: [],
    })).toThrow();
    expect(() => MethodRuntimeSchema.parse({
      ...broadRecallRound,
      gapChecklist: Array.from({ length: 7 }, (_, index) => `Gap ${index + 1}`),
    })).toThrow();
  });

  it("requires a fresh transfer prompt after source comparison", () => {
    expect(() => MethodRuntimeSchema.parse({
      ...broadRecallRound,
      transferPrompt: {
        ...broadRecallRound.transferPrompt,
        prompt: `  ${broadRecallRound.prompts[0].prompt.toLocaleUpperCase()}  `,
      },
    })).toThrow(/must be fresh/);
  });

  it("keeps one to three ordered server-owned target and evidence bindings", () => {
    const parsed = MethodRuntimeSchema.parse(broadRecallRound);

    expect(parsed.kind === "retrieval_round" ? parsed.targetBindings : null).toEqual(
      broadRecallRound.targetBindings,
    );
  });

  it("rejects noncanonical and duplicate broad-recall bindings", () => {
    const bindings = broadRecallRound.kind === "retrieval_round"
      ? broadRecallRound.targetBindings!
      : [];
    expect(() => MethodRuntimeSchema.parse({
      ...broadRecallRound,
      targetBindings: [{ ...bindings[0]!, evidenceId: "different-evidence" }],
    })).toThrow(/exact final-check evidence identifier/);
    expect(() => MethodRuntimeSchema.parse({
      ...broadRecallRound,
      targetBindings: [bindings[0], bindings[0]],
    })).toThrow(/target bindings must be unique/);
  });

  it("requires complete bounded binding criteria", () => {
    const binding = broadRecallRound.kind === "retrieval_round"
      ? broadRecallRound.targetBindings![0]!
      : null;
    expect(() => MethodRuntimeSchema.parse({
      ...broadRecallRound,
      targetBindings: [{ ...binding, comparisonCriterion: undefined }],
    })).toThrow();
    expect(() => MethodRuntimeSchema.parse({
      ...broadRecallRound,
      targetBindings: Array.from({ length: 4 }, (_, index) => ({
        ...binding,
        targetId: `${index + 1}1111111-1111-4111-8111-111111111111`,
        evidenceId: `blurting-final-check:${index + 1}1111111-1111-4111-8111-111111111111`,
      })),
    })).toThrow();
  });

  it("rejects learner-authored text inside a server-owned target binding", () => {
    const binding = broadRecallRound.kind === "retrieval_round"
      ? broadRecallRound.targetBindings![0]!
      : null;
    expect(() => MethodRuntimeSchema.parse({
      ...broadRecallRound,
      targetBindings: [{
        ...binding,
        learnerAnswer: "PRIVATE LEARNER ANSWER",
      }],
    })).toThrow(/unrecognized key/i);
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

  it("fails closed on broad recall unless the server explicitly allows it", () => {
    expect(methodRuntimeMismatch("retrieval_practice", broadRecallRound))
      .toContain("disabled unless the server explicitly allows it");
    expect(methodRuntimeMismatch("retrieval_practice", broadRecallRound, {
      allowBroadRecall: true,
    })).toBeNull();
  });

  it("keeps broad recall exclusive to retrieval practice", () => {
    expect(methodRuntimeMismatch("spaced_retrieval", broadRecallRound, {
      allowBroadRecall: true,
    }))
      .toContain("exclusive to retrieval_practice");
    expect(methodRuntimeMismatch("spaced_retrieval", retrievalRound)).toBeNull();
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

  it("keeps attached broad recall disabled without an explicit server allowance", () => {
    expect(validateAttachedMethodRuntimes("retrieval_practice", [broadRecallRound]))
      .toContain("disabled unless the server explicitly allows it");
    expect(validateAttachedMethodRuntimes("retrieval_practice", [broadRecallRound], {
      allowBroadRecall: true,
    })).toBeNull();
  });

  it("accepts a session that fell back to the generic path", () => {
    expect(validateAttachedMethodRuntimes("retrieval_practice", [null, null])).toBeNull();
  });

  it("does not reject a session merely for over-attaching the same runtime", () => {
    // Over-attaching is a formatting slip. Rejecting it would drop the learner
    // into a degraded fallback for a session that is otherwise correct.
    expect(validateAttachedMethodRuntimes("retrieval_practice", [retrievalRound, retrievalRound]))
      .toBeNull();
  });

  it("rejects a runtime belonging to a different method", () => {
    expect(validateAttachedMethodRuntimes("worked_example_fading", [retrievalRound]))
      .toContain("uses worked_example");
  });
});

describe("choosing which activity carries the method", () => {
  it("keeps the first activity whose runtime matches the routed method", () => {
    expect(methodRuntimeKeepIndex("retrieval_practice", [null, retrievalRound, retrievalRound]))
      .toBe(1);
  });

  it("keeps nothing when the method has no runtime", () => {
    expect(methodRuntimeKeepIndex("self_explanation", [retrievalRound])).toBe(-1);
  });

  it("keeps nothing when no runtime matches the routed method", () => {
    expect(methodRuntimeKeepIndex("worked_example_fading", [retrievalRound, null])).toBe(-1);
  });

  it("keeps nothing when the session generated no runtime at all", () => {
    expect(methodRuntimeKeepIndex("retrieval_practice", [null, null])).toBe(-1);
  });
});
