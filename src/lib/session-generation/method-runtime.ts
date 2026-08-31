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

/**
 * Retrieval practice and spaced retrieval. The learner must produce an answer
 * from memory before anything is revealed, which is the mechanism itself
 * rather than a presentation choice.
 */
const RetrievalRoundRuntimeOutputSchema = z.object({
  kind: z.literal("retrieval_round"),
  /** Shown before the first prompt so the learner closes the source first. */
  sourceClosedReminder: z.string().trim().min(10).max(200),
  prompts: z.array(RetrievalPromptSchema).min(1).max(10),
});

export const RetrievalRoundRuntimeSchema = RetrievalRoundRuntimeOutputSchema.superRefine((runtime, context) => {
  if (runtime.prompts.length < 3) {
    context.addIssue({
      code: "custom",
      path: ["prompts"],
      message: "The legacy retrieval prompt set requires 3 to 10 prompts.",
    });
  }
});

/**
 * Worked examples with guidance fading. The first pass shows a complete
 * solution with reasoning; the second removes steps so support visibly
 * decreases within the same session.
 */
const WorkedExampleRuntimeOutputSchema = z.object({
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
});

export const WorkedExampleRuntimeSchema = WorkedExampleRuntimeOutputSchema.superRefine((runtime, context) => {
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

const ConceptMapNodeSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  label: z.string().trim().min(2).max(80),
}).strict();

const ConceptMapConnectionSchema = z.object({
  fromId: z.string().trim().min(1).max(40),
  toId: z.string().trim().min(1).max(40),
  prompt: z.string().trim().min(8).max(240),
  expectedRelationship: z.string().trim().min(3).max(240),
}).strict();

/**
 * Concept mapping. The resource stores only server-authored concepts and the
 * factual relationships used to check them. Learner-authored relationship
 * phrases stay in component state and the one-time answer-evaluation request;
 * they are never written into the generated resource.
 */
const ConceptMapRuntimeOutputSchema = z.object({
  kind: z.literal("concept_map"),
  instructions: z.string().trim().min(12).max(320),
  nodes: z.array(ConceptMapNodeSchema).min(3).max(8),
  connections: z.array(ConceptMapConnectionSchema).min(2).max(8),
}).strict();

export const ConceptMapRuntimeSchema = ConceptMapRuntimeOutputSchema.superRefine((runtime, context) => {
  const ids = runtime.nodes.map((node) => node.id);
  const labels = runtime.nodes.map((node) => node.label.toLocaleLowerCase());
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) {
    context.addIssue({ code: "custom", path: ["nodes"], message: "Concept-map node identifiers must be unique." });
  }
  if (new Set(labels).size !== labels.length) {
    context.addIssue({ code: "custom", path: ["nodes"], message: "Concept-map node labels must be unique." });
  }

  const connectionKeys = new Set<string>();
  runtime.connections.forEach((connection, index) => {
    if (!idSet.has(connection.fromId) || !idSet.has(connection.toId)) {
      context.addIssue({
        code: "custom",
        path: ["connections", index],
        message: "Every concept-map connection must reference two declared nodes.",
      });
    }
    if (connection.fromId === connection.toId) {
      context.addIssue({
        code: "custom",
        path: ["connections", index],
        message: "A concept-map connection must join two different concepts.",
      });
    }
    const key = `${connection.fromId}->${connection.toId}`;
    if (connectionKeys.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["connections", index],
        message: "Concept-map connections must be unique.",
      });
    }
    connectionKeys.add(key);
  });
});

/**
 * Provider-facing runtime schema. Cross-field method invariants remain in the
 * strict schemas below so they can enter YOVA's bounded repair flow instead of
 * surfacing as SDK parsing exceptions.
 */
export const MethodRuntimeProviderOutputSchema = z.discriminatedUnion("kind", [
  RetrievalRoundRuntimeOutputSchema,
  WorkedExampleRuntimeOutputSchema,
  ErrorRepairRuntimeSchema,
  ConceptMapRuntimeOutputSchema,
]);

export const MethodRuntimeSchema = z.discriminatedUnion("kind", [
  RetrievalRoundRuntimeSchema,
  WorkedExampleRuntimeSchema,
  ErrorRepairRuntimeSchema,
  ConceptMapRuntimeSchema,
]);

/** Input shape keeps fields defaulted by the parser optional for old resources. */
export type MethodRuntime = z.input<typeof MethodRuntimeSchema>;
export type MethodRuntimeKind = MethodRuntime["kind"];

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
  concept_mapping: "concept_map",
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
  concept_map: {
    requirement:
      "Attach methodRuntime to the free-response connect activity. Give the learner three to eight named "
      + "concept nodes and two to eight factual connections to construct with explicit relationship phrases. "
      + "Do not include learner-authored text or decorative, uncheckable links.",
    fields: [
      "instructions: a short direction to connect the named concepts with relationship phrases",
      "nodes: unique stable ids and concise learner-facing concept labels",
      "connections: fromId, toId, a relationship prompt, and the factual expectedRelationship",
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
): string | null {
  const expected = methodRuntimeKindFor(methodId);
  if (!runtime) {
    return methodId === "concept_mapping"
      ? "Concept mapping requires its dedicated relationship-building runtime."
      : null;
  }
  if (!expected) {
    return `The session produced a ${runtime.kind} runtime, but ${methodId} does not use a method runtime.`;
  }
  if (runtime.kind !== expected) {
    return `The session produced a ${runtime.kind} runtime for ${methodId}, which uses ${expected}.`;
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
): string | null {
  const attached = runtimes.filter((runtime): runtime is MethodRuntime => Boolean(runtime));
  if (methodId === "concept_mapping" && attached.length === 0) {
    return methodRuntimeMismatch(methodId, null);
  }
  const mismatched = attached
    .map((runtime) => methodRuntimeMismatch(methodId, runtime))
    .find(Boolean);
  return mismatched ?? null;
}

export function validateMethodRuntimeActivities(
  methodId: CoreMethodId,
  activities: readonly {
    type: string;
    methodPhase?: string | null;
    correctAnswer?: string | null;
    methodRuntime?: MethodRuntime | null;
  }[],
): string | null {
  const runtimeIssue = validateAttachedMethodRuntimes(
    methodId,
    activities.map((activity) => activity.methodRuntime ?? null),
  );
  if (runtimeIssue) return runtimeIssue;
  if (methodId !== "concept_mapping") return null;

  const mappedActivities = activities.filter((activity) => activity.methodRuntime?.kind === "concept_map");
  if (mappedActivities.length !== 1) {
    return "Concept mapping requires exactly one dedicated relationship-building activity.";
  }
  const [activity] = mappedActivities;
  if (activity?.type !== "free_response" || activity.methodPhase !== "connect") {
    return "The concept-map runtime must be attached to the free-response connect phase.";
  }
  const answer = normalizeRuntimeAnswer(activity.correctAnswer ?? "");
  const missingRelationship = activity.methodRuntime?.kind === "concept_map"
    ? activity.methodRuntime.connections.find((connection) => (
      !answer.includes(normalizeRuntimeAnswer(connection.expectedRelationship))
    ))
    : null;
  if (missingRelationship) {
    return "The concept-map model answer must include every exact reference relationship shown after checking.";
  }
  return null;
}

function normalizeRuntimeAnswer(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
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
