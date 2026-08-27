import { z } from "zod";
import { METHOD_PHASES } from "@/lib/learning/method-fidelity";
import { CORE_METHOD_IDS, LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";
import {
  STUDY_ROUTE_METHOD_MAX_LENGTH,
  STUDY_ROUTE_OUTCOME_MAX_LENGTH,
  STUDY_ROUTE_REASON_MAX_LENGTH,
} from "@/lib/study-route/scalar-contract";
import { blurtingStudyRouteIssue } from "@/lib/study-route/method-recipe-contract";

export const STUDY_ROUTE_SCHEMA_VERSION = 1 as const;
export const STUDY_ROUTE_ROUTER_VERSION_MAX_LENGTH = 256 as const;

export const STUDY_ROUTE_LIFECYCLE_STATUSES = [
  "provisional",
  "committed",
  "superseded",
] as const;

export const STUDY_ROUTE_MODES = ["learn", "practice"] as const;
export const STUDY_ROUTE_EXECUTION_ENVIRONMENTS = ["inside_yova", "outside_yova"] as const;
export const STUDY_ROUTE_TARGET_STAGES = ["novice", "developing", "retrieval_ready"] as const;
export const STUDY_ROUTE_UNCERTAINTY_LEVELS = ["unknown", "high", "medium", "low"] as const;
export const STUDY_ROUTE_CONFIDENCE_LEVELS = ["unknown", "low", "medium", "high"] as const;
export const STUDY_ROUTE_DURATION_SOURCES = [
  "router_default",
  "profile_recommendation",
  "observed_outcome_adjustment",
  "availability_cap",
  "learner_override",
  "scheduled_review",
  "legacy_reconstruction",
] as const;
export const STUDY_ROUTE_DIFFICULTY_TIERS = ["unknown", "foundational", "standard", "stretch"] as const;
export const STUDY_ROUTE_SUPPORT_LEVELS = ["unknown", "supported_start", "fading", "independent_start"] as const;
export const STUDY_ROUTE_CONTROL_MODES = [
  "yova_decides",
  "help_me_choose",
  "learner_customizes",
  "legacy_unknown",
] as const;
export const STUDY_ROUTE_SELECTED_BY = ["yova", "learner", "legacy_unknown"] as const;

const RouteIdSchema = z.string().uuid();
const OpaqueReferenceSchema = z.string().trim().min(1).max(200);
const RouterVersionSchema = z.string().trim().min(1)
  .max(STUDY_ROUTE_ROUTER_VERSION_MAX_LENGTH);
const ExplanationItemSchema = z.string().trim().min(3).max(500);

function reportDuplicates(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string,
) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length > 0) {
    context.addIssue({
      code: "custom",
      path,
      message: `${label} must be unique. Duplicate: ${duplicates[0]}.`,
    });
  }
}

export const StudyRouteLifecycleStatusSchema = z.enum(STUDY_ROUTE_LIFECYCLE_STATUSES);
export const StudyRouteModeSchema = z.enum(STUDY_ROUTE_MODES);
export const StudyRouteExecutionEnvironmentSchema = z.enum(STUDY_ROUTE_EXECUTION_ENVIRONMENTS);
export const StudyRouteTargetStageSchema = z.enum(STUDY_ROUTE_TARGET_STAGES);
export const StudyRouteUncertaintySchema = z.enum(STUDY_ROUTE_UNCERTAINTY_LEVELS);
export const StudyRouteConfidenceLevelSchema = z.enum(STUDY_ROUTE_CONFIDENCE_LEVELS);
export const StudyRouteDurationSourceSchema = z.enum(STUDY_ROUTE_DURATION_SOURCES);
export const StudyRouteDifficultyTierSchema = z.enum(STUDY_ROUTE_DIFFICULTY_TIERS);
export const StudyRouteInitialSupportSchema = z.enum(STUDY_ROUTE_SUPPORT_LEVELS);
export const StudyRouteControlModeSchema = z.enum(STUDY_ROUTE_CONTROL_MODES);
export const StudyRouteSelectedBySchema = z.enum(STUDY_ROUTE_SELECTED_BY);

export const StudyRouteIdentitySchema = z.object({
  routeLineageId: RouteIdSchema,
  routeRevisionId: RouteIdSchema,
  revisionNumber: z.number().int().positive(),
  schemaVersion: z.literal(STUDY_ROUTE_SCHEMA_VERSION),
  lifecycleStatus: StudyRouteLifecycleStatusSchema,
  planId: RouteIdSchema,
  sessionId: RouteIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  committedAt: z.string().datetime({ offset: true }).optional(),
  supersedesRevisionId: RouteIdSchema.optional(),
}).strict().superRefine((identity, context) => {
  if (identity.revisionNumber === 1 && identity.supersedesRevisionId) {
    context.addIssue({
      code: "custom",
      path: ["supersedesRevisionId"],
      message: "The first route revision cannot supersede another revision.",
    });
  }
  if (identity.revisionNumber > 1 && !identity.supersedesRevisionId) {
    context.addIssue({
      code: "custom",
      path: ["supersedesRevisionId"],
      message: "Every route revision after the first must identify its predecessor.",
    });
  }
  if (identity.supersedesRevisionId === identity.routeRevisionId) {
    context.addIssue({
      code: "custom",
      path: ["supersedesRevisionId"],
      message: "A route revision cannot supersede itself.",
    });
  }
  if (identity.lifecycleStatus === "provisional" && identity.committedAt) {
    context.addIssue({
      code: "custom",
      path: ["committedAt"],
      message: "A provisional route has not been committed.",
    });
  }
  if (identity.lifecycleStatus !== "provisional" && !identity.committedAt) {
    context.addIssue({
      code: "custom",
      path: ["committedAt"],
      message: "A committed or superseded route must retain its commit time.",
    });
  }
  if (identity.committedAt && Date.parse(identity.committedAt) < Date.parse(identity.createdAt)) {
    context.addIssue({
      code: "custom",
      path: ["committedAt"],
      message: "A route cannot be committed before it was created.",
    });
  }
});

export const StudyRouteNextReviewSchema = z.object({
  scheduledFor: z.string().datetime({ offset: true }),
  reviewType: z.enum(["retrieval_check", "transfer_check"]),
  activeMinutes: z.number().int().min(2).max(5),
  reason: z.string().trim().min(8).max(300),
  evidenceRefs: z.array(OpaqueReferenceSchema).max(40),
}).strict().superRefine((review, context) => {
  reportDuplicates(review.evidenceRefs, context, ["evidenceRefs"], "Review evidence references");
});

export const StudyRouteTargetStateSchema = z.object({
  targetId: RouteIdSchema,
  stage: StudyRouteTargetStageSchema,
  uncertainty: StudyRouteUncertaintySchema,
  evidenceRefs: z.array(OpaqueReferenceSchema).max(40),
  lastObservedAt: z.string().datetime({ offset: true }).optional(),
  nextReview: StudyRouteNextReviewSchema.optional(),
}).strict().superRefine((target, context) => {
  reportDuplicates(target.evidenceRefs, context, ["evidenceRefs"], "Target evidence references");
  if (
    target.lastObservedAt
    && target.nextReview
    && Date.parse(target.nextReview.scheduledFor) <= Date.parse(target.lastObservedAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["nextReview", "scheduledFor"],
      message: "A target review must be scheduled after the latest observation.",
    });
  }
});

export const StudyRouteSourceRequirementsSchema = z.object({
  sourceType: z.enum(["user_materials", "yova_generated", "trusted_external_source"]),
  requiredSourceIds: z.array(OpaqueReferenceSchema).max(20),
  groundingRequired: z.boolean(),
  instructions: z.array(z.string().trim().min(5).max(300)).max(10),
}).strict().superRefine((requirements, context) => {
  reportDuplicates(requirements.requiredSourceIds, context, ["requiredSourceIds"], "Required source identifiers");
  if (requirements.sourceType !== "yova_generated" && requirements.requiredSourceIds.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["requiredSourceIds"],
      message: "A user or external source route must identify at least one required source.",
    });
  }
  if (requirements.sourceType === "yova_generated" && requirements.requiredSourceIds.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["requiredSourceIds"],
      message: "A YOVA-generated route cannot claim external source identifiers.",
    });
  }
});

export const StudyRouteTargetSchema = z.object({
  taskFamily: z.enum(LEARNING_TASK_TYPES),
  desiredOutcome: z.string().trim().min(5).max(STUDY_ROUTE_OUTCOME_MAX_LENGTH),
  targetStates: z.array(StudyRouteTargetStateSchema).min(1).max(40),
  sourceRequirements: StudyRouteSourceRequirementsSchema,
}).strict().superRefine((target, context) => {
  reportDuplicates(
    target.targetStates.map((state) => state.targetId),
    context,
    ["targetStates"],
    "Target identifiers",
  );
});

export const StudyRouteApproachSchema = z.object({
  mode: StudyRouteModeSchema,
  executionEnvironment: StudyRouteExecutionEnvironmentSchema,
  primaryMethodId: z.enum(CORE_METHOD_IDS),
  visibleMethodName: z.string().trim().min(2).max(STUDY_ROUTE_METHOD_MAX_LENGTH),
  visibleSupportingTechniqueId: OpaqueReferenceSchema.optional(),
  confidenceLevel: StudyRouteConfidenceLevelSchema,
}).strict();

export const StudyRouteTimedBreakSchema = z.object({
  minutes: z.number().int().min(1).max(30),
  afterPhaseId: OpaqueReferenceSchema,
}).strict();

export const StudyRouteTimingSchema = z.object({
  activeMinutes: z.number().int().min(5).max(180),
  elapsedMinutes: z.number().int().min(1).max(240),
  durationSource: StudyRouteDurationSourceSchema,
  hardMaximumMinutes: z.number().int().min(1).max(240).optional(),
  optionalTimedBreak: StudyRouteTimedBreakSchema.optional(),
}).strict().superRefine((timing, context) => {
  const expectedElapsed = timing.activeMinutes + (timing.optionalTimedBreak?.minutes ?? 0);
  if (timing.elapsedMinutes !== expectedElapsed) {
    context.addIssue({
      code: "custom",
      path: ["elapsedMinutes"],
      message: "Elapsed minutes must equal active minutes plus the optional timed break.",
    });
  }
  if (timing.hardMaximumMinutes !== undefined && timing.elapsedMinutes > timing.hardMaximumMinutes) {
    context.addIssue({
      code: "custom",
      path: ["hardMaximumMinutes"],
      message: "Elapsed minutes cannot exceed the learner's hard maximum.",
    });
  }
});

export const StudyRoutePhaseSchema = z.object({
  phaseId: OpaqueReferenceSchema,
  methodPhase: z.enum(METHOD_PHASES),
  activeMinutes: z.number().int().positive().max(180),
  targetIds: z.array(RouteIdSchema).max(40),
}).strict().superRefine((phase, context) => {
  reportDuplicates(phase.targetIds, context, ["targetIds"], "Phase target identifiers");
});

export const StudyRouteCompletionEvidenceSchema = z.object({
  evidenceId: OpaqueReferenceSchema,
  targetIds: z.array(RouteIdSchema).min(1).max(40),
  kind: z.enum(["retrieval", "application", "explanation", "artifact", "verification"]),
  description: z.string().trim().min(8).max(300),
  requiresIndependentAttempt: z.boolean(),
}).strict().superRefine((evidence, context) => {
  reportDuplicates(evidence.targetIds, context, ["targetIds"], "Completion-evidence target identifiers");
});

export const StudyRouteDeferredTargetSchema = z.object({
  targetId: RouteIdSchema,
  reason: z.string().trim().min(8).max(300),
}).strict();

export const StudyRouteExecutionSchema = z.object({
  orderedPhases: z.array(StudyRoutePhaseSchema).min(1).max(20),
  difficultyTier: StudyRouteDifficultyTierSchema,
  initialSupport: StudyRouteInitialSupportSchema,
  activityLimit: z.number().int().min(1).max(20),
  completionEvidence: z.array(StudyRouteCompletionEvidenceSchema).min(1).max(4),
  deferredTargets: z.array(StudyRouteDeferredTargetSchema).max(40),
}).strict().superRefine((execution, context) => {
  reportDuplicates(
    execution.orderedPhases.map((phase) => phase.phaseId),
    context,
    ["orderedPhases"],
    "Phase identifiers",
  );
  reportDuplicates(
    execution.completionEvidence.map((evidence) => evidence.evidenceId),
    context,
    ["completionEvidence"],
    "Completion-evidence identifiers",
  );
  reportDuplicates(
    execution.deferredTargets.map((target) => target.targetId),
    context,
    ["deferredTargets"],
    "Deferred target identifiers",
  );
});

export const StudyRouteAlternativeSchema = z.object({
  alternativeId: OpaqueReferenceSchema,
  mode: StudyRouteModeSchema,
  executionEnvironment: StudyRouteExecutionEnvironmentSchema,
  primaryMethodId: z.enum(CORE_METHOD_IDS),
  visibleMethodName: z.string().trim().min(2).max(STUDY_ROUTE_METHOD_MAX_LENGTH),
  activeMinutes: z.number().int().min(1).max(180),
  tradeoff: z.string().trim().min(8).max(300),
}).strict();

export const StudyRouteOverrideSchema = z.object({
  requestedAt: z.string().datetime({ offset: true }),
  changedFields: z.array(z.enum([
    "targets",
    "mode",
    "execution_environment",
    "primary_method",
    "method_recipe",
    "duration",
    "phase_order",
    "support_bounds",
    "review_contract",
  ])).min(1).max(9),
  reason: z.string().trim().min(3).max(300).optional(),
}).strict().superRefine((override, context) => {
  reportDuplicates(override.changedFields, context, ["changedFields"], "Overridden fields");
});

export const StudyRouteAgencySchema = z.object({
  controlMode: StudyRouteControlModeSchema,
  selectedBy: StudyRouteSelectedBySchema,
  alternatives: z.array(StudyRouteAlternativeSchema).max(2),
  override: StudyRouteOverrideSchema.optional(),
}).strict().superRefine((agency, context) => {
  reportDuplicates(
    agency.alternatives.map((alternative) => alternative.alternativeId),
    context,
    ["alternatives"],
    "Alternative identifiers",
  );
  if (agency.override && agency.selectedBy !== "learner") {
    context.addIssue({
      code: "custom",
      path: ["selectedBy"],
      message: "A recorded learner override must identify the learner as the selector.",
    });
  }
});

export const StudyRouteExplanationSchema = z.object({
  shortReason: z.string().trim().min(8).max(STUDY_ROUTE_REASON_MAX_LENGTH),
  taskRequirements: z.array(ExplanationItemSchema).max(10),
  learnerDeclarations: z.array(ExplanationItemSchema).max(10),
  observations: z.array(ExplanationItemSchema).max(10),
  uncertainties: z.array(ExplanationItemSchema).max(10),
}).strict();

export const StudyRouteRuleTraceEntrySchema = z.object({
  ruleId: OpaqueReferenceSchema,
  result: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(3).max(500),
  evidenceRefs: z.array(OpaqueReferenceSchema).max(40),
}).strict().superRefine((entry, context) => {
  reportDuplicates(entry.evidenceRefs, context, ["evidenceRefs"], "Rule evidence references");
});

export const StudyRouteProvenanceSchema = z.object({
  // A route can retain independently versioned composition, duration, method,
  // runtime, and post-activation decisions. Keep that complete chain bounded,
  // but do not force a successor to erase its predecessor's router history.
  routerVersion: RouterVersionSchema,
  profileVersion: OpaqueReferenceSchema,
  evidenceRefs: z.array(OpaqueReferenceSchema).max(100),
  ruleTrace: z.array(StudyRouteRuleTraceEntrySchema).min(1).max(200),
}).strict().superRefine((provenance, context) => {
  reportDuplicates(provenance.evidenceRefs, context, ["evidenceRefs"], "Provenance evidence references");
});

export const StudyRouteSchema = z.object({
  identity: StudyRouteIdentitySchema,
  target: StudyRouteTargetSchema,
  approach: StudyRouteApproachSchema,
  timing: StudyRouteTimingSchema,
  execution: StudyRouteExecutionSchema,
  agency: StudyRouteAgencySchema,
  explanation: StudyRouteExplanationSchema,
  provenance: StudyRouteProvenanceSchema,
}).strict().superRefine((route, context) => {
  const targetIds = new Set(route.target.targetStates.map((target) => target.targetId));
  const deferredIds = new Set(route.execution.deferredTargets.map((target) => target.targetId));
  const activeTargetCount = route.target.targetStates.filter((target) => (
    !deferredIds.has(target.targetId)
  )).length;
  const phaseIds = route.execution.orderedPhases.map((phase) => phase.phaseId);

  if (activeTargetCount > 6) {
    context.addIssue({
      code: "custom",
      path: ["target", "targetStates"],
      message: "A StudyRoute may execute at most six active targets; additional targets must be deferred.",
    });
  }
  if (
    route.target.sourceRequirements.sourceType === "trusted_external_source"
    && route.approach.executionEnvironment !== "outside_yova"
  ) {
    context.addIssue({
      code: "custom",
      path: ["approach", "executionEnvironment"],
      message: "A trusted external source route must execute outside YOVA.",
    });
  }

  for (const [index, deferred] of route.execution.deferredTargets.entries()) {
    if (!targetIds.has(deferred.targetId)) {
      context.addIssue({
        code: "custom",
        path: ["execution", "deferredTargets", index, "targetId"],
        message: "A deferred target must belong to this route's target snapshot.",
      });
    }
  }

  const coveredTargets = new Set<string>();
  for (const [phaseIndex, phase] of route.execution.orderedPhases.entries()) {
    for (const [targetIndex, targetId] of phase.targetIds.entries()) {
      if (!targetIds.has(targetId)) {
        context.addIssue({
          code: "custom",
          path: ["execution", "orderedPhases", phaseIndex, "targetIds", targetIndex],
          message: "Every phase target must belong to this route's target snapshot.",
        });
      } else if (deferredIds.has(targetId)) {
        context.addIssue({
          code: "custom",
          path: ["execution", "orderedPhases", phaseIndex, "targetIds", targetIndex],
          message: "A deferred target cannot also be assigned to an active phase.",
        });
      } else {
        coveredTargets.add(targetId);
      }
    }
  }

  for (const [index, target] of route.target.targetStates.entries()) {
    if (!deferredIds.has(target.targetId) && !coveredTargets.has(target.targetId)) {
      context.addIssue({
        code: "custom",
        path: ["target", "targetStates", index, "targetId"],
        message: "Every target must be covered by a phase or explicitly deferred.",
      });
    }
  }

  for (const [evidenceIndex, evidence] of route.execution.completionEvidence.entries()) {
    for (const [targetIndex, targetId] of evidence.targetIds.entries()) {
      if (!targetIds.has(targetId) || deferredIds.has(targetId)) {
        context.addIssue({
          code: "custom",
          path: ["execution", "completionEvidence", evidenceIndex, "targetIds", targetIndex],
          message: "Completion evidence must refer to an active target in this route.",
        });
      }
    }
  }

  const phaseMinutes = route.execution.orderedPhases.reduce((sum, phase) => sum + phase.activeMinutes, 0);
  if (phaseMinutes !== route.timing.activeMinutes) {
    context.addIssue({
      code: "custom",
      path: ["execution", "orderedPhases"],
      message: "Phase minutes must sum exactly to the route's active minutes.",
    });
  }

  if (route.timing.optionalTimedBreak) {
    const breakIndex = phaseIds.indexOf(route.timing.optionalTimedBreak.afterPhaseId);
    if (breakIndex < 0 || breakIndex === phaseIds.length - 1) {
      context.addIssue({
        code: "custom",
        path: ["timing", "optionalTimedBreak", "afterPhaseId"],
        message: "A timed break must follow an existing non-final phase.",
      });
    }
  }

  const primarySignature = [
    route.approach.mode,
    route.approach.executionEnvironment,
    route.approach.primaryMethodId,
    route.timing.activeMinutes,
  ].join(":");
  const alternativeSignatures = route.agency.alternatives.map((alternative) => [
    alternative.mode,
    alternative.executionEnvironment,
    alternative.primaryMethodId,
    alternative.activeMinutes,
  ].join(":"));
  reportDuplicates(alternativeSignatures, context, ["agency", "alternatives"], "Alternative routes");
  if (alternativeSignatures.includes(primarySignature)) {
    context.addIssue({
      code: "custom",
      path: ["agency", "alternatives"],
      message: "An alternative must differ materially from the selected route.",
    });
  }

  const blurtingIssue = blurtingStudyRouteIssue(route);
  if (blurtingIssue) {
    context.addIssue({
      code: "custom",
      path: ["approach", "visibleSupportingTechniqueId"],
      message: blurtingIssue,
    });
  }
});

export type StudyRouteLifecycleStatus = z.infer<typeof StudyRouteLifecycleStatusSchema>;
export type StudyRouteMode = z.infer<typeof StudyRouteModeSchema>;
export type StudyRouteExecutionEnvironment = z.infer<typeof StudyRouteExecutionEnvironmentSchema>;
export type StudyRouteTargetStage = z.infer<typeof StudyRouteTargetStageSchema>;
export type StudyRouteUncertainty = z.infer<typeof StudyRouteUncertaintySchema>;
export type StudyRouteConfidenceLevel = z.infer<typeof StudyRouteConfidenceLevelSchema>;
export type StudyRouteDurationSource = z.infer<typeof StudyRouteDurationSourceSchema>;
export type StudyRouteDifficultyTier = z.infer<typeof StudyRouteDifficultyTierSchema>;
export type StudyRouteInitialSupport = z.infer<typeof StudyRouteInitialSupportSchema>;
export type StudyRouteControlMode = z.infer<typeof StudyRouteControlModeSchema>;
export type StudyRouteSelectedBy = z.infer<typeof StudyRouteSelectedBySchema>;
export type StudyRouteIdentity = z.infer<typeof StudyRouteIdentitySchema>;
export type StudyRouteNextReview = z.infer<typeof StudyRouteNextReviewSchema>;
export type StudyRouteTargetState = z.infer<typeof StudyRouteTargetStateSchema>;
export type StudyRouteSourceRequirements = z.infer<typeof StudyRouteSourceRequirementsSchema>;
export type StudyRouteTarget = z.infer<typeof StudyRouteTargetSchema>;
export type StudyRouteApproach = z.infer<typeof StudyRouteApproachSchema>;
export type StudyRouteTiming = z.infer<typeof StudyRouteTimingSchema>;
export type StudyRoutePhase = z.infer<typeof StudyRoutePhaseSchema>;
export type StudyRouteCompletionEvidence = z.infer<typeof StudyRouteCompletionEvidenceSchema>;
export type StudyRouteDeferredTarget = z.infer<typeof StudyRouteDeferredTargetSchema>;
export type StudyRouteExecution = z.infer<typeof StudyRouteExecutionSchema>;
export type StudyRouteAlternative = z.infer<typeof StudyRouteAlternativeSchema>;
export type StudyRouteOverride = z.infer<typeof StudyRouteOverrideSchema>;
export type StudyRouteAgency = z.infer<typeof StudyRouteAgencySchema>;
export type StudyRouteExplanation = z.infer<typeof StudyRouteExplanationSchema>;
export type StudyRouteRuleTraceEntry = z.infer<typeof StudyRouteRuleTraceEntrySchema>;
export type StudyRouteProvenance = z.infer<typeof StudyRouteProvenanceSchema>;
export type StudyRoute = z.infer<typeof StudyRouteSchema>;
