import "server-only";

import { z } from "zod";
import {
  BLURTING_RUNTIME_FORMAT,
  BLURTING_SUPPORTING_TECHNIQUE_ID,
  BLURTING_VISIBLE_METHOD_NAME,
} from "@/lib/learning/method-recipes";
import {
  DisabledBlurtingCanonicalInstantV18Schema,
  disabledBlurtingCanonicalTextV18Schema,
} from "@/lib/session-generation/disabled-blurting-canonical-domain-v18";
import { DisabledBlurtingCanonicalUuidV18Schema } from "@/lib/session-generation/disabled-blurting-public-delivery-v18";
import { GeneratedSessionDraftOutputSchema } from "@/lib/session-generation/schema";
import {
  BLURTING_SESSION_SOURCE_READINESS,
  blurtingSessionGenerationContract,
  blurtingSessionRuntimeBindingIssue,
  type BlurtingSessionGenerationRouteIdentity,
  type BlurtingSessionRuntimeTargetContract,
} from "@/lib/study-route/blurting-session-generation-contract";
import {
  BLURTING_PHASE_IDS,
  allocateBlurtingPhaseMinutes,
  blurtingFinalCheckEvidenceId,
} from "@/lib/study-route/method-recipe-contract";
import { StudyRouteSchema } from "@/lib/study-route/schema";

export const DISABLED_BLURTING_SESSION_SCHEMA_VERSION = 18 as const;
export const DISABLED_BLURTING_SESSION_BOUNDARY_STATUS =
  "disabled_schema_only" as const;
export const BLURTING_TARGET_EVALUATOR_VERSION =
  "blurting_target_evaluator_v1" as const;

const PromptTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 3,
  maxCodePoints: 320,
});
const ServerAnswerKeySchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 1,
  maxCodePoints: 600,
});
const ReminderTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 10,
  maxCodePoints: 200,
});
const InstructionTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 10,
  maxCodePoints: 320,
});
const GapTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 3,
  maxCodePoints: 240,
});
const ConceptTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 2,
  maxCodePoints: 120,
});
const CriterionTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 8,
  maxCodePoints: 240,
});
const ModelTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 1,
  maxCodePoints: 160,
});

const DisabledBlurtingRuntimeTargetBindingV18Schema = z.object({
  targetId: DisabledBlurtingCanonicalUuidV18Schema,
  evidenceId: z.string().min(1).max(200),
  concept: ConceptTextSchema,
  comparisonCriterion: CriterionTextSchema,
  transferSuccessCriterion: CriterionTextSchema,
}).strict().superRefine((binding, context) => {
  if (binding.evidenceId !== blurtingFinalCheckEvidenceId(binding.targetId)) {
    context.addIssue({
      code: "custom",
      path: ["evidenceId"],
      message: "A V18 target must use its exact final-check evidence ID.",
    });
  }
});

const StrictBroadRecallPromptSchema = z.object({
  prompt: PromptTextSchema,
  /** Server-owned answer key; this is never a learner response. */
  expectedAnswer: ServerAnswerKeySchema,
  hint: z.null(),
}).strict();

const StrictBroadRecallTransferPromptSchema = z.object({
  sourceClosedReminder: ReminderTextSchema,
  prompt: PromptTextSchema,
  /** Server-owned answer key; this is never a learner response. */
  expectedAnswer: ServerAnswerKeySchema,
}).strict();

/**
 * Exact broad-recall runtime payload for the isolated V18 boundary.
 *
 * The shared retrieval schema intentionally remains permissive enough to read
 * legacy prompt sets. This schema is strict at every object level so a future
 * cache cannot retain learner-authored text or an unreviewed extra field.
 */
export const DisabledBlurtingRuntimeV18Schema = z.object({
  kind: z.literal("retrieval_round"),
  format: z.literal(BLURTING_RUNTIME_FORMAT),
  sourceClosedReminder: ReminderTextSchema,
  prompts: z.array(StrictBroadRecallPromptSchema).length(1),
  comparisonInstructions: InstructionTextSchema,
  gapChecklist: z.array(GapTextSchema).min(1).max(6),
  correctionInstruction: InstructionTextSchema,
  transferPrompt: StrictBroadRecallTransferPromptSchema,
  targetBindings: z.array(DisabledBlurtingRuntimeTargetBindingV18Schema).min(1).max(3),
}).strict();

const RouteIdentitySchema = z.object({
  lifecycleStatus: z.literal("committed"),
  planId: DisabledBlurtingCanonicalUuidV18Schema,
  sessionId: DisabledBlurtingCanonicalUuidV18Schema,
  routeRevisionId: DisabledBlurtingCanonicalUuidV18Schema,
}).strict();

const BlurtingDeliveryIdentitySchema = z.object({
  learningMode: z.literal("study"),
  taskType: z.enum(["conceptual_learning", "reading_to_quiz"]),
  methodId: z.literal("retrieval_practice"),
  visibleMethodName: z.literal(BLURTING_VISIBLE_METHOD_NAME),
  visibleSupportingTechniqueId: z.literal(BLURTING_SUPPORTING_TECHNIQUE_ID),
  executionEnvironment: z.enum(["inside_yova", "outside_yova"]),
}).strict();

const TargetIdsSchema = z.array(DisabledBlurtingCanonicalUuidV18Schema).min(1).max(3);
const ActiveMinutesSchema = z.number().int().min(1).max(20);

const RetrievePhaseEnvelopeSchema = z.object({
  phaseId: z.literal(BLURTING_PHASE_IDS[0]),
  methodPhase: z.literal("retrieve"),
  activeMinutes: ActiveMinutesSchema,
  targetIds: TargetIdsSchema,
  runtime: DisabledBlurtingRuntimeV18Schema,
}).strict();

const RepairPhaseEnvelopeSchema = z.object({
  phaseId: z.literal(BLURTING_PHASE_IDS[1]),
  methodPhase: z.literal("repair"),
  activeMinutes: ActiveMinutesSchema,
  targetIds: TargetIdsSchema,
}).strict();

const TransferPhaseEnvelopeSchema = z.object({
  phaseId: z.literal(BLURTING_PHASE_IDS[2]),
  methodPhase: z.literal("transfer"),
  activeMinutes: ActiveMinutesSchema,
  targetIds: TargetIdsSchema,
}).strict();

const CompletionTargetBindingSchema = z.object({
  targetId: DisabledBlurtingCanonicalUuidV18Schema,
  evidenceId: z.string().min(1).max(200),
}).strict().superRefine((binding, context) => {
  if (binding.evidenceId !== blurtingFinalCheckEvidenceId(binding.targetId)) {
    context.addIssue({
      code: "custom",
      path: ["evidenceId"],
      message: "Each evaluator binding must use its target's exact final-check evidence ID.",
    });
  }
});

const TargetBoundCompletionContractSchema = z.object({
  kind: z.literal("target_bound_closed_source_transfer"),
  evaluatorVersion: z.literal(BLURTING_TARGET_EVALUATOR_VERSION),
  resultOrder: z.literal("ordered_targets"),
  requiresIndependentAttempt: z.literal(true),
  evaluatorUnavailableResult: z.literal("unverified"),
  targetBindings: z.array(CompletionTargetBindingSchema).min(1).max(3),
}).strict();

/**
 * A truthful server-private canonical candidate for a future Blurting resource.
 *
 * This must never enter a browser-readable cache: it contains answer keys and
 * evaluator criteria. Its status and source-readiness literals make clear that
 * parsing it authorizes neither generation nor learner delivery.
 */
export const DisabledCachedBlurtingSessionV18Schema = z.object({
  schemaVersion: z.literal(DISABLED_BLURTING_SESSION_SCHEMA_VERSION),
  boundaryStatus: z.literal(DISABLED_BLURTING_SESSION_BOUNDARY_STATUS),
  sourceReadiness: z.literal(BLURTING_SESSION_SOURCE_READINESS),
  model: ModelTextSchema,
  generatedAt: DisabledBlurtingCanonicalInstantV18Schema,
  routeIdentity: RouteIdentitySchema,
  deliveryIdentity: BlurtingDeliveryIdentitySchema,
  orderedTargets: z.array(DisabledBlurtingRuntimeTargetBindingV18Schema).min(1).max(3),
  phaseEnvelopes: z.tuple([
    RetrievePhaseEnvelopeSchema,
    RepairPhaseEnvelopeSchema,
    TransferPhaseEnvelopeSchema,
  ]),
  completionContract: TargetBoundCompletionContractSchema,
}).strict().superRefine((session, context) => {
  const targetIds = session.orderedTargets.map((target) => target.targetId);
  const evidenceIds = session.orderedTargets.map((target) => target.evidenceId);
  if (new Set(targetIds).size !== targetIds.length) {
    context.addIssue({
      code: "custom",
      path: ["orderedTargets"],
      message: "The ordered active targets must be unique.",
    });
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    context.addIssue({
      code: "custom",
      path: ["orderedTargets"],
      message: "The target-bound final-check evidence IDs must be unique.",
    });
  }

  session.phaseEnvelopes.forEach((phase, index) => {
    if (!sameStrings(phase.targetIds, targetIds)) {
      context.addIssue({
        code: "custom",
        path: ["phaseEnvelopes", index, "targetIds"],
        message: "Every phase must retain the exact ordered active target set.",
      });
    }
  });

  const totalMinutes = session.phaseEnvelopes.reduce(
    (sum, phase) => sum + phase.activeMinutes,
    0,
  );
  if (totalMinutes < 10 || totalMinutes > 60) {
    context.addIssue({
      code: "custom",
      path: ["phaseEnvelopes"],
      message: "The disabled Blurting boundary represents 10 to 60 active minutes.",
    });
  } else {
    const expectedMinutes = allocateBlurtingPhaseMinutes(totalMinutes);
    session.phaseEnvelopes.forEach((phase, index) => {
      if (phase.activeMinutes !== expectedMinutes[index]) {
        context.addIssue({
          code: "custom",
          path: ["phaseEnvelopes", index, "activeMinutes"],
          message: "Phase minutes must use the canonical earliest-remainder allocation.",
        });
      }
    });
  }

  const runtimeBindings = session.phaseEnvelopes[0].runtime.targetBindings;
  if (!sameTargetContracts(runtimeBindings, session.orderedTargets)) {
    context.addIssue({
      code: "custom",
      path: ["phaseEnvelopes", 0, "runtime", "targetBindings"],
      message: "The runtime target contract must exactly match the ordered active targets.",
    });
  }

  const completionBindings = session.completionContract.targetBindings;
  if (
    completionBindings.length !== session.orderedTargets.length
    || completionBindings.some((binding, index) => (
      binding.targetId !== session.orderedTargets[index]?.targetId
      || binding.evidenceId !== session.orderedTargets[index]?.evidenceId
    ))
  ) {
    context.addIssue({
      code: "custom",
      path: ["completionContract", "targetBindings"],
      message: "Completion must bind one evaluator result to each ordered target and final-check evidence ID.",
    });
  }
});

type ParsedDisabledCachedBlurtingSessionV18 = z.infer<
  typeof DisabledCachedBlurtingSessionV18Schema
>;

export type DisabledCachedBlurtingSessionV18 = DeepReadonly<
  ParsedDisabledCachedBlurtingSessionV18
>;

export type DisabledBlurtingSessionV18ConversionInput = Readonly<{
  sessionInput: unknown;
  routeInput: unknown;
  expectedIdentity: BlurtingSessionGenerationRouteIdentity;
  expectedTargetContracts: readonly BlurtingSessionRuntimeTargetContract[];
  model: string;
  generatedAt: string;
}>;

/**
 * Reads the isolated shape only when it still matches the exact committed
 * StudyRoute and trusted target criteria. A successful read remains a disabled
 * structural result, never a production cache or delivery authorization.
 */
export function readDisabledCachedBlurtingSessionV18(
  input: unknown,
  routeInput: unknown,
  expectedIdentity: BlurtingSessionGenerationRouteIdentity,
  expectedTargetContracts: readonly BlurtingSessionRuntimeTargetContract[],
): DisabledCachedBlurtingSessionV18 | null {
  const session = DisabledCachedBlurtingSessionV18Schema.safeParse(input);
  const route = StudyRouteSchema.safeParse(routeInput);
  const contract = blurtingSessionGenerationContract(routeInput, expectedIdentity);
  const trustedTargets = z.array(DisabledBlurtingRuntimeTargetBindingV18Schema)
    .min(1)
    .max(3)
    .safeParse(expectedTargetContracts);
  if (!session.success || !route.success || !contract || !trustedTargets.success) {
    return null;
  }

  const value = session.data;
  if (
    value.routeIdentity.planId !== contract.identity.planId
    || value.routeIdentity.sessionId !== contract.identity.sessionId
    || value.routeIdentity.routeRevisionId !== contract.identity.routeRevisionId
    || value.sourceReadiness !== contract.sourceReadiness
    || value.deliveryIdentity.taskType !== route.data.target.taskFamily
    || value.deliveryIdentity.methodId !== route.data.approach.primaryMethodId
    || value.deliveryIdentity.visibleMethodName !== route.data.approach.visibleMethodName
    || value.deliveryIdentity.visibleSupportingTechniqueId
      !== route.data.approach.visibleSupportingTechniqueId
    || value.deliveryIdentity.executionEnvironment !== contract.executionEnvironment
    || !sameTargetContracts(value.orderedTargets, trustedTargets.data)
    || !sameRouteEvidence(contract.completionEvidence, trustedTargets.data)
    || !samePhaseContracts(value.phaseEnvelopes, contract.orderedPhases)
  ) {
    return null;
  }

  return deepFreeze(value);
}

/**
 * Converts the temporary non-evidence activity scaffold only after the
 * existing fail-closed binding checker proves route, phase, runtime, and
 * trusted-target identity. Generic activity presentation and evidence fields
 * are discarded rather than copied into the dedicated boundary.
 */
export function toDisabledCachedBlurtingSessionV18(
  input: DisabledBlurtingSessionV18ConversionInput,
): DisabledCachedBlurtingSessionV18 | null {
  if (blurtingSessionRuntimeBindingIssue(
    input.sessionInput,
    input.routeInput,
    input.expectedIdentity,
    input.expectedTargetContracts,
  )) {
    return null;
  }

  const route = StudyRouteSchema.safeParse(input.routeInput);
  const draft = GeneratedSessionDraftOutputSchema.safeParse(input.sessionInput);
  const contract = blurtingSessionGenerationContract(
    input.routeInput,
    input.expectedIdentity,
  );
  if (!route.success || !draft.success || !contract) return null;

  const retrieveIndex = contract.orderedPhases.findIndex((phase) => (
    phase.methodPhase === "retrieve"
  ));
  const runtime = DisabledBlurtingRuntimeV18Schema.safeParse(
    draft.data.activities[retrieveIndex]?.methodRuntime,
  );
  const [retrieve, repair, transfer] = contract.orderedPhases;
  if (
    !runtime.success
    || retrieve?.methodPhase !== "retrieve"
    || repair?.methodPhase !== "repair"
    || transfer?.methodPhase !== "transfer"
  ) {
    return null;
  }

  const candidate = {
    schemaVersion: DISABLED_BLURTING_SESSION_SCHEMA_VERSION,
    boundaryStatus: DISABLED_BLURTING_SESSION_BOUNDARY_STATUS,
    sourceReadiness: contract.sourceReadiness,
    model: input.model,
    generatedAt: input.generatedAt,
    routeIdentity: {
      lifecycleStatus: "committed" as const,
      ...contract.identity,
    },
    deliveryIdentity: {
      learningMode: "study" as const,
      taskType: route.data.target.taskFamily,
      methodId: "retrieval_practice" as const,
      visibleMethodName: BLURTING_VISIBLE_METHOD_NAME,
      visibleSupportingTechniqueId: BLURTING_SUPPORTING_TECHNIQUE_ID,
      executionEnvironment: contract.executionEnvironment,
    },
    orderedTargets: input.expectedTargetContracts.map((target) => ({
      targetId: target.targetId,
      evidenceId: target.evidenceId,
      concept: target.concept,
      comparisonCriterion: target.comparisonCriterion,
      transferSuccessCriterion: target.transferSuccessCriterion,
    })),
    phaseEnvelopes: [{
      phaseId: retrieve.phaseId,
      methodPhase: retrieve.methodPhase,
      activeMinutes: retrieve.activeMinutes,
      targetIds: [...retrieve.targetIds],
      runtime: runtime.data,
    }, {
      phaseId: repair.phaseId,
      methodPhase: repair.methodPhase,
      activeMinutes: repair.activeMinutes,
      targetIds: [...repair.targetIds],
    }, {
      phaseId: transfer.phaseId,
      methodPhase: transfer.methodPhase,
      activeMinutes: transfer.activeMinutes,
      targetIds: [...transfer.targetIds],
    }],
    completionContract: {
      kind: "target_bound_closed_source_transfer" as const,
      evaluatorVersion: BLURTING_TARGET_EVALUATOR_VERSION,
      resultOrder: "ordered_targets" as const,
      requiresIndependentAttempt: true as const,
      evaluatorUnavailableResult: "unverified" as const,
      targetBindings: input.expectedTargetContracts.map((target) => ({
        targetId: target.targetId,
        evidenceId: target.evidenceId,
      })),
    },
  };

  return readDisabledCachedBlurtingSessionV18(
    candidate,
    input.routeInput,
    input.expectedIdentity,
    input.expectedTargetContracts,
  );
}

function sameRouteEvidence(
  routeEvidence: readonly { targetId: string; evidenceId: string }[],
  targets: readonly { targetId: string; evidenceId: string }[],
) {
  return routeEvidence.length === targets.length
    && routeEvidence.every((evidence, index) => (
      evidence.targetId === targets[index]?.targetId
      && evidence.evidenceId === targets[index]?.evidenceId
    ));
}

function samePhaseContracts(
  actual: readonly {
    phaseId: string;
    methodPhase: string;
    activeMinutes: number;
    targetIds: readonly string[];
  }[],
  expected: readonly {
    phaseId: string;
    methodPhase: string;
    activeMinutes: number;
    targetIds: readonly string[];
  }[],
) {
  return actual.length === expected.length
    && actual.every((phase, index) => (
      phase.phaseId === expected[index]?.phaseId
      && phase.methodPhase === expected[index]?.methodPhase
      && phase.activeMinutes === expected[index]?.activeMinutes
      && sameStrings(phase.targetIds, expected[index]?.targetIds ?? [])
    ));
}

function sameTargetContracts(
  actual: readonly BlurtingSessionRuntimeTargetContract[],
  expected: readonly BlurtingSessionRuntimeTargetContract[],
) {
  return actual.length === expected.length
    && actual.every((target, index) => (
      target.targetId === expected[index]?.targetId
      && target.evidenceId === expected[index]?.evidenceId
      && target.concept === expected[index]?.concept
      && target.comparisonCriterion === expected[index]?.comparisonCriterion
      && target.transferSuccessCriterion === expected[index]?.transferSuccessCriterion
    ));
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
