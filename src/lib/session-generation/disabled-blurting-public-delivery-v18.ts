import { z } from "zod";
import { BROAD_RECALL_TRANSFER_RESULTS } from "@/lib/learning/broad-recall-progress";
import {
  DisabledBlurtingCanonicalInstantV18Schema,
  disabledBlurtingCanonicalTextV18Schema,
} from "@/lib/session-generation/disabled-blurting-canonical-domain-v18";
import {
  BLURTING_PHASE_IDS,
  blurtingFinalCheckEvidenceId,
} from "@/lib/study-route/method-recipe-contract";

/**
 * Browser-safe shapes for a possible V18 Blurting delivery.
 *
 * This module deliberately does not import the full V18 cache/resource shape.
 * It is a disabled projection contract only: parsing any value here grants no
 * cache, route, source, evaluator, or rendering authority.
 */
export const DISABLED_BLURTING_PUBLIC_SCHEMA_VERSION = 18 as const;
export const DISABLED_BLURTING_PUBLIC_BOUNDARY =
  "disabled_public_contract_only" as const;
export const DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION =
  "blurting_target_evaluator_v1" as const;
export const DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS = 2;
export const DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS = 3_000;
export const DisabledBlurtingCanonicalUuidV18Schema = z.string().uuid().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "V18 database-bound UUIDs require canonical lowercase RFC version and variant bits.",
);

const CompatibilityResourceFingerprintSchema = z.string()
  .regex(/^sr1:[0-9a-f]{16}$/);
const ActivityIndexSchema = z.number().int().min(0).max(23);
const DisplayTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 2,
  maxCodePoints: 120,
});
const PromptTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 3,
  maxCodePoints: 320,
});
const ReminderTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 10,
  maxCodePoints: 200,
});
const InstructionTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 10,
  maxCodePoints: 320,
});
const ReferenceAnswerSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 1,
  maxCodePoints: 600,
});
const ExtendedReferenceAnswerSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 1,
  maxCodePoints: 1_200,
});
const GapTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 3,
  maxCodePoints: 240,
});
const LearnerAnswerSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS,
  maxCodePoints: DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS,
});

export const DisabledBlurtingPublicResourceIdentityV18Schema = z.object({
  planId: DisabledBlurtingCanonicalUuidV18Schema,
  sessionId: DisabledBlurtingCanonicalUuidV18Schema,
  routeRevisionId: DisabledBlurtingCanonicalUuidV18Schema,
  /** Compatibility identity only; never assessment or source authority. */
  resourceFingerprint: CompatibilityResourceFingerprintSchema,
  resourceGeneratedAt: DisabledBlurtingCanonicalInstantV18Schema,
}).strict();

export const DisabledBlurtingPublicIdentityV18Schema =
  DisabledBlurtingPublicResourceIdentityV18Schema.extend({
  /** Opaque lookup handle. It is not a permit or bearer credential. */
  deliveryHandle: DisabledBlurtingCanonicalUuidV18Schema,
  /** Exact execution run bound by the server-loaded delivery receipt. */
  runId: DisabledBlurtingCanonicalUuidV18Schema,
  activityIndex: ActivityIndexSchema,
}).strict();

const PublicTargetSchema = z.object({
  targetId: DisabledBlurtingCanonicalUuidV18Schema,
  evidenceId: z.string().min(1).max(200),
  displayLabel: DisplayTextSchema,
}).strict().superRefine(requireExactFinalCheckEvidenceId);

const PublicResultBindingSchema = z.object({
  targetId: DisabledBlurtingCanonicalUuidV18Schema,
  evidenceId: z.string().min(1).max(200),
  result: z.enum(BROAD_RECALL_TRANSFER_RESULTS),
}).strict().superRefine(requireExactFinalCheckEvidenceId);

const PublicReferenceBindingSchema = z.object({
  targetId: DisabledBlurtingCanonicalUuidV18Schema,
  evidenceId: z.string().min(1).max(200),
  referenceAnswer: ExtendedReferenceAnswerSchema,
}).strict().superRefine(requireExactFinalCheckEvidenceId);

const RetrievePhaseMetadataSchema = z.object({
  phaseId: z.literal(BLURTING_PHASE_IDS[0]),
  methodPhase: z.literal("retrieve"),
  activeMinutes: z.number().int().min(1).max(20),
  targetIds: z.array(DisabledBlurtingCanonicalUuidV18Schema).min(1).max(3),
}).strict();

const RepairPhaseMetadataSchema = z.object({
  phaseId: z.literal(BLURTING_PHASE_IDS[1]),
  methodPhase: z.literal("repair"),
  activeMinutes: z.number().int().min(1).max(20),
  targetIds: z.array(DisabledBlurtingCanonicalUuidV18Schema).min(1).max(3),
}).strict();

const TransferPhaseMetadataSchema = z.object({
  phaseId: z.literal(BLURTING_PHASE_IDS[2]),
  methodPhase: z.literal("transfer"),
  activeMinutes: z.number().int().min(1).max(20),
  targetIds: z.array(DisabledBlurtingCanonicalUuidV18Schema).min(1).max(3),
}).strict();

const PublicDeliveryBaseShape = {
  schemaVersion: z.literal(DISABLED_BLURTING_PUBLIC_SCHEMA_VERSION),
  boundaryStatus: z.literal(DISABLED_BLURTING_PUBLIC_BOUNDARY),
  identity: DisabledBlurtingPublicIdentityV18Schema,
  orderedTargets: z.array(PublicTargetSchema).min(1).max(3),
  phaseMetadata: z.tuple([
    RetrievePhaseMetadataSchema,
    RepairPhaseMetadataSchema,
    TransferPhaseMetadataSchema,
  ]),
  gapCount: z.number().int().min(1).max(6),
} as const;

/** Reusable browser-safe resource template; it contains no run identity. */
export const DisabledBlurtingPublicResourceTemplateV18Schema = z.object({
  schemaVersion: z.literal(DISABLED_BLURTING_PUBLIC_SCHEMA_VERSION),
  boundaryStatus: z.literal("disabled_public_resource_template_only"),
  identity: DisabledBlurtingPublicResourceIdentityV18Schema,
  orderedTargets: z.array(PublicTargetSchema).min(1).max(3),
  phaseMetadata: z.tuple([
    RetrievePhaseMetadataSchema,
    RepairPhaseMetadataSchema,
    TransferPhaseMetadataSchema,
  ]),
  gapCount: z.number().int().min(1).max(6),
  initialRecall: z.object({
    sourceClosedReminder: ReminderTextSchema,
    prompt: PromptTextSchema,
  }).strict(),
}).strict().superRefine(reportPublicEnvelopeIssues);

/** Initial public bootstrap: no answer, criterion, source, or later prompt. */
export const DisabledBlurtingPublicBootstrapV18Schema = z.object({
  ...PublicDeliveryBaseShape,
  stage: z.literal("recall"),
  sourceClosedReminder: ReminderTextSchema,
  prompt: PromptTextSchema,
}).strict().superRefine(reportPublicEnvelopeIssues);

/** Available only after a completed closed-source recall attempt. */
export const DisabledBlurtingCompareDisclosureV18Schema = z.object({
  ...PublicDeliveryBaseShape,
  stage: z.literal("compare"),
  comparisonInstructions: InstructionTextSchema,
  savedSourceAnswer: ReferenceAnswerSchema,
  gapChecklist: z.array(GapTextSchema).min(1).max(6),
}).strict().superRefine((delivery, context) => {
  reportPublicEnvelopeIssues(delivery, context);
  if (delivery.gapChecklist.length !== delivery.gapCount) {
    context.addIssue({
      code: "custom",
      path: ["gapChecklist"],
      message: "The comparison checklist must match the public gap count.",
    });
  }
});

/** Source-closed repair disclosure; comparison material is absent from this DTO. */
export const DisabledBlurtingRepairDisclosureV18Schema = z.object({
  ...PublicDeliveryBaseShape,
  stage: z.literal("repair"),
  sourceClosedReminder: ReminderTextSchema,
  correctionInstruction: InstructionTextSchema,
}).strict().superRefine(reportPublicEnvelopeIssues);

const TransferAnswerConstraintsSchema = z.object({
  minCharacters: z.literal(DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS),
  maxCharacters: z.literal(DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS),
}).strict();

/** Fresh transfer prompt; its answer and evaluator criteria are absent. */
export const DisabledBlurtingTransferDisclosureV18Schema = z.object({
  ...PublicDeliveryBaseShape,
  stage: z.literal("transfer"),
  sourceClosedReminder: ReminderTextSchema,
  prompt: PromptTextSchema,
  answerConstraints: TransferAnswerConstraintsSchema,
}).strict().superRefine(reportPublicEnvelopeIssues);

/**
 * Safe response projection of a server-loaded completion receipt. The receipt
 * handle is non-bearer: every future use must re-authenticate and re-bind the
 * owner, route, delivery handle, and ordered target vector on the server.
 */
export const DisabledBlurtingVerifiedCompletionProjectionV18Schema = z.object({
  evaluationReceiptHandle: DisabledBlurtingCanonicalUuidV18Schema,
  requestToken: DisabledBlurtingCanonicalUuidV18Schema,
  evaluatorVersion: z.literal(DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION),
  resolution: z.enum(["evaluated", "evaluator_unavailable"]),
  orderedResults: z.array(PublicResultBindingSchema).min(1).max(3),
}).strict().superRefine((completion, context) => {
  reportDuplicateBindings(completion.orderedResults, context, ["orderedResults"]);
  if (
    completion.resolution === "evaluator_unavailable"
    && completion.orderedResults.some((binding) => binding.result !== "unverified")
  ) {
    context.addIssue({
      code: "custom",
      path: ["orderedResults"],
      message: "Evaluator unavailability must leave every target unverified.",
    });
  }
});

/** Post-check disclosure; no comparison criterion or evaluator rubric leaks. */
export const DisabledBlurtingCompleteDisclosureV18Schema = z.object({
  ...PublicDeliveryBaseShape,
  stage: z.literal("complete"),
  orderedReferences: z.array(PublicReferenceBindingSchema).min(1).max(3),
  completion: DisabledBlurtingVerifiedCompletionProjectionV18Schema,
}).strict().superRefine((delivery, context) => {
  reportPublicEnvelopeIssues(delivery, context);
  reportDuplicateBindings(delivery.orderedReferences, context, ["orderedReferences"]);
  if (!sameOrderedBindings(delivery.orderedTargets, delivery.orderedReferences)) {
    context.addIssue({
      code: "custom",
      path: ["orderedReferences"],
      message: "Completion references must match the exact public target order.",
    });
  }
  if (!sameOrderedBindings(delivery.orderedTargets, delivery.completion.orderedResults)) {
    context.addIssue({
      code: "custom",
      path: ["completion", "orderedResults"],
      message: "Completion results must match the exact public target order.",
    });
  }
});

export const DisabledBlurtingPublicDeliveryV18Schema = z.union([
  DisabledBlurtingPublicBootstrapV18Schema,
  DisabledBlurtingCompareDisclosureV18Schema,
  DisabledBlurtingRepairDisclosureV18Schema,
  DisabledBlurtingTransferDisclosureV18Schema,
  DisabledBlurtingCompleteDisclosureV18Schema,
]);

/**
 * Pure JSON transport DTO for the evaluator. AbortSignal remains an in-memory
 * request concern and semantic criteria remain server-private.
 */
export const DisabledBlurtingEvaluatorTransportV18Schema = z.object({
  schemaVersion: z.literal(DISABLED_BLURTING_PUBLIC_SCHEMA_VERSION),
  boundaryStatus: z.literal("disabled_evaluator_transport_only"),
  requestToken: DisabledBlurtingCanonicalUuidV18Schema,
  identity: DisabledBlurtingPublicIdentityV18Schema,
  orderedBindings: z.array(z.object({
    targetId: DisabledBlurtingCanonicalUuidV18Schema,
    evidenceId: z.string().min(1).max(200),
  }).strict().superRefine(requireExactFinalCheckEvidenceId)).min(1).max(3),
  learnerAnswer: LearnerAnswerSchema,
}).strict().superRefine((transport, context) => {
  reportDuplicateBindings(transport.orderedBindings, context, ["orderedBindings"]);
});

/** Content-free diagnostic shape safe for structured logs. */
export const DisabledBlurtingSafeDiagnosticV18Schema = z.object({
  schemaVersion: z.literal(DISABLED_BLURTING_PUBLIC_SCHEMA_VERSION),
  boundaryStatus: z.literal("disabled_safe_diagnostic_only"),
  deliveryHandle: DisabledBlurtingCanonicalUuidV18Schema,
  runId: DisabledBlurtingCanonicalUuidV18Schema,
  planId: DisabledBlurtingCanonicalUuidV18Schema,
  sessionId: DisabledBlurtingCanonicalUuidV18Schema,
  routeRevisionId: DisabledBlurtingCanonicalUuidV18Schema,
  activityIndex: ActivityIndexSchema,
  stage: z.enum(["recall", "compare", "repair", "transfer", "complete"]),
  targetCount: z.number().int().min(1).max(3),
  gapCount: z.number().int().min(1).max(6),
  phaseIds: z.tuple([
    z.literal(BLURTING_PHASE_IDS[0]),
    z.literal(BLURTING_PHASE_IDS[1]),
    z.literal(BLURTING_PHASE_IDS[2]),
  ]),
}).strict();

type ParsedPublicDelivery = z.infer<typeof DisabledBlurtingPublicDeliveryV18Schema>;
type ParsedPublicResourceTemplate = z.infer<
  typeof DisabledBlurtingPublicResourceTemplateV18Schema
>;
type ParsedEvaluatorTransport = z.infer<
  typeof DisabledBlurtingEvaluatorTransportV18Schema
>;
type ParsedSafeDiagnostic = z.infer<typeof DisabledBlurtingSafeDiagnosticV18Schema>;

export type DisabledBlurtingPublicDeliveryV18 = DeepReadonly<ParsedPublicDelivery>;
export type DisabledBlurtingPublicResourceTemplateV18 = DeepReadonly<
  ParsedPublicResourceTemplate
>;
export type DisabledBlurtingEvaluatorTransportV18 = DeepReadonly<
  ParsedEvaluatorTransport
>;
export type DisabledBlurtingSafeDiagnosticV18 = DeepReadonly<ParsedSafeDiagnostic>;

export function readDisabledBlurtingPublicDeliveryV18(
  value: unknown,
): DisabledBlurtingPublicDeliveryV18 | null {
  const parsed = DisabledBlurtingPublicDeliveryV18Schema.safeParse(value);
  return parsed.success ? deepFreeze(parsed.data) : null;
}

export function readDisabledBlurtingPublicResourceTemplateV18(
  value: unknown,
): DisabledBlurtingPublicResourceTemplateV18 | null {
  const parsed = DisabledBlurtingPublicResourceTemplateV18Schema.safeParse(value);
  return parsed.success ? deepFreeze(parsed.data) : null;
}

export function readDisabledBlurtingEvaluatorTransportV18(
  value: unknown,
): DisabledBlurtingEvaluatorTransportV18 | null {
  const parsed = DisabledBlurtingEvaluatorTransportV18Schema.safeParse(value);
  return parsed.success ? deepFreeze(parsed.data) : null;
}

export function projectDisabledBlurtingSafeDiagnosticV18(
  value: unknown,
): DisabledBlurtingSafeDiagnosticV18 | null {
  const delivery = DisabledBlurtingPublicDeliveryV18Schema.safeParse(value);
  if (!delivery.success) return null;

  const parsed = DisabledBlurtingSafeDiagnosticV18Schema.safeParse({
    schemaVersion: DISABLED_BLURTING_PUBLIC_SCHEMA_VERSION,
    boundaryStatus: "disabled_safe_diagnostic_only" as const,
    deliveryHandle: delivery.data.identity.deliveryHandle,
    runId: delivery.data.identity.runId,
    planId: delivery.data.identity.planId,
    sessionId: delivery.data.identity.sessionId,
    routeRevisionId: delivery.data.identity.routeRevisionId,
    activityIndex: delivery.data.identity.activityIndex,
    stage: delivery.data.stage,
    targetCount: delivery.data.orderedTargets.length,
    gapCount: delivery.data.gapCount,
    phaseIds: delivery.data.phaseMetadata.map((phase) => phase.phaseId),
  });
  return parsed.success ? deepFreeze(parsed.data) : null;
}

type PublicEnvelope = {
  orderedTargets: readonly { targetId: string; evidenceId: string }[];
  phaseMetadata: readonly {
    targetIds: readonly string[];
  }[];
};

function reportPublicEnvelopeIssues(
  delivery: PublicEnvelope,
  context: z.RefinementCtx,
) {
  reportDuplicateBindings(delivery.orderedTargets, context, ["orderedTargets"]);
  const targetIds = delivery.orderedTargets.map((target) => target.targetId);
  delivery.phaseMetadata.forEach((phase, index) => {
    if (!sameStrings(phase.targetIds, targetIds)) {
      context.addIssue({
        code: "custom",
        path: ["phaseMetadata", index, "targetIds"],
        message: "Every public phase must retain the exact ordered target set.",
      });
    }
  });
}

function requireExactFinalCheckEvidenceId(
  binding: { targetId: string; evidenceId: string },
  context: z.RefinementCtx,
) {
  if (binding.evidenceId !== blurtingFinalCheckEvidenceId(binding.targetId)) {
    context.addIssue({
      code: "custom",
      path: ["evidenceId"],
      message: "A public Blurting target must use its exact final-check evidence ID.",
    });
  }
}

function reportDuplicateBindings(
  bindings: readonly { targetId: string; evidenceId: string }[],
  context: z.RefinementCtx,
  path: PropertyKey[],
) {
  if (new Set(bindings.map((binding) => binding.targetId)).size !== bindings.length) {
    context.addIssue({
      code: "custom",
      path,
      message: "Public Blurting target IDs must be unique.",
    });
  }
  if (new Set(bindings.map((binding) => binding.evidenceId)).size !== bindings.length) {
    context.addIssue({
      code: "custom",
      path,
      message: "Public Blurting evidence IDs must be unique.",
    });
  }
}

function sameOrderedBindings(
  left: readonly { targetId: string; evidenceId: string }[],
  right: readonly { targetId: string; evidenceId: string }[],
) {
  return left.length === right.length
    && left.every((binding, index) => (
      binding.targetId === right[index]?.targetId
      && binding.evidenceId === right[index]?.evidenceId
    ));
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
