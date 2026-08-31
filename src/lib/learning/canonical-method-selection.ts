import { z } from "zod";
import type { SessionLearningMode } from "@/lib/domain";
import {
  CORE_METHOD_CATALOG,
  type CoreMethodId,
  type LearningTaskType,
} from "@/lib/learning/method-catalog";
import {
  eligibleMethodIdsForPolicyVersion,
  METHOD_ELIGIBILITY_POLICY_VERSION,
  type MethodEligibilityPolicyVersion,
  type KnowledgeStage,
} from "@/lib/learning/method-eligibility";
import {
  methodOutcomeSupportsMethodRanking,
  type MethodOutcomeSignal,
} from "@/lib/personalization/method-outcomes";
import { selectPersonalizedMethodTie } from "@/lib/personalization/personalization-evidence";
import {
  GenerationPersonalizationContextSchema,
  type GenerationPersonalizationContext,
} from "@/lib/personalization/personalization-generation";
import {
  StudyRouteRuleTraceEntrySchema,
  type StudyRouteRuleTraceEntry,
} from "@/lib/study-route/schema";
import { METHOD_EVIDENCE_MINIMUM_DISTINCT_STUDY_DAYS } from "@/lib/study-route/method-evidence-policy";

export const CANONICAL_METHOD_SELECTION_POLICY_VERSION =
  "canonical_method_selection_v1" as const;

export const METHOD_SELECTION_AUTHORITIES = [
  "committed_route",
  "learner_choice",
  "observed_outcomes",
  "authorized_declaration",
  "continuity",
  "legacy_compatibility",
  "task_baseline",
] as const;

export type MethodSelectionAuthority =
  (typeof METHOD_SELECTION_AUTHORITIES)[number];

export type CanonicalObservedMethodEvidence = {
  /**
   * Privacy-safe categorical cohort key. It contains no target, source, route,
   * or learner prose and must exactly match the route currently being chosen.
   */
  comparisonKey: string;
  signal: MethodOutcomeSignal;
  /** Durable attempt, event, or route references; never raw learner answers. */
  evidenceRefs: readonly string[];
  /** Four same-day repetitions do not count like evidence across separate days. */
  distinctStudyDays: number;
  latestObservedAt: string;
};

export type CanonicalMethodSelectionInput = {
  taskType: LearningTaskType;
  knowledgeStage: KnowledgeStage;
  learningMode: SessionLearningMode;
  /** Defaults to the current policy; immutable successors pass their stored version. */
  eligibilityPolicyVersion?: MethodEligibilityPolicyVersion;
  /** An exact accepted route is immutable for the lifetime of that revision. */
  committedRoute?: {
    methodId: CoreMethodId;
    routeRevisionId: string;
  } | null;
  /** A deliberate choice for this route, not a durable profile preference. */
  learnerChoice?: {
    methodId: CoreMethodId;
    evidenceRef: string;
  } | null;
  observedEvidence?: readonly CanonicalObservedMethodEvidence[];
  /**
   * Exact privacy-safe comparison cohort for the route being selected.
   * Observed evidence is deliberately inert when this key is absent.
   */
  currentComparisonKey?: string | null;
  /** Already-authorized, typed, correctable learner signals. */
  personalization?: DeepReadonly<GenerationPersonalizationContext> | null;
  /** A prior comparable route that remains eligible for this target. */
  continuity?: {
    methodId: CoreMethodId;
    routeRevisionId: string;
  } | null;
  /** Explicit route-free compatibility only; generated plan prose is not authority. */
  legacyCompatibilityMethodId?: CoreMethodId | null;
};

export type CanonicalMethodSelection = {
  policyVersion: typeof CANONICAL_METHOD_SELECTION_POLICY_VERSION;
  eligibilityPolicyVersion: MethodEligibilityPolicyVersion;
  taskType: LearningTaskType;
  knowledgeStage: KnowledgeStage;
  learningMode: SessionLearningMode;
  selectedMethodId: CoreMethodId;
  selectedMethodName: string;
  authority: MethodSelectionAuthority;
  baselineMethodId: CoreMethodId;
  changedFromBaseline: boolean;
  /** Baseline eligibility order, before an authority selects one survivor. */
  eligibleMethodIds: CoreMethodId[];
  /** Selected method first, followed by the unchanged deterministic baseline order. */
  orderedMethodIds: CoreMethodId[];
  learnerFacingReason: string;
  evidenceRefs: string[];
  ruleTrace: StudyRouteRuleTraceEntry[];
  /** Negative or incomplete evidence changes support, not the named method. */
  supportOnlyMethodIds: CoreMethodId[];
  /** Experimental evidence is deliberately inert in v1. */
  ignoredExperimentalSignalIds: string[];
};

export type CanonicalMethodSelectionResult = DeepReadonly<CanonicalMethodSelection>;

export type CanonicalMethodSelectionErrorCode =
  | "committed_method_ineligible"
  | "learner_choice_ineligible";

export class CanonicalMethodSelectionError extends Error {
  readonly code: CanonicalMethodSelectionErrorCode;
  readonly methodId: CoreMethodId;

  constructor(
    code: CanonicalMethodSelectionErrorCode,
    methodId: CoreMethodId,
    message: string,
  ) {
    super(message);
    this.name = "CanonicalMethodSelectionError";
    this.code = code;
    this.methodId = methodId;
  }
}

const RouteRevisionIdSchema = z.string().uuid();
const MethodEvidenceComparisonKeySchema = z.string().trim().min(1).max(512);

/**
 * Selects one method without additive pseudo-precision. Each authority is a
 * discrete, reviewable gate, and none may widen task/stage/mode eligibility.
 */
export function selectCanonicalStudyMethod(
  input: CanonicalMethodSelectionInput,
): CanonicalMethodSelectionResult {
  const eligibilityPolicyVersion = input.eligibilityPolicyVersion
    ?? METHOD_ELIGIBILITY_POLICY_VERSION;
  const eligibleMethodIds = eligibleMethodIdsForPolicyVersion({
    taskType: input.taskType,
    knowledgeStage: input.knowledgeStage,
    learningMode: input.learningMode,
  }, eligibilityPolicyVersion);
  const eligible = new Set(eligibleMethodIds);
  const baselineMethodId = eligibleMethodIds[0]!;
  const personalization = input.personalization
    ? GenerationPersonalizationContextSchema.parse(input.personalization)
    : null;
  const observed = comparableObservedEvidence(input, eligible);
  const supportOnlyMethodIds = eligibleMethodIds.filter((methodId) => (
    observed.some(({ signal }) => (
      signal.methodId === methodId && !methodOutcomeSupportsMethodRanking(signal)
    ))
  ));
  const declared = authorizedPreferredMethod(
    personalization,
    eligibleMethodIds,
  ) ?? authorizedCanonicalProfileMethod(
    personalization,
    eligibleMethodIds,
  ) ?? authorizedDeclaredMethod(
    personalization,
    eligibleMethodIds,
    input.taskType,
    input.knowledgeStage,
  );
  const ignoredExperimentalSignalIds = experimentalSignalIds(personalization);

  let selectedMethodId = baselineMethodId;
  let authority: MethodSelectionAuthority = "task_baseline";
  let learnerFacingReason = baselineReason(input, baselineMethodId);
  let evidenceRefs: string[] = [];

  if (input.committedRoute) {
    assertEligibleAuthority(
      input.committedRoute.methodId,
      eligible,
      "committed_method_ineligible",
      "The committed StudyRoute method is no longer eligible for this task, stage, and mode.",
    );
    selectedMethodId = input.committedRoute.methodId;
    authority = "committed_route";
    evidenceRefs = [routeEvidenceRef(input.committedRoute.routeRevisionId)];
    learnerFacingReason = `${CORE_METHOD_CATALOG[selectedMethodId].name} is fixed by the session recipe you already accepted.`;
  } else if (input.learnerChoice) {
    assertEligibleAuthority(
      input.learnerChoice.methodId,
      eligible,
      "learner_choice_ineligible",
      "The learner's selected method is not eligible for this task, stage, and mode.",
    );
    selectedMethodId = input.learnerChoice.methodId;
    authority = "learner_choice";
    evidenceRefs = [input.learnerChoice.evidenceRef];
    learnerFacingReason = `You chose ${CORE_METHOD_CATALOG[selectedMethodId].name} from the methods that fit this session.`;
  } else {
    const outcomeMethodId = eligibleMethodIds.find((methodId) => (
      observed.some(({ signal, evidenceRefs: refs, distinctStudyDays }) => (
        signal.methodId === methodId
        && refs.length > 0
        && distinctStudyDays >= METHOD_EVIDENCE_MINIMUM_DISTINCT_STUDY_DAYS
        && methodOutcomeSupportsMethodRanking(signal)
      ))
    ));

    if (outcomeMethodId) {
      const matching = observed.filter(({ signal }) => signal.methodId === outcomeMethodId);
      const signal = matching[0]!.signal;
      selectedMethodId = outcomeMethodId;
      authority = "observed_outcomes";
      evidenceRefs = unique(matching.flatMap((item) => item.evidenceRefs));
      learnerFacingReason = `YOVA recommends ${CORE_METHOD_CATALOG[selectedMethodId].name} because it has a stable positive signal across ${signal.sessions} comparable sessions on ${matching[0]!.distinctStudyDays} separate study days and ${signal.checkedAnswers} checked answers. This ranks a task-appropriate option; it does not label a fixed best method.`;
    } else if (declared) {
      selectedMethodId = declared.methodId;
      authority = "authorized_declaration";
      evidenceRefs = declared.signalIds;
      learnerFacingReason = declared.learnerFacingReason;
    } else if (input.continuity && eligible.has(input.continuity.methodId)) {
      selectedMethodId = input.continuity.methodId;
      authority = "continuity";
      evidenceRefs = [routeEvidenceRef(input.continuity.routeRevisionId)];
      learnerFacingReason = `${CORE_METHOD_CATALOG[selectedMethodId].name} still fits this session and preserves a coherent path from the prior comparable route.`;
    } else if (
      input.legacyCompatibilityMethodId
      && eligible.has(input.legacyCompatibilityMethodId)
    ) {
      selectedMethodId = input.legacyCompatibilityMethodId;
      authority = "legacy_compatibility";
      learnerFacingReason = `${CORE_METHOD_CATALOG[selectedMethodId].name} preserves an eligible route-free plan commitment while YOVA migrates it to the canonical router.`;
    }
  }

  evidenceRefs = unique(evidenceRefs);
  const orderedMethodIds = [
    selectedMethodId,
    ...eligibleMethodIds.filter((methodId) => methodId !== selectedMethodId),
  ];
  const ruleTrace = buildRuleTrace({
    input,
    eligibilityPolicyVersion,
    eligibleMethodIds,
    selectedMethodId,
    authority,
    learnerFacingReason,
    evidenceRefs,
    ignoredExperimentalSignalIds,
  });

  return deepFreeze({
    policyVersion: CANONICAL_METHOD_SELECTION_POLICY_VERSION,
    eligibilityPolicyVersion,
    taskType: input.taskType,
    knowledgeStage: input.knowledgeStage,
    learningMode: input.learningMode,
    selectedMethodId,
    selectedMethodName: CORE_METHOD_CATALOG[selectedMethodId].name,
    authority,
    baselineMethodId,
    changedFromBaseline: selectedMethodId !== baselineMethodId,
    eligibleMethodIds,
    orderedMethodIds,
    learnerFacingReason,
    evidenceRefs,
    ruleTrace,
    supportOnlyMethodIds,
    ignoredExperimentalSignalIds,
  });
}

function comparableObservedEvidence(
  input: CanonicalMethodSelectionInput,
  eligible: ReadonlySet<CoreMethodId>,
) {
  if (!input.currentComparisonKey) return [];
  const currentComparisonKey = MethodEvidenceComparisonKeySchema.parse(
    input.currentComparisonKey,
  );
  const observed = (input.observedEvidence ?? []).filter(({ comparisonKey, signal }) => (
    comparisonKey === currentComparisonKey
    && eligible.has(signal.methodId)
    && signal.taskType === input.taskType
    && signal.knowledgeStage === input.knowledgeStage
  ));
  const methodIds = observed.map(({ signal }) => signal.methodId);
  const duplicate = methodIds.find((methodId, index) => methodIds.indexOf(methodId) !== index);
  if (duplicate) {
    throw new Error(`Canonical method evidence contains duplicate ${duplicate} outcome signals.`);
  }
  return observed.map((item) => ({
    comparisonKey: MethodEvidenceComparisonKeySchema.parse(item.comparisonKey),
    signal: item.signal,
    evidenceRefs: unique(item.evidenceRefs),
    distinctStudyDays: boundedDistinctStudyDays(item.distinctStudyDays),
    latestObservedAt: z.string().datetime({ offset: true }).parse(item.latestObservedAt),
  }));
}

function authorizedPreferredMethod(
  personalization: GenerationPersonalizationContext | null,
  eligibleMethodIds: readonly CoreMethodId[],
) {
  if (!personalization?.preferredMethodIds || eligibleMethodIds.length < 2) {
    return null;
  }
  const preferred = new Set(personalization.preferredMethodIds);
  const methodId = eligibleMethodIds.find((candidate) => preferred.has(candidate));
  if (!methodId) return null;
  return {
    methodId,
    learnerFacingReason: `You marked ${CORE_METHOD_CATALOG[methodId].name} as a method you would like YOVA to use when it fits. It is an eligible match for this task and current need.`,
    signalIds: [`profile-method-preference:${methodId}`],
  };
}

function authorizedCanonicalProfileMethod(
  personalization: GenerationPersonalizationContext | null,
  eligibleMethodIds: readonly CoreMethodId[],
) {
  const profile = personalization?.canonicalProfile;
  if (!profile || eligibleMethodIds.length < 2) return null;
  const signals = new Map(profile.signals.map((signal) => [signal.signalId, signal]));
  const preferences: Array<{
    signalId: string;
    sourceQuestionId: string;
    description: string;
    methodIds: readonly CoreMethodId[];
  }> = [];
  const successful = signals.get("successful_approach");
  const successfulMethods: Partial<Record<string, readonly CoreMethodId[]>> = {
    closed_note_retrieval: ["retrieval_practice", "spaced_retrieval"],
    practice_problems: ["practice_problems", "interleaved_practice"],
    worked_examples_then_practice: ["worked_example_fading", "practice_problems"],
    explain_from_memory: ["self_explanation", "concept_mapping"],
  };
  if (successful && successfulMethods[successful.value]) {
    preferences.push({
      signalId: successful.signalId,
      sourceQuestionId: successful.sourceQuestionId,
      description: "this approach has most often kept learning usable for you",
      methodIds: successfulMethods[successful.value]!,
    });
  }

  const breakdown = signals.get("post_study_breakdown");
  const breakdownMethods: Partial<Record<string, readonly CoreMethodId[]>> = {
    recognition_without_recall: ["retrieval_practice", "spaced_retrieval"],
    delayed_forgetting: ["spaced_retrieval", "retrieval_practice"],
    similar_idea_confusion: ["interleaved_practice", "concept_mapping"],
    application_gap: ["practice_problems", "worked_example_fading"],
    support_dependence: ["worked_example_fading", "scaffolded_coding", "practice_problems"],
  };
  if (breakdown && breakdownMethods[breakdown.value]) {
    preferences.push({
      signalId: breakdown.signalId,
      sourceQuestionId: breakdown.sourceQuestionId,
      description: "it directly checks the gap you most often notice after studying",
      methodIds: breakdownMethods[breakdown.value]!,
    });
  }

  const entry = signals.get("unfamiliar_entry");
  const entryMethods: Partial<Record<string, readonly CoreMethodId[]>> = {
    simple_explanation: ["self_explanation", "read_recall_review"],
    concrete_example: ["worked_example_fading", "self_explanation"],
    big_picture: ["concept_mapping", "read_recall_review", "self_explanation"],
    small_steps: ["worked_example_fading", "scaffolded_coding"],
    try_first: ["pretesting", "retrieval_practice"],
    compare_similar: ["interleaved_practice", "concept_mapping"],
  };
  if (entry && entryMethods[entry.value]) {
    preferences.push({
      signalId: entry.signalId,
      sourceQuestionId: entry.sourceQuestionId,
      description: "it matches the opening you said helps you make a useful first connection",
      methodIds: entryMethods[entry.value]!,
    });
  }

  for (const preference of preferences) {
    const methodId = preference.methodIds.find((candidate) => (
      eligibleMethodIds.includes(candidate)
    ));
    if (!methodId) continue;
    return {
      methodId,
      learnerFacingReason: `${CORE_METHOD_CATALOG[methodId].name} is eligible for this task, and ${preference.description}.`,
      signalIds: [`canonical-profile:${preference.signalId}:${preference.sourceQuestionId}`],
    };
  }
  return null;
}

function boundedDistinctStudyDays(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 366) {
    throw new Error("Canonical method evidence needs a valid distinct-study-day count.");
  }
  return value;
}

function authorizedDeclaredMethod(
  personalization: GenerationPersonalizationContext | null,
  eligibleMethodIds: readonly CoreMethodId[],
  taskType: LearningTaskType,
  knowledgeStage: KnowledgeStage,
) {
  if (!personalization) return null;
  const signals = personalization.methodTie.signals.filter((signal) => (
    signal.key !== "experiment_result" && !signal.id.startsWith("experiment:")
  ));
  const decision = selectPersonalizedMethodTie(
    eligibleMethodIds,
    {
      state: {
        controls: { experiments: false },
        activeExperiment: null,
        experimentHistory: [],
      },
      signals,
    },
    {
      taskType,
      knowledgeStage,
    },
  );
  if (!decision || decision.experimental) return null;
  const methodId = decision.methodCandidates.find((candidate) => (
    candidate === decision.value && eligibleMethodIds.includes(candidate)
  ));
  if (!methodId) return null;
  return {
    methodId,
    learnerFacingReason: authorizedDeclarationReason(
      personalization,
      decision.signalIds,
      methodId,
    ),
    signalIds: unique(decision.signalIds),
  };
}

function authorizedDeclarationReason(
  personalization: GenerationPersonalizationContext,
  signalIds: readonly string[],
  methodId: CoreMethodId,
) {
  const signal = signalIds.flatMap((signalId) => (
    personalization.methodTie.signals.filter((candidate) => candidate.id === signalId)
  ))[0];
  const detail = signal?.code.trim().replaceAll("_", " ")
    || signal?.title.trim().toLocaleLowerCase()
    || "this current preference";
  return `You told YOVA that ${detail} matters here. ${CORE_METHOD_CATALOG[methodId].name} is an eligible match for this task and current need.`;
}

function experimentalSignalIds(
  personalization: GenerationPersonalizationContext | null,
) {
  if (!personalization) return [];
  return unique([
    ...(personalization.methodTie.state.activeExperiment
      ? [`experiment:${personalization.methodTie.state.activeExperiment.id}`]
      : []),
    ...personalization.methodTie.state.experimentHistory.map((item) => `experiment:${item.id}`),
    ...personalization.methodTie.signals.filter((signal) => (
      signal.key === "experiment_result" || signal.id.startsWith("experiment:")
    )).map((signal) => signal.id),
  ]);
}

function assertEligibleAuthority(
  methodId: CoreMethodId,
  eligible: ReadonlySet<CoreMethodId>,
  code: CanonicalMethodSelectionErrorCode,
  message: string,
) {
  if (!eligible.has(methodId)) {
    throw new CanonicalMethodSelectionError(code, methodId, message);
  }
}

function routeEvidenceRef(routeRevisionId: string) {
  return `route-revision:${RouteRevisionIdSchema.parse(routeRevisionId)}`;
}

function baselineReason(
  input: Pick<CanonicalMethodSelectionInput, "taskType" | "knowledgeStage" | "learningMode">,
  baselineMethodId: CoreMethodId,
) {
  return `${CORE_METHOD_CATALOG[baselineMethodId].name} is YOVA's stable evidence-constrained baseline for ${input.taskType.replaceAll("_", " ")} at the ${input.knowledgeStage.replaceAll("_", " ")} stage in ${input.learningMode === "learn" ? "Learn" : "Practice"} mode.`;
}

function buildRuleTrace({
  input,
  eligibilityPolicyVersion,
  eligibleMethodIds,
  selectedMethodId,
  authority,
  learnerFacingReason,
  evidenceRefs,
  ignoredExperimentalSignalIds,
}: {
  input: CanonicalMethodSelectionInput;
  eligibilityPolicyVersion: MethodEligibilityPolicyVersion;
  eligibleMethodIds: readonly CoreMethodId[];
  selectedMethodId: CoreMethodId;
  authority: MethodSelectionAuthority;
  learnerFacingReason: string;
  evidenceRefs: readonly string[];
  ignoredExperimentalSignalIds: readonly string[];
}) {
  const entries: StudyRouteRuleTraceEntry[] = [{
    ruleId: eligibilityPolicyVersion,
    result: eligibleMethodIds.join(","),
    reason: `Task, knowledge stage, and ${input.learningMode === "learn" ? "Learn" : "Practice"} mode limited selection to ${eligibleMethodIds.map((methodId) => CORE_METHOD_CATALOG[methodId].name).join(", ")}.`,
    evidenceRefs: [],
  }];
  if (ignoredExperimentalSignalIds.length > 0) {
    entries.push({
      ruleId: "method.hidden_experiments_disabled_v1",
      result: `ignored_${ignoredExperimentalSignalIds.length}`,
      reason: "Milestone 3 does not alternate methods or use hidden personal experiments; those signals had no routing authority.",
      evidenceRefs: ignoredExperimentalSignalIds.slice(0, 40),
    });
  }
  entries.push({
    ruleId: CANONICAL_METHOD_SELECTION_POLICY_VERSION,
    result: `${authority}:${selectedMethodId}`,
    reason: learnerFacingReason,
    evidenceRefs: [...evidenceRefs],
  });
  return entries.map((entry) => StudyRouteRuleTraceEntrySchema.parse(entry));
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
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
