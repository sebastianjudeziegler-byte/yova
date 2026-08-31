import { z } from "zod";
import {
  CORE_METHOD_CATALOG,
  CORE_METHOD_IDS,
  isRecognizedCoreMethodName,
  recognizedCoreMethodNames,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import {
  eligibleMethodIdsForPolicyVersion,
  LEGACY_METHOD_ELIGIBILITY_POLICY_VERSION,
  METHOD_ELIGIBILITY_POLICY_VERSION,
  METHOD_ELIGIBILITY_POLICY_VERSIONS,
  type MethodEligibilityPolicyVersion,
} from "@/lib/learning/method-eligibility";
import {
  CanonicalLearnerProfileSchema,
  canonicalProfileSignal,
  type CanonicalLearnerProfile,
} from "@/lib/personalization/canonical-profile-schema";
import { stableFingerprint } from "@/lib/stable-fingerprint";
import { methodRuntimeCapabilityFor } from "@/lib/session-generation/method-runtime-capability";
import {
  commitStudyRouteRevision,
  freezeStudyRoute,
  materialStudyRouteChanges,
  supersedeStudyRouteRevision,
  type StudyRouteMaterialChangeKind,
} from "@/lib/study-route/revisions";
import {
  StudyRouteAlternativeSchema,
  StudyRouteControlModeSchema,
  StudyRouteProvenanceSchema,
  StudyRouteRuleTraceEntrySchema,
  StudyRouteSchema,
  type StudyRoute,
  type StudyRouteAlternative,
  type StudyRouteControlMode,
} from "@/lib/study-route/schema";
import { activeStudyRouteTargetStates } from "@/lib/study-route/targets";

export const STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION =
  "study_route_agency_mode_controller_v1" as const;

export const STUDY_ROUTE_AGENCY_MODES = [
  "yova_decides",
  "help_me_choose",
  "ill_customize",
] as const;

export const StudyRouteAgencyModeSchema = z.enum(STUDY_ROUTE_AGENCY_MODES);

export const StudyRouteAgencyConfirmationSchema = z.object({
  policyVersion: z.literal(STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION),
  expectedRouteRevisionId: z.string().uuid(),
  candidateRouteRevisionId: z.string().uuid(),
  confirmedAt: z.string().datetime({ offset: true }),
}).strict();

export const STUDY_ROUTE_AGENCY_CHANGE_KINDS = [
  "system_recommendation",
  "learner_request",
  "safety_constraint",
] as const;

export const STUDY_ROUTE_AGENCY_CHANGE_TIMINGS = [
  "between_sessions",
  "in_session",
] as const;

export const STUDY_ROUTE_AGENCY_SUPPORT_LEVELS = [
  "sufficient",
  "insufficient",
  "not_required",
] as const;

export type StudyRouteAgencyMode = z.infer<typeof StudyRouteAgencyModeSchema>;
export type StudyRouteAgencyConfirmation = z.infer<
  typeof StudyRouteAgencyConfirmationSchema
>;
export type StudyRouteAgencyChangeKind =
  (typeof STUDY_ROUTE_AGENCY_CHANGE_KINDS)[number];
export type StudyRouteAgencyChangeTiming =
  (typeof STUDY_ROUTE_AGENCY_CHANGE_TIMINGS)[number];
export type StudyRouteAgencySupportLevel =
  (typeof STUDY_ROUTE_AGENCY_SUPPORT_LEVELS)[number];

export type StudyRouteAgencyModeResolution = DeepReadonly<{
  mode: StudyRouteAgencyMode;
  source: "exact" | "legacy_default";
  uncertainty: string | null;
}>;

export type StudyRouteAgencyModeDecision = DeepReadonly<{
  mode: StudyRouteAgencyMode;
  source:
    | "canonical_profile"
    | "uncertain_profile_default"
    | "missing_profile_default";
  uncertainty: string | null;
  evidenceRefs: string[];
}>;

export type StudyRouteChangeExplanation = DeepReadonly<{
  policyVersion: typeof STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION;
  previousRouteRevisionId: string;
  candidateRouteRevisionId: string;
  changedFields: StudyRouteMaterialChangeKind[];
  summary: string;
  recordedReason: string | null;
  evidenceRefs: string[];
}>;

export type StudyRouteAgencyDecision = DeepReadonly<{
  policyVersion: typeof STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION;
  status:
    | "unchanged"
    | "retained"
    | "deferred"
    | "confirmation_required"
    | "recommendation_available"
    | "applied";
  mode: StudyRouteAgencyMode;
  currentRoute: StudyRoute;
  candidateRoute: StudyRoute | null;
  supersededRoute: StudyRoute | null;
  explanation: StudyRouteChangeExplanation | null;
  reasonCode:
    | "no_material_change"
    | "insufficient_support"
    | "active_session_frozen"
    | "exact_confirmation_required"
    | "learner_selection_preserved"
    | "agency_policy_applied";
  requiredConfirmation: {
    policyVersion: typeof STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION;
    expectedRouteRevisionId: string;
    candidateRouteRevisionId: string;
  } | null;
}>;

export const AgencyMethodRequestResolutionSchema = z.object({
  policyVersion: z.literal(STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION),
  status: z.enum(["accepted", "mapped"]),
  mappingKind: z.enum([
    "exact_method",
    "recipe_alias",
    "eligibility_fallback",
    "timing_only",
    "unsupported_fallback",
  ]),
  requestedLabel: z.string().trim().min(1).max(100),
  requestedMethodId: z.enum(CORE_METHOD_IDS).nullable(),
  selectedMethodId: z.enum(CORE_METHOD_IDS),
  selectedMethodName: z.string().trim().min(2).max(100),
  conflictExplanation: z.string().trim().min(8).max(500).nullable(),
}).strict();

export type AgencyMethodRequestResolution = DeepReadonly<
  z.infer<typeof AgencyMethodRequestResolutionSchema>
>;

export type AgencyOtherMethodOption = DeepReadonly<{
  methodId: CoreMethodId;
  visibleMethodName: string;
}>;

export type ImmutableStudyRouteMethodEligibility = DeepReadonly<{
  policyVersion: MethodEligibilityPolicyVersion;
  methodIds: CoreMethodId[];
}>;

/**
 * Converts the persisted v1 spelling to the learner-facing agency contract.
 * A historical unknown value requires explicit confirmation. Missing
 * provenance must never be interpreted as learner-granted autonomy for an
 * automatic route change.
 */
export function agencyModeForStudyRouteControlMode(
  value: StudyRouteControlMode,
): StudyRouteAgencyModeResolution {
  const controlMode = StudyRouteControlModeSchema.parse(value);
  if (controlMode === "learner_customizes") {
    return deepFreeze({
      mode: "ill_customize" as const,
      source: "exact" as const,
      uncertainty: null,
    });
  }
  if (controlMode === "help_me_choose" || controlMode === "yova_decides") {
    return deepFreeze({
      mode: controlMode,
      source: "exact" as const,
      uncertainty: null,
    });
  }
  return deepFreeze({
    mode: "help_me_choose" as const,
    source: "legacy_default" as const,
    uncertainty: "The historical route did not record a learner agency mode, so any route change requires explicit confirmation without treating that fallback as a learner preference.",
  });
}

export function studyRouteControlModeForAgencyMode(
  value: StudyRouteAgencyMode,
): Exclude<StudyRouteControlMode, "legacy_unknown"> {
  const mode = StudyRouteAgencyModeSchema.parse(value);
  return mode === "ill_customize" ? "learner_customizes" : mode;
}

/**
 * Resolves the canonical questionnaire answer into the bounded agency mode
 * used when a new route is issued. Ambiguous and absent answers fail closed
 * to YOVA deciding, while retaining an explicit uncertainty instead of
 * pretending that default was the learner's preference.
 */
export function resolveStudyRouteAgencyMode(
  profileInput?: DeepReadonly<CanonicalLearnerProfile> | null,
): StudyRouteAgencyModeDecision {
  const parsedProfile = CanonicalLearnerProfileSchema.safeParse(profileInput);
  const signal = parsedProfile.success
    ? canonicalProfileSignal(parsedProfile.data, "control_mode")
    : null;
  if (!signal) {
    return deepFreeze({
      mode: "yova_decides" as const,
      source: "missing_profile_default" as const,
      uncertainty: "No authorized canonical control-mode answer is available, so YOVA uses its conservative agency default without treating it as a learner preference.",
      evidenceRefs: [],
    });
  }

  const evidenceRefs = [
    `canonical-profile:control_mode:${signal.sourceQuestionId}`,
  ];
  if (
    signal.value === "yova_decides"
    || signal.value === "help_me_choose"
    || signal.value === "ill_customize"
  ) {
    return deepFreeze({
      mode: signal.value,
      source: "canonical_profile" as const,
      uncertainty: null,
      evidenceRefs,
    });
  }

  return deepFreeze({
    mode: "yova_decides" as const,
    source: "uncertain_profile_default" as const,
    uncertainty: signal.value === "depends"
      ? "The learner said their preferred control mode depends on the situation, so YOVA uses its conservative agency default for this route."
      : "The learner was not sure which control mode they prefer, so YOVA uses its conservative agency default for this route.",
    evidenceRefs,
  });
}

/**
 * Produces the only alternatives stored on a route. Eligibility and runtime
 * capability are recomputed; a caller-provided ranking can order survivors
 * but can neither widen the eligible set nor exceed two choices.
 */
export function boundedAgencyMethodAlternatives({
  route: routeInput,
  orderedMethodIds,
  selectedMethodId,
  allowedMethodIds,
  eligibilityPolicyVersion = METHOD_ELIGIBILITY_POLICY_VERSION,
}: {
  route: StudyRoute;
  orderedMethodIds?: readonly CoreMethodId[];
  selectedMethodId?: CoreMethodId;
  /**
   * An already-authorized choice set, used by immutable route successors.
   * The controller still recomputes eligibility/runtime support, but it may
   * not introduce a method that the predecessor did not expose.
   */
  allowedMethodIds?: readonly CoreMethodId[];
  /** Immutable successors keep the predecessor's exact eligibility version. */
  eligibilityPolicyVersion?: MethodEligibilityPolicyVersion;
}): StudyRouteAlternative[] {
  const route = StudyRouteSchema.parse(routeInput);
  const context = methodContext(route);
  const allowed = allowedMethodIds ? new Set(allowedMethodIds) : null;
  const eligible = eligibleMethodIdsForPolicyVersion(
    context,
    eligibilityPolicyVersion,
  ).filter((methodId) => (
    !allowed || allowed.has(methodId)
  ));
  const eligibleSet = new Set(eligible);
  const requestedOrder = orderedMethodIds ?? eligible;
  const selected = selectedMethodId ?? route.approach.primaryMethodId;
  if (!eligibleSet.has(selected)) {
    throw new Error("Agency alternatives require an eligible selected method.");
  }
  const ordered = unique([
    ...requestedOrder.filter((methodId) => eligibleSet.has(methodId)),
    ...eligible,
  ]);

  return ordered
    .filter((methodId) => methodId !== selected)
    .filter((methodId) => methodRuntimeCapabilityFor({
      methodId,
      ...context,
      executionEnvironment: route.approach.executionEnvironment,
    }).status === "supported")
    .slice(0, 2)
    .map((methodId) => StudyRouteAlternativeSchema.parse({
      alternativeId: `method-alternative:${methodId}`,
      mode: route.approach.mode,
      executionEnvironment: route.approach.executionEnvironment,
      primaryMethodId: methodId,
      visibleMethodName: CORE_METHOD_CATALOG[methodId].name,
      activeMinutes: route.timing.activeMinutes,
      tradeoff: agencyMethodTradeoff(route, methodId),
    }));
}

/**
 * Exact stored-option boundary for the ordinary draft and committed choice
 * scope. The separate Other-method scope must use the immutable eligibility
 * cohort and never treats this predicate as broader authority.
 */
export function isExactStoredAgencyMethodChoice(
  routeInput: StudyRoute,
  methodId: CoreMethodId,
) {
  const route = StudyRouteSchema.parse(routeInput);
  const offered = route.agency.alternatives.find((alternative) => (
    alternative.primaryMethodId === methodId
  ));
  if (!offered) return false;

  const legacyTradeoff = `${offered.visibleMethodName} also fits this task and stage, but it would use a different practice sequence.`;
  return offered.mode === route.approach.mode
    && offered.executionEnvironment === route.approach.executionEnvironment
    && offered.activeMinutes === route.timing.activeMinutes
    && isRecognizedCoreMethodName(methodId, offered.visibleMethodName)
    && (
      offered.tradeoff === agencyMethodTradeoff(route, methodId)
      || offered.tradeoff === legacyTradeoff
    );
}

/**
 * Resolves an eligible catalog choice or maps a recognizable questionable
 * request onto a deterministic safe implementation. An optional allow-list
 * lets a narrow API preserve its already-authenticated choice set.
 */
export function resolveAgencyMethodRequest({
  route: routeInput,
  requestedMethod,
  allowedMethodIds,
  eligibilityPolicyVersion = METHOD_ELIGIBILITY_POLICY_VERSION,
}: {
  route: StudyRoute;
  requestedMethod: string;
  allowedMethodIds?: readonly CoreMethodId[];
  eligibilityPolicyVersion?: MethodEligibilityPolicyVersion;
}): AgencyMethodRequestResolution {
  const route = StudyRouteSchema.parse(routeInput);
  const requestedLabel = z.string().trim().min(1).max(100).parse(requestedMethod);
  const context = methodContext(route);
  const eligible = eligibleMethodIdsForPolicyVersion(
    context,
    eligibilityPolicyVersion,
  ).filter((methodId) => (
    methodRuntimeCapabilityFor({
      methodId,
      ...context,
      executionEnvironment: route.approach.executionEnvironment,
    }).status === "supported"
  ));
  const allowedSet = allowedMethodIds
    ? new Set(allowedMethodIds)
    : null;
  const safeMethods = eligible.filter((methodId) => !allowedSet || allowedSet.has(methodId));
  if (safeMethods.length === 0) {
    throw new Error("An agency method request needs at least one eligible, deliverable implementation.");
  }

  const normalized = normalizeMethodLabel(requestedLabel);
  if (
    normalizeMethodLabel(route.approach.visibleMethodName) === normalized
    && safeMethods.includes(route.approach.primaryMethodId)
  ) {
    return methodRequestResult({
      status: "accepted",
      mappingKind: "exact_method",
      requestedLabel,
      requestedMethodId: route.approach.primaryMethodId,
      selectedMethodId: route.approach.primaryMethodId,
      conflictExplanation: null,
    });
  }

  const catalogMethodId = catalogMethodIdForLabel(normalized);
  if (catalogMethodId && safeMethods.includes(catalogMethodId)) {
    return methodRequestResult({
      status: "accepted",
      mappingKind: "exact_method",
      requestedLabel,
      requestedMethodId: catalogMethodId,
      selectedMethodId: catalogMethodId,
      conflictExplanation: null,
    });
  }

  const alias = QUESTIONABLE_METHOD_ALIASES[normalized];
  if (alias?.kind === "timing_only") {
    const selectedMethodId = safeMethods.includes(route.approach.primaryMethodId)
      ? route.approach.primaryMethodId
      : safeMethods[0]!;
    return methodRequestResult({
      status: "mapped",
      mappingKind: "timing_only",
      requestedLabel,
      requestedMethodId: null,
      selectedMethodId,
      conflictExplanation: `${requestedLabel} is a timing option rather than a primary learning method. YOVA kept ${CORE_METHOD_CATALOG[selectedMethodId].name}; a timed break can be handled separately when the route permits one.`,
    });
  }

  const requestedBasis = catalogMethodId ?? alias?.methodIds[0] ?? null;
  const preferences = catalogMethodId
    ? [catalogMethodId, ...(SAFE_METHOD_NEIGHBORS[catalogMethodId] ?? [])]
    : alias?.methodIds ?? [];
  const selectedMethodId = preferences.find((methodId) => safeMethods.includes(methodId))
    ?? (safeMethods.includes(route.approach.primaryMethodId)
      ? route.approach.primaryMethodId
      : safeMethods[0]!);
  const mappingKind = alias
    ? "recipe_alias" as const
    : catalogMethodId
      ? "eligibility_fallback" as const
      : "unsupported_fallback" as const;
  const conflictExplanation = alias
    ? `${requestedLabel} is not a standalone eligible recipe for this ${routeModeLabel(route)} route. YOVA maps it to ${CORE_METHOD_CATALOG[selectedMethodId].name}, the first compatible implementation in its bounded safe mapping.`
    : catalogMethodId
      ? `${CORE_METHOD_CATALOG[catalogMethodId].name} conflicts with this task, target stage, or Learn/Practice boundary. YOVA maps it to ${CORE_METHOD_CATALOG[selectedMethodId].name}, the closest deliverable option in the deterministic compatibility order.`
      : `YOVA could not verify ${requestedLabel} as a supported primary method for this route. It maps the request to ${CORE_METHOD_CATALOG[selectedMethodId].name} instead of inventing an unsafe recipe.`;

  return methodRequestResult({
    status: "mapped",
    mappingKind,
    requestedLabel,
    requestedMethodId: requestedBasis,
    selectedMethodId,
    conflictExplanation,
  });
}

/**
 * Safe foundation for the I'll Customize “Other methods” interaction. The
 * free-text label may be broad or questionable, but its implementation can
 * resolve only inside the exact eligibility cohort already recorded on this
 * immutable route. A committed choice still needs a direct authenticated
 * successor and the database independently checks the same predecessor cohort.
 */
export function resolveBoundedOtherMethodRequest({
  route: routeInput,
  requestedMethod,
}: {
  route: StudyRoute;
  requestedMethod: string;
}): AgencyMethodRequestResolution {
  const route = StudyRouteSchema.parse(routeInput);
  const mode = agencyModeForStudyRouteControlMode(route.agency.controlMode).mode;
  if (mode !== "ill_customize") {
    throw new Error("Other methods is available only when the learner chose I'll Customize.");
  }
  const eligibility = immutableStudyRouteMethodEligibility(route);
  return resolveAgencyMethodRequest({
    route,
    requestedMethod,
    allowedMethodIds: eligibility.methodIds,
    eligibilityPolicyVersion: eligibility.policyVersion,
  });
}

/**
 * Returns the additional catalog choices that may be shown beneath the two
 * ordinary alternatives for I'll Customize. The list is derived only from
 * the immutable eligibility decision on the committed route, excludes the
 * current/stored choices, and removes methods without a deliverable runtime.
 */
export function boundedOtherAgencyMethodOptions(
  routeInput: StudyRoute,
): AgencyOtherMethodOption[] {
  const route = StudyRouteSchema.parse(routeInput);
  if (agencyModeForStudyRouteControlMode(route.agency.controlMode).mode !== "ill_customize") {
    return [];
  }
  const context = methodContext(route);
  const alreadyVisible = new Set<CoreMethodId>([
    route.approach.primaryMethodId,
    ...route.agency.alternatives.map((alternative) => alternative.primaryMethodId),
  ]);

  return immutableRouteEligibleMethodIds(route)
    .filter((methodId) => !alreadyVisible.has(methodId))
    .filter((methodId) => methodRuntimeCapabilityFor({
      methodId,
      ...context,
      executionEnvironment: route.approach.executionEnvironment,
    }).status === "supported")
    .map((methodId) => deepFreeze({
      methodId,
      visibleMethodName: CORE_METHOD_CATALOG[methodId].name,
    }));
}

export function isAuthorizedOtherMethodChoice(
  routeInput: StudyRoute,
  methodId: CoreMethodId,
) {
  const route = StudyRouteSchema.parse(routeInput);
  if (agencyModeForStudyRouteControlMode(route.agency.controlMode).mode !== "ill_customize") {
    return false;
  }
  try {
    return immutableRouteEligibleMethodIds(route).includes(methodId)
      && methodRuntimeCapabilityFor({
        methodId,
        ...methodContext(route),
        executionEnvironment: route.approach.executionEnvironment,
      }).status === "supported";
  } catch {
    return false;
  }
}

/**
 * Applies the three agency contracts to one exact provisional direct
 * successor. It never mutates the current route or commits a stale candidate.
 */
export function resolveStudyRouteAgencyChange({
  previousRoute: previousInput,
  candidateRoute: candidateInput,
  mode: modeInput,
  changeKind,
  support,
  timing,
  decidedAt,
  confirmation,
}: {
  previousRoute: StudyRoute;
  candidateRoute?: StudyRoute | null;
  mode: StudyRouteAgencyMode;
  changeKind: StudyRouteAgencyChangeKind;
  support: StudyRouteAgencySupportLevel;
  timing: StudyRouteAgencyChangeTiming;
  decidedAt: string;
  confirmation?: StudyRouteAgencyConfirmation | null;
}): StudyRouteAgencyDecision {
  const previous = StudyRouteSchema.parse(previousInput);
  const mode = StudyRouteAgencyModeSchema.parse(modeInput);
  if (previous.identity.lifecycleStatus !== "committed") {
    throw new Error("An agency route decision requires the exact committed predecessor.");
  }
  assertEnumValue(changeKind, STUDY_ROUTE_AGENCY_CHANGE_KINDS, "agency change kind");
  assertEnumValue(support, STUDY_ROUTE_AGENCY_SUPPORT_LEVELS, "agency support level");
  assertEnumValue(timing, STUDY_ROUTE_AGENCY_CHANGE_TIMINGS, "agency change timing");
  assertCanonicalTimestamp(decidedAt, previous.identity.committedAt!);

  if (!candidateInput) {
    if (confirmation) throw new Error("A route confirmation cannot exist without a candidate revision.");
    return agencyDecision({
      status: "unchanged",
      mode,
      currentRoute: previous,
      candidateRoute: null,
      supersededRoute: null,
      explanation: null,
      reasonCode: "no_material_change",
      requiredConfirmation: null,
    });
  }

  const candidate = StudyRouteSchema.parse(candidateInput);
  assertDirectProvisionalSuccessor(previous, candidate);
  assertCanonicalTimestamp(decidedAt, candidate.identity.createdAt);
  const explanation = explainStudyRouteChange(previous, candidate);
  if (explanation.changedFields.length === 0) {
    if (confirmation) throw new Error("A no-op candidate cannot consume an agency confirmation.");
    return agencyDecision({
      status: "unchanged",
      mode,
      currentRoute: previous,
      candidateRoute: null,
      supersededRoute: null,
      explanation,
      reasonCode: "no_material_change",
      requiredConfirmation: null,
    });
  }

  if (timing === "in_session") {
    if (confirmation) throw new Error("An active session cannot confirm a material route successor.");
    return agencyDecision({
      status: "deferred",
      mode,
      currentRoute: previous,
      candidateRoute: prepareAgencyCandidate({
        previous,
        candidate,
        mode,
        changeKind,
        decidedAt,
        explanation,
        decisionResult: "deferred_until_between_sessions",
      }),
      supersededRoute: null,
      explanation,
      reasonCode: "active_session_frozen",
      requiredConfirmation: null,
    });
  }

  if (changeKind !== "learner_request" && support !== "sufficient") {
    if (confirmation) throw new Error("An unsupported route candidate cannot consume a confirmation.");
    return agencyDecision({
      status: "retained",
      mode,
      currentRoute: previous,
      candidateRoute: null,
      supersededRoute: null,
      explanation,
      reasonCode: "insufficient_support",
      requiredConfirmation: null,
    });
  }

  const confirmationRequired = mode === "help_me_choose";
  if (confirmationRequired && !confirmation) {
    const prepared = prepareAgencyCandidate({
      previous,
      candidate,
      mode,
      changeKind,
      decidedAt,
      explanation,
      decisionResult: "awaiting_exact_confirmation",
    });
    return agencyDecision({
      status: "confirmation_required",
      mode,
      currentRoute: previous,
      candidateRoute: prepared,
      supersededRoute: null,
      explanation,
      reasonCode: "exact_confirmation_required",
      requiredConfirmation: {
        policyVersion: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
        expectedRouteRevisionId: previous.identity.routeRevisionId,
        candidateRouteRevisionId: candidate.identity.routeRevisionId,
      },
    });
  }

  if (confirmationRequired) {
    assertExactAgencyConfirmation({
      confirmation: StudyRouteAgencyConfirmationSchema.parse(confirmation),
      previous,
      candidate,
      decidedAt,
    });
  } else if (confirmation) {
    throw new Error("Only Help Me Choose accepts a separate route confirmation.");
  }

  if (mode === "ill_customize" && changeKind === "system_recommendation") {
    const prepared = prepareAgencyCandidate({
      previous,
      candidate,
      mode,
      changeKind,
      decidedAt,
      explanation,
      decisionResult: "recommendation_preserved_beside_learner_selection",
    });
    return agencyDecision({
      status: "recommendation_available",
      mode,
      currentRoute: previous,
      candidateRoute: prepared,
      supersededRoute: null,
      explanation,
      reasonCode: "learner_selection_preserved",
      requiredConfirmation: null,
    });
  }

  const appliedAt = confirmation?.confirmedAt ?? decidedAt;
  const prepared = prepareAgencyCandidate({
    previous,
    candidate,
    mode,
    changeKind,
    decidedAt: appliedAt,
    explanation,
    decisionResult: "committed_direct_successor",
    learnerConfirmed: Boolean(confirmation),
  });
  const committed = StudyRouteSchema.parse(
    commitStudyRouteRevision(StudyRouteSchema.parse(prepared), appliedAt),
  );
  const superseded = StudyRouteSchema.parse(
    supersedeStudyRouteRevision(previous, committed),
  );
  return agencyDecision({
    status: "applied",
    mode,
    currentRoute: committed,
    candidateRoute: committed,
    supersededRoute: superseded,
    explanation,
    reasonCode: "agency_policy_applied",
    requiredConfirmation: null,
  });
}

/** Builds “what changed” only from exact route fields and appended rule trace. */
export function explainStudyRouteChange(
  previousInput: StudyRoute,
  candidateInput: StudyRoute,
): StudyRouteChangeExplanation {
  const previous = StudyRouteSchema.parse(previousInput);
  const candidate = StudyRouteSchema.parse(candidateInput);
  if (
    candidate.identity.routeLineageId !== previous.identity.routeLineageId
    || candidate.identity.planId !== previous.identity.planId
    || candidate.identity.sessionId !== previous.identity.sessionId
  ) {
    throw new Error("A change explanation requires two revisions from the same route lineage.");
  }
  const changedFields = materialStudyRouteChanges(previous, candidate);
  const appendedTrace = appendedRuleTrace(previous, candidate);
  const materialTrace = appendedTrace.findLast((entry) => (
    entry.ruleId === "study_route.material_successor"
  ));
  if (changedFields.length > 0 && !materialTrace) {
    throw new Error("A material route change needs its exact successor reason in the rule trace.");
  }
  const newEvidenceRefs = unique([
    ...candidate.provenance.evidenceRefs.filter((reference) => (
      !previous.provenance.evidenceRefs.includes(reference)
    )),
    ...appendedTrace.flatMap((entry) => entry.evidenceRefs),
  ]);
  const sentences = changedFields.map((field) => changeSentence(field, previous, candidate));
  return deepFreeze({
    policyVersion: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
    previousRouteRevisionId: previous.identity.routeRevisionId,
    candidateRouteRevisionId: candidate.identity.routeRevisionId,
    changedFields,
    summary: sentences.length > 0
      ? sentences.join(" ")
      : "No material recipe decision changed, so the committed revision stays in place.",
    recordedReason: materialTrace?.reason ?? null,
    evidenceRefs: newEvidenceRefs,
  });
}

export function agencyMethodTradeoff(routeInput: StudyRoute, methodId: CoreMethodId) {
  const route = StudyRouteSchema.parse(routeInput);
  const method = CORE_METHOD_CATALOG[methodId];
  const task = route.target.taskFamily.replaceAll("_", " ");
  const mode = route.approach.mode === "learn" ? "Learn" : "Practice";
  const sentence = `${method.name} also fits this ${task} ${mode} session. ${method.what}`;
  return sentence.slice(0, 300);
}

function prepareAgencyCandidate({
  previous,
  candidate,
  mode,
  changeKind,
  decidedAt,
  explanation,
  decisionResult,
  learnerConfirmed = false,
}: {
  previous: StudyRoute;
  candidate: StudyRoute;
  mode: StudyRouteAgencyMode;
  changeKind: StudyRouteAgencyChangeKind;
  decidedAt: string;
  explanation: StudyRouteChangeExplanation;
  decisionResult: string;
  learnerConfirmed?: boolean;
}) {
  const learnerSelected = changeKind === "learner_request" || learnerConfirmed;
  const tracePrefix = candidate.provenance.ruleTrace.slice(
    0,
    previous.provenance.ruleTrace.length,
  );
  const candidateTrace = candidate.provenance.ruleTrace
    .slice(previous.provenance.ruleTrace.length)
    .filter((entry) => entry.ruleId !== STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION);
  const trace = StudyRouteRuleTraceEntrySchema.parse({
    ruleId: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
    result: `${mode}:${decisionResult}:${explanation.changedFields.join(",")}`,
    reason: agencyDecisionTraceReason(mode, decisionResult, changeKind),
    evidenceRefs: explanation.evidenceRefs.slice(0, 40),
  });
  const routerVersion = StudyRouteProvenanceSchema.shape.routerVersion.parse(unique([
    ...candidate.provenance.routerVersion.split("+").filter(Boolean),
    STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
  ]).join("+"));
  const overrideReason = explanation.recordedReason?.slice(0, 300)
    ?? explanation.summary.slice(0, 300);

  return freezeStudyRoute({
    ...candidate,
    agency: {
      ...candidate.agency,
      controlMode: studyRouteControlModeForAgencyMode(mode),
      selectedBy: learnerSelected ? "learner" : "yova",
      ...(learnerSelected
        ? {
            override: {
              requestedAt: decidedAt,
              changedFields: explanation.changedFields,
              reason: overrideReason,
            },
          }
        : { override: undefined }),
    },
    provenance: {
      ...candidate.provenance,
      routerVersion,
      ruleTrace: [...tracePrefix, ...candidateTrace, trace],
    },
  });
}

function assertDirectProvisionalSuccessor(previous: StudyRoute, candidate: StudyRoute) {
  if (
    candidate.identity.lifecycleStatus !== "provisional"
    || candidate.identity.routeLineageId !== previous.identity.routeLineageId
    || candidate.identity.planId !== previous.identity.planId
    || candidate.identity.sessionId !== previous.identity.sessionId
    || candidate.identity.revisionNumber !== previous.identity.revisionNumber + 1
    || candidate.identity.supersedesRevisionId !== previous.identity.routeRevisionId
    || candidate.identity.routeRevisionId === previous.identity.routeRevisionId
  ) {
    throw new Error("The agency candidate is not the exact provisional direct successor.");
  }
  assertCanonicalTimestamp(
    candidate.identity.createdAt,
    previous.identity.committedAt!,
  );
  appendedRuleTrace(previous, candidate);
}

function appendedRuleTrace(previous: StudyRoute, candidate: StudyRoute) {
  const prefix = candidate.provenance.ruleTrace.slice(0, previous.provenance.ruleTrace.length);
  if (
    prefix.length !== previous.provenance.ruleTrace.length
    || stableFingerprint(prefix, "agency-rule-trace-prefix")
      !== stableFingerprint(previous.provenance.ruleTrace, "agency-rule-trace-prefix")
  ) {
    throw new Error("A StudyRoute successor must retain its predecessor rule trace unchanged.");
  }
  return candidate.provenance.ruleTrace.slice(previous.provenance.ruleTrace.length);
}

function assertExactAgencyConfirmation({
  confirmation,
  previous,
  candidate,
  decidedAt,
}: {
  confirmation: StudyRouteAgencyConfirmation;
  previous: StudyRoute;
  candidate: StudyRoute;
  decidedAt: string;
}) {
  if (
    confirmation.expectedRouteRevisionId !== previous.identity.routeRevisionId
    || confirmation.candidateRouteRevisionId !== candidate.identity.routeRevisionId
  ) {
    throw new Error("The agency confirmation is stale or belongs to another route candidate.");
  }
  assertCanonicalTimestamp(confirmation.confirmedAt, decidedAt);
}

function methodContext(route: StudyRoute) {
  const targetStates = activeStudyRouteTargetStates(route);
  if (targetStates.length === 0) {
    throw new Error("Agency method routing needs at least one active target.");
  }
  const stages = targetStates.map((target) => target.stage);
  const knowledgeStage = stages.includes("novice")
    ? "novice" as const
    : stages.includes("developing")
      ? "developing" as const
      : "retrieval_ready" as const;
  return {
    taskType: route.target.taskFamily,
    knowledgeStage,
    learningMode: route.approach.mode === "learn" ? "learn" as const : "study" as const,
  };
}

export function immutableStudyRouteMethodEligibility(
  routeInput: StudyRoute,
): ImmutableStudyRouteMethodEligibility {
  const route = StudyRouteSchema.parse(routeInput);
  const traces = route.provenance.ruleTrace.filter((entry) => (
    METHOD_ELIGIBILITY_POLICY_VERSIONS.includes(
      entry.ruleId as MethodEligibilityPolicyVersion,
    )
  ));
  const policyVersions = unique(traces.map((entry) => entry.ruleId));
  if (policyVersions.length > 1) {
    throw new Error("The immutable route contains conflicting eligibility policy versions.");
  }
  const policyVersion = policyVersions[0] as MethodEligibilityPolicyVersion | undefined;
  const trace = policyVersion
    ? traces.findLast((entry) => entry.ruleId === policyVersion)
    : null;
  if (!policyVersion || !trace) {
    throw new Error("Other methods requires the immutable route eligibility decision.");
  }
  const methodIds = trace.result.split(",").filter(Boolean);
  if (
    methodIds.length === 0
    || methodIds.length > CORE_METHOD_IDS.length
    || new Set(methodIds).size !== methodIds.length
    || methodIds.some((methodId) => !CORE_METHOD_IDS.includes(methodId as CoreMethodId))
  ) {
    throw new Error("The immutable route eligibility decision is invalid.");
  }
  const authorized = methodIds as CoreMethodId[];
  const current = eligibleMethodIdsForPolicyVersion(
    methodContext(route),
    policyVersion,
  );
  if (
    authorized.length !== current.length
    || authorized.some((methodId, index) => methodId !== current[index])
  ) {
    throw new Error("The immutable route eligibility decision is stale for the current policy.");
  }
  return deepFreeze({ policyVersion, methodIds: authorized });
}

/**
 * Historical routes issued before eligibility provenance may still execute an
 * exact alternative already stored on the route. They use the deployed v2
 * policy that was current when those routes were created; only Other methods
 * requires a present immutable trace. A present trace is always validated and
 * can never fall back after a conflict or stale-cohort failure.
 */
export function storedAgencyChoiceEligibilityPolicyVersion(
  routeInput: StudyRoute,
): MethodEligibilityPolicyVersion {
  const route = StudyRouteSchema.parse(routeInput);
  const hasVersionedTrace = route.provenance.ruleTrace.some((entry) => (
    METHOD_ELIGIBILITY_POLICY_VERSIONS.includes(
      entry.ruleId as MethodEligibilityPolicyVersion,
    )
  ));
  return hasVersionedTrace
    ? immutableStudyRouteMethodEligibility(route).policyVersion
    : LEGACY_METHOD_ELIGIBILITY_POLICY_VERSION;
}

function immutableRouteEligibleMethodIds(route: StudyRoute) {
  return immutableStudyRouteMethodEligibility(route).methodIds;
}

function methodRequestResult({
  status,
  mappingKind,
  requestedLabel,
  requestedMethodId,
  selectedMethodId,
  conflictExplanation,
}: Omit<AgencyMethodRequestResolution, "policyVersion" | "selectedMethodName">) {
  return deepFreeze(AgencyMethodRequestResolutionSchema.parse({
    policyVersion: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
    status,
    mappingKind,
    requestedLabel,
    requestedMethodId,
    selectedMethodId,
    selectedMethodName: CORE_METHOD_CATALOG[selectedMethodId].name,
    conflictExplanation,
  }));
}

function catalogMethodIdForLabel(normalized: string) {
  return CORE_METHOD_IDS.find((methodId) => (
    normalizeMethodLabel(methodId) === normalized
    || recognizedCoreMethodNames(methodId).some((name) => (
      normalizeMethodLabel(name) === normalized
    ))
  )) ?? null;
}

function normalizeMethodLabel(value: string) {
  return value.normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[’']/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function routeModeLabel(route: StudyRoute) {
  return `${route.target.taskFamily.replaceAll("_", " ")} ${route.approach.mode === "learn" ? "Learn" : "Practice"}`;
}

function changeSentence(
  field: StudyRouteMaterialChangeKind,
  previous: StudyRoute,
  candidate: StudyRoute,
) {
  switch (field) {
    case "targets":
      return `Target coverage changed from ${activeStudyRouteTargetStates(previous).length} to ${activeStudyRouteTargetStates(candidate).length} active target${activeStudyRouteTargetStates(candidate).length === 1 ? "" : "s"}.`;
    case "mode":
      return `Session type changed from ${modeName(previous)} to ${modeName(candidate)}.`;
    case "execution_environment":
      return `Execution changed from ${environmentName(previous)} to ${environmentName(candidate)}.`;
    case "primary_method":
      return `Primary method changed from ${previous.approach.visibleMethodName} to ${candidate.approach.visibleMethodName}.`;
    case "method_recipe":
      return `The supporting method recipe changed from ${previous.approach.visibleSupportingTechniqueId ?? "none"} to ${candidate.approach.visibleSupportingTechniqueId ?? "none"}.`;
    case "duration":
      return `Duration changed from ${previous.timing.activeMinutes} active/${previous.timing.elapsedMinutes} elapsed minutes to ${candidate.timing.activeMinutes} active/${candidate.timing.elapsedMinutes} elapsed minutes.`;
    case "phase_order":
      return `The phase recipe changed from ${phaseNames(previous)} to ${phaseNames(candidate)}.`;
    case "support_bounds":
      return `Starting support changed from ${supportName(previous)} to ${supportName(candidate)}.`;
    case "review_contract":
      return "The completion or future-review evidence contract changed.";
  }
}

function modeName(route: StudyRoute) {
  return route.approach.mode === "learn" ? "Learn" : "Practice";
}

function environmentName(route: StudyRoute) {
  return route.approach.executionEnvironment === "inside_yova"
    ? "inside YOVA"
    : "outside YOVA";
}

function phaseNames(route: StudyRoute) {
  return route.execution.orderedPhases
    .map((phase) => phase.methodPhase.replaceAll("_", " "))
    .join(" → ");
}

function supportName(route: StudyRoute) {
  return `${route.execution.initialSupport.replaceAll("_", " ")} at ${route.execution.difficultyTier.replaceAll("_", " ")} difficulty`;
}

function agencyDecisionTraceReason(
  mode: StudyRouteAgencyMode,
  decisionResult: string,
  changeKind: StudyRouteAgencyChangeKind,
) {
  return `The versioned agency controller applied ${mode} to a ${changeKind.replaceAll("_", " ")} and recorded ${decisionResult.replaceAll("_", " ")} against the exact predecessor and candidate revisions.`;
}

function agencyDecision(
  input: Omit<StudyRouteAgencyDecision, "policyVersion">,
): StudyRouteAgencyDecision {
  return deepFreeze({
    policyVersion: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
    ...input,
  });
}

function assertCanonicalTimestamp(value: string, notBefore: string) {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString() !== value
    || timestamp < Date.parse(notBefore)
  ) {
    throw new Error("An agency decision needs a canonical timestamp at or after its route boundary.");
  }
}

function assertEnumValue<const Values extends readonly string[]>(
  value: string,
  values: Values,
  label: string,
): asserts value is Values[number] {
  if (!values.includes(value)) throw new Error(`Unsupported ${label}.`);
}

const SAFE_METHOD_NEIGHBORS: Readonly<
  Partial<Record<CoreMethodId, readonly CoreMethodId[]>>
> = {
  retrieval_practice: ["self_explanation", "read_recall_review", "practice_test_error_repair"],
  spaced_retrieval: ["retrieval_practice", "practice_test_error_repair"],
  self_explanation: ["concept_mapping", "read_recall_review", "worked_example_fading", "retrieval_practice"],
  worked_example_fading: ["pretesting", "self_explanation", "scaffolded_coding", "practice_problems"],
  interleaved_practice: ["practice_problems", "practice_test_error_repair", "worked_example_fading", "retrieval_practice"],
  read_recall_review: ["concept_mapping", "self_explanation", "pretesting", "retrieval_practice"],
  pretesting: ["worked_example_fading", "self_explanation", "retrieval_practice"],
  concept_mapping: ["self_explanation", "read_recall_review", "retrieval_practice"],
  practice_problems: ["worked_example_fading", "interleaved_practice", "practice_test_error_repair"],
  retrieval_based_outlining: ["self_explanation", "practice_test_error_repair"],
  scaffolded_coding: ["worked_example_fading", "interleaved_practice"],
  practice_test_error_repair: ["interleaved_practice", "retrieval_practice", "worked_example_fading"],
};

const QUESTIONABLE_METHOD_ALIASES: Readonly<Record<
  string,
  | { kind: "recipe_alias"; methodIds: readonly CoreMethodId[] }
  | { kind: "timing_only"; methodIds: readonly [] }
>> = {
  "feynman": { kind: "recipe_alias", methodIds: ["self_explanation"] },
  "feynman technique": { kind: "recipe_alias", methodIds: ["self_explanation"] },
  "sq3r": { kind: "recipe_alias", methodIds: ["read_recall_review", "self_explanation"] },
  "flashcards": { kind: "recipe_alias", methodIds: ["spaced_retrieval", "retrieval_practice"] },
  "flash cards": { kind: "recipe_alias", methodIds: ["spaced_retrieval", "retrieval_practice"] },
  "pretesting": { kind: "recipe_alias", methodIds: ["retrieval_practice", "self_explanation", "worked_example_fading"] },
  "pretest": { kind: "recipe_alias", methodIds: ["pretesting", "retrieval_practice", "self_explanation", "worked_example_fading"] },
  "concept mapping": { kind: "recipe_alias", methodIds: ["self_explanation", "read_recall_review"] },
  "concept map": { kind: "recipe_alias", methodIds: ["concept_mapping", "self_explanation", "read_recall_review"] },
  "practice problems": { kind: "recipe_alias", methodIds: ["practice_test_error_repair", "interleaved_practice", "worked_example_fading"] },
  "problem sets": { kind: "recipe_alias", methodIds: ["practice_problems", "practice_test_error_repair", "interleaved_practice", "worked_example_fading"] },
  "highlighting": { kind: "recipe_alias", methodIds: ["read_recall_review", "self_explanation", "retrieval_practice"] },
  "rereading": { kind: "recipe_alias", methodIds: ["read_recall_review", "self_explanation", "retrieval_practice"] },
  "cramming": { kind: "recipe_alias", methodIds: ["retrieval_practice", "spaced_retrieval"] },
  "pomodoro": { kind: "timing_only", methodIds: [] },
  "pomodoro technique": { kind: "timing_only", methodIds: [] },
};

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type DeepReadonly<T> = T extends Primitive | ((...args: never[]) => unknown)
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : { readonly [Key in keyof T]: DeepReadonly<T[Key]> };

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
