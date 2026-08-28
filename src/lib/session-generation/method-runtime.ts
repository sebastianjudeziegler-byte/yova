import { z } from "zod";
import type { CoreMethodId } from "@/lib/learning/method-catalog";

/**
 * Method-specific interaction data for a session activity.
 *
 * Activities carry four generic shapes: instruction, multiple choice, free
 * response, and reflection. Every method was previously flattened into those,
 * so a retrieval round and a worked example reached the learner as the same
 * screen with a different label. This block carries the structure a method
 * needs in order to be delivered as itself.
 *
 * The block is optional and defaults to null. Activities generated before it
 * existed parse unchanged and render through the original generic path, so no
 * saved session needs migrating.
 */

const PromptText = z.string().trim().min(3).max(320);
const AnswerText = z.string().trim().min(1).max(600);

const RetrievalPromptSchema = z.object({
  prompt: PromptText,
  expectedAnswer: AnswerText,
  /** Offered only after an attempt, never before. */
  hint: z.string().trim().min(4).max(240).nullable().default(null),
});

const BroadRecallTransferPromptSchema = z.object({
  /** The source must be closed again after gap repair. */
  sourceClosedReminder: z.string().trim().min(10).max(200),
  prompt: PromptText,
  expectedAnswer: AnswerText,
});

/**
 * Server-owned identity and assessment criteria for one routed Blurting target.
 * The object is strict because it is later safe to hand to the privacy-preserving
 * progress/evidence kernels; learner-authored drafts never belong in this block.
 */
export const BroadRecallRuntimeTargetBindingSchema = z.object({
  targetId: z.string().uuid(),
  evidenceId: z.string().min(1).max(200),
  concept: z.string().trim().min(2).max(120),
  comparisonCriterion: z.string().trim().min(8).max(240),
  transferSuccessCriterion: z.string().trim().min(8).max(240),
}).strict().superRefine((binding, context) => {
  if (binding.evidenceId !== broadRecallFinalCheckEvidenceId(binding.targetId)) {
    context.addIssue({
      code: "custom",
      path: ["evidenceId"],
      message: "A broad-recall target must use its exact final-check evidence identifier.",
    });
  }
});

/**
 * Retrieval practice and spaced retrieval. The learner must produce an answer
 * from memory before anything is revealed, which is the mechanism itself
 * rather than a presentation choice.
 */
export const RetrievalRoundRuntimeSchema = z.object({
  kind: z.literal("retrieval_round"),
  /** Missing means the original 3-10 prompt-set runtime used by saved sessions. */
  format: z.literal("broad_recall_v1").nullable().optional(),
  /** Shown before the first prompt so the learner closes the source first. */
  sourceClosedReminder: z.string().trim().min(10).max(200),
  prompts: z.array(RetrievalPromptSchema).min(1).max(10),
  /** Shown only after the learner has completed the broad closed-source recall. */
  comparisonInstructions: z.string().trim().min(10).max(320).nullable().optional(),
  /** A bounded source-comparison checklist; it never contains learner-authored text. */
  gapChecklist: z.array(z.string().trim().min(3).max(240)).min(1).max(6).nullable().optional(),
  correctionInstruction: z.string().trim().min(10).max(320).nullable().optional(),
  /** One different application after the learner repairs gaps and closes the source again. */
  transferPrompt: BroadRecallTransferPromptSchema.nullable().optional(),
  /** Missing on legacy retrieval rounds; mandatory for the dedicated broad-recall format. */
  targetBindings: z.array(BroadRecallRuntimeTargetBindingSchema)
    .min(1)
    .max(3)
    .nullable()
    .optional(),
}).superRefine((runtime, context) => {
  if (runtime.format !== "broad_recall_v1") {
    if (runtime.prompts.length < 3) {
      context.addIssue({
        code: "custom",
        path: ["prompts"],
        message: "The legacy retrieval prompt set requires 3 to 10 prompts.",
      });
    }
    return;
  }

  if (runtime.prompts.length !== 1) {
    context.addIssue({
      code: "custom",
      path: ["prompts"],
      message: "Broad recall requires exactly one minimally cued prompt.",
    });
  }
  if (runtime.prompts.some((prompt) => prompt.hint !== null)) {
    context.addIssue({
      code: "custom",
      path: ["prompts", 0, "hint"],
      message: "Broad recall must not cue the initial blurt with a hint.",
    });
  }
  if (!runtime.comparisonInstructions) {
    context.addIssue({
      code: "custom",
      path: ["comparisonInstructions"],
      message: "Broad recall requires delayed source-comparison instructions.",
    });
  }
  if (!runtime.gapChecklist) {
    context.addIssue({
      code: "custom",
      path: ["gapChecklist"],
      message: "Broad recall requires a bounded gap checklist.",
    });
  }
  if (!runtime.correctionInstruction) {
    context.addIssue({
      code: "custom",
      path: ["correctionInstruction"],
      message: "Broad recall requires a correction instruction.",
    });
  }
  if (!runtime.transferPrompt) {
    context.addIssue({
      code: "custom",
      path: ["transferPrompt"],
      message: "Broad recall requires one fresh closed-source transfer prompt.",
    });
  } else if (
    runtime.prompts[0]
    && normalizedPrompt(runtime.transferPrompt.prompt) === normalizedPrompt(runtime.prompts[0].prompt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["transferPrompt", "prompt"],
      message: "The transfer prompt must be fresh rather than a repeat of the broad prompt.",
    });
  }
  if (!runtime.targetBindings) {
    context.addIssue({
      code: "custom",
      path: ["targetBindings"],
      message: "Broad recall requires one to three server-owned target bindings.",
    });
  } else {
    reportDuplicateBroadRecallBindings(runtime.targetBindings, context);
  }
});

function normalizedPrompt(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function broadRecallFinalCheckEvidenceId(targetId: string) {
  return `blurting-final-check:${targetId}`;
}

function reportDuplicateBroadRecallBindings(
  bindings: readonly z.infer<typeof BroadRecallRuntimeTargetBindingSchema>[],
  context: z.RefinementCtx,
) {
  const targetIds = bindings.map((binding) => binding.targetId);
  const evidenceIds = bindings.map((binding) => binding.evidenceId);
  if (new Set(targetIds).size !== targetIds.length) {
    context.addIssue({
      code: "custom",
      path: ["targetBindings"],
      message: "Broad-recall target bindings must be unique.",
    });
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    context.addIssue({
      code: "custom",
      path: ["targetBindings"],
      message: "Broad-recall evidence bindings must be unique.",
    });
  }
}

/**
 * Worked examples with guidance fading. The first pass shows a complete
 * solution with reasoning; the second removes steps so support visibly
 * decreases within the same session.
 */
export const WorkedExampleRuntimeSchema = z.object({
  kind: z.literal("worked_example"),
  problem: z.string().trim().min(5).max(320),
  steps: z.array(z.object({
    statement: z.string().trim().min(2).max(240),
    /** Why this step is used, not merely what it is. */
    why: z.string().trim().min(10).max(300),
  })).min(2).max(8),
  fadedProblem: z.string().trim().min(5).max(320),
  fadedSteps: z.array(z.object({
    statement: z.string().trim().min(2).max(240),
    /** Null means the step is given; a prompt means the learner supplies it. */
    prompt: PromptText.nullable().default(null),
    expectedAnswer: AnswerText.nullable().default(null),
  })).min(2).max(8),
}).superRefine((runtime, context) => {
  const missing = runtime.fadedSteps.filter((step) => step.prompt !== null);
  if (missing.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["fadedSteps"],
      message: "Guidance fading requires at least one step the learner must supply.",
    });
  }
  if (missing.some((step) => !step.expectedAnswer)) {
    context.addIssue({
      code: "custom",
      path: ["fadedSteps"],
      message: "Every faded step needs an expected answer to check against.",
    });
  }
});

/**
 * Error repair. Reconstructs the learner's actual reasoning and contrasts the
 * rule they applied with the correct one, rather than restating the right
 * answer and moving on.
 */
export const ErrorRepairRuntimeSchema = z.object({
  kind: z.literal("error_repair"),
  observedError: z.string().trim().min(10).max(300),
  whyItSeemedReasonable: z.string().trim().min(10).max(300),
  incorrectRule: z.string().trim().min(5).max(240),
  correctRule: z.string().trim().min(5).max(240),
  /** The cue that this mistake is about to happen again. */
  warningSign: z.string().trim().min(5).max(240),
  correctedExample: z.string().trim().min(10).max(600),
  parallelPrompt: PromptText,
  parallelAnswer: AnswerText,
});

export const MethodRuntimeSchema = z.discriminatedUnion("kind", [
  RetrievalRoundRuntimeSchema,
  WorkedExampleRuntimeSchema,
  ErrorRepairRuntimeSchema,
]);

/** Input shape keeps fields defaulted by the parser optional for old resources. */
export type MethodRuntime = z.input<typeof MethodRuntimeSchema>;
export type MethodRuntimeKind = MethodRuntime["kind"];
export type BroadRecallRuntimeTargetBinding = z.infer<
  typeof BroadRecallRuntimeTargetBindingSchema
>;

/**
 * Which runtime a routed method should produce. Methods absent from this map
 * keep the generic activity path until their runtime is built, so adding a
 * runtime later is additive rather than a rewrite.
 */
const METHOD_RUNTIME_BY_METHOD: Partial<Record<CoreMethodId, MethodRuntimeKind>> = {
  retrieval_practice: "retrieval_round",
  spaced_retrieval: "retrieval_round",
  worked_example_fading: "worked_example",
  practice_test_error_repair: "error_repair",
};

export function methodRuntimeKindFor(methodId: CoreMethodId): MethodRuntimeKind | null {
  return METHOD_RUNTIME_BY_METHOD[methodId] ?? null;
}

export function hasMethodRuntime(methodId: CoreMethodId) {
  return methodRuntimeKindFor(methodId) !== null;
}

const RUNTIME_PROMPT_CONTRACTS: Record<MethodRuntimeKind, {
  requirement: string;
  fields: string[];
}> = {
  retrieval_round: {
    requirement:
      "Attach methodRuntime to the activity that carries the recall work. The learner must produce every "
      + "answer from memory before anything is revealed, so write prompts that can be answered without the "
      + "source open. Hints must repair a stalled attempt, never hand over the answer.",
    fields: [
      "sourceClosedReminder: one sentence telling the learner what to close or hide first",
      "prompts: 3 to 10 items, each with prompt, expectedAnswer, and an optional hint",
    ],
  },
  worked_example: {
    requirement:
      "Attach methodRuntime to the activity that carries the example work. Support must visibly decrease "
      + "inside the session: the first problem is fully solved with reasoning, the second removes at least "
      + "one step for the learner to supply. Never fade a step whose reasoning was not shown first.",
    fields: [
      "problem and steps: the fully solved example, each step with what it is and why it is used",
      "fadedProblem and fadedSteps: the same procedure with at least one step replaced by a prompt and expectedAnswer",
    ],
  },
  error_repair: {
    requirement:
      "Attach methodRuntime to the activity that carries the repair. Reconstruct the reasoning the learner "
      + "actually used and name the incorrect rule behind it. Restating the correct answer is not repair.",
    fields: [
      "observedError and whyItSeemedReasonable: the learner's actual reasoning, described without blame",
      "incorrectRule, correctRule, and warningSign: the contrast, plus the cue that it is recurring",
      "correctedExample, parallelPrompt, parallelAnswer: the fix, then a fresh item testing the same rule",
    ],
  },
};

/**
 * The contract handed to the model for the routed method. Returns null when the
 * method has no runtime yet, which keeps the generic activity path in use
 * instead of asking the model to invent a structure nothing can render.
 */
export function methodRuntimePromptContract(methodId: CoreMethodId) {
  const kind = methodRuntimeKindFor(methodId);
  if (!kind) return null;
  return { methodId, kind, ...RUNTIME_PROMPT_CONTRACTS[kind] };
}

/**
 * Guards against a generated runtime block that does not match the method the
 * router selected. Without this a session could claim one method and deliver
 * the interaction pattern of another.
 */
export function methodRuntimeMismatch(
  methodId: CoreMethodId,
  runtime: MethodRuntime | null,
  options: { allowBroadRecall?: boolean } = {},
): string | null {
  const expected = methodRuntimeKindFor(methodId);
  if (!runtime) return null;
  if (!expected) {
    return `The session produced a ${runtime.kind} runtime, but ${methodId} does not use a method runtime.`;
  }
  if (runtime.kind !== expected) {
    return `The session produced a ${runtime.kind} runtime for ${methodId}, which uses ${expected}.`;
  }
  if (
    runtime.kind === "retrieval_round"
    && runtime.format === "broad_recall_v1"
    && methodId !== "retrieval_practice"
  ) {
    return `The broad_recall_v1 retrieval format is exclusive to retrieval_practice, not ${methodId}.`;
  }
  if (
    runtime.kind === "retrieval_round"
    && runtime.format === "broad_recall_v1"
    && options.allowBroadRecall !== true
  ) {
    return "The broad_recall_v1 retrieval format is disabled unless the server explicitly allows it.";
  }
  return null;
}

/**
 * A session may fall back to the generic activity path, which is degraded but
 * valid. What it may never do is attach the interaction pattern of a different
 * method, or scatter runtime blocks across several activities so the learner
 * meets the same method twice inside one session.
 */
export function validateAttachedMethodRuntimes(
  methodId: CoreMethodId,
  runtimes: readonly (MethodRuntime | null)[],
  options: { allowBroadRecall?: boolean } = {},
): string | null {
  const attached = runtimes.filter((runtime): runtime is MethodRuntime => Boolean(runtime));
  const mismatched = attached
    .map((runtime) => methodRuntimeMismatch(methodId, runtime, options))
    .find(Boolean);
  return mismatched ?? null;
}

/**
 * Which activity keeps its runtime, because a method carries the work once.
 *
 * Generation regularly attaches the block to every activity rather than the one
 * that performs the work. That is a formatting slip, not a wrong method, and
 * rejecting the draft over it costs the learner the whole session and drops
 * them into a degraded fallback. Normalising keeps the correct interaction and
 * leaves genuine method mismatches to validation.
 */
export function methodRuntimeKeepIndex(
  methodId: CoreMethodId,
  runtimes: readonly (MethodRuntime | null | undefined)[],
): number {
  const expected = methodRuntimeKindFor(methodId);
  if (!expected) return -1;
  return runtimes.findIndex((runtime) => runtime?.kind === expected);
}
