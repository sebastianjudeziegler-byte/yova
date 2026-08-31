import { z } from "zod";
import type {
  LearningPlan,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import {
  CORE_METHOD_IDS,
  CORE_METHOD_CATALOG,
  learningScienceCatalogForPrompt,
} from "@/lib/learning/method-catalog";
import type { CoreMethodId } from "@/lib/learning/method-catalog";
import type { LearningScienceRoutingBrief } from "@/lib/learning/method-router";
import {
  PERSONALIZATION_DECISION_SETTINGS,
} from "@/lib/personalization/personalization-decision";
import {
  PERSONALIZATION_EVIDENCE_LABELS,
  resolveLearnerPersonalization,
  selectPersonalizedMethodTie,
  type PersonalizationDecision,
  type PersonalizationResolution,
} from "@/lib/personalization/personalization-evidence";
import {
  PERSONALIZATION_EXPERIMENT_VARIABLES,
  preferredMethodIds as readPreferredMethodIds,
} from "@/lib/personalization/personalization-state";
import { CanonicalPreferredMethodIdsSchema } from "@/lib/personalization/preferred-method-schema";
import { STUDY_PROFILE_DIMENSIONS } from "@/lib/study-profile/types";
import { CanonicalLearnerProfileSchema } from "@/lib/personalization/canonical-profile-schema";

const PersonalizationDecisionSchema = z.object({
  id: z.string().trim().min(3).max(180),
  artifact: z.enum([
    "method_tie",
    "method_delivery",
    "session_opening",
    "workspace",
    "support",
    "schedule",
    "recovery",
  ]),
  setting: z.enum(PERSONALIZATION_DECISION_SETTINGS),
  value: z.string().trim().min(1).max(180),
  title: z.string().trim().min(3).max(180),
  explanation: z.string().trim().min(10).max(800),
  signalIds: z.array(z.string().trim().min(3).max(180)).max(8),
  evidenceLabel: z.enum(PERSONALIZATION_EVIDENCE_LABELS),
  methodCandidates: z.array(z.enum(CORE_METHOD_IDS)).max(CORE_METHOD_IDS.length),
  experimental: z.boolean(),
});

const MethodTieExperimentSchema = z.object({
  id: z.string().trim().min(1).max(180),
  variable: z.enum(PERSONALIZATION_EXPERIMENT_VARIABLES),
  variantA: z.string().trim().min(1).max(180),
  variantB: z.string().trim().min(1).max(180),
  taskType: z.string().trim().min(1).max(80).nullable(),
  knowledgeStage: z.string().trim().min(1).max(80).nullable(),
  nextVariant: z.enum(["a", "b"]).optional(),
  result: z.enum(["promising_a", "promising_b", "mixed", "stopped"]).optional(),
});

const PersonalizationMethodTieSignalSchema = z.object({
  id: z.string().trim().min(3).max(180),
  key: z.enum([
    ...STUDY_PROFILE_DIMENSIONS,
    "processing_entry",
    "memory_breakdown",
    "repair_preference",
    "workspace_preference",
    "workspace_settings",
    "energy_window",
    "experiment_result",
  ]),
  title: z.string().trim().min(2).max(180),
  code: z.string().trim().min(1).max(180),
  evidenceLabel: z.enum(PERSONALIZATION_EVIDENCE_LABELS),
  paused: z.boolean(),
});

export const GenerationPersonalizationContextSchema = z.object({
  decisions: z.array(PersonalizationDecisionSchema).max(32),
  canonicalProfile: CanonicalLearnerProfileSchema.optional(),
  preferredMethodIds: CanonicalPreferredMethodIdsSchema.optional(),
  methodTie: z.object({
    state: z.object({
      controls: z.object({ experiments: z.boolean() }),
      activeExperiment: MethodTieExperimentSchema.extend({
        nextVariant: z.enum(["a", "b"]),
      }).nullable(),
      experimentHistory: z.array(MethodTieExperimentSchema.extend({
        result: z.enum(["promising_a", "promising_b", "mixed", "stopped"]),
      })).max(24),
    }),
    signals: z.array(PersonalizationMethodTieSignalSchema).max(24),
  }),
});

export type GenerationPersonalizationContext = z.infer<
  typeof GenerationPersonalizationContextSchema
>;

export function projectPersonalizationForGeneration(
  resolution: PersonalizationResolution,
): GenerationPersonalizationContext {
  const effectivePreferredMethodIds = resolution.state.controls.selfReport
    ? readPreferredMethodIds(resolution.state)
    : [];
  const nonExperimentalDecisions = resolution.decisions.filter((decision) => (
    !decision.experimental
    && !decision.signalIds.some((signalId) => signalId.startsWith("experiment:"))
  ));
  const nonExperimentalSignals = resolution.signals.filter((signal) => (
    signal.key !== "experiment_result"
    && !signal.id.startsWith("experiment:")
  ));
  return GenerationPersonalizationContextSchema.parse({
    decisions: nonExperimentalDecisions,
    ...(resolution.state.controls.selfReport && resolution.state.canonicalProfile
      ? { canonicalProfile: resolution.state.canonicalProfile }
      : {}),
    ...(effectivePreferredMethodIds.length > 0
      ? { preferredMethodIds: effectivePreferredMethodIds }
      : {}),
    methodTie: {
      state: {
        // Canonical personalization v1 does not alternate variants or reuse
        // a historical experiment winner. Legacy records remain in account
        // history, but the generation boundary deliberately cannot see them.
        controls: { experiments: false },
        activeExperiment: null,
        experimentHistory: [],
      },
      signals: nonExperimentalSignals.map((signal) => ({
        id: signal.id,
        key: signal.key,
        title: signal.title,
        code: signal.code,
        evidenceLabel: signal.evidenceLabel,
        paused: signal.paused,
      })),
    },
  });
}

/**
 * Adds request-local preferences to an already bounded generation projection.
 * Callers are responsible for authorizing a local development-preview request
 * before invoking this helper.
 */
export function projectPreviewPreferredMethodsForGeneration(
  personalization: unknown,
  preferredMethodIds: readonly CoreMethodId[],
): GenerationPersonalizationContext {
  const parsedPersonalization = GenerationPersonalizationContextSchema.parse(
    personalization,
  );
  const canonicalMethodIds = CanonicalPreferredMethodIdsSchema.parse([
    ...preferredMethodIds,
  ]);
  const withoutPreferredMethods = { ...parsedPersonalization };
  delete withoutPreferredMethods.preferredMethodIds;
  return GenerationPersonalizationContextSchema.parse({
    ...withoutPreferredMethods,
    ...(canonicalMethodIds.length > 0
      ? { preferredMethodIds: canonicalMethodIds }
      : {}),
  });
}

export function resolvePersonalizationForGeneration({
  answers,
  completions,
  interruptions,
  plans,
  now,
  timeZone,
}: {
  answers: readonly string[];
  completions: readonly SessionCompletion[];
  interruptions: readonly SessionInterruption[];
  plans: readonly LearningPlan[];
  now?: Date;
  timeZone?: string;
}) {
  return projectPersonalizationForGeneration(resolveLearnerPersonalization({
    answers,
    completions,
    interruptions,
    plans,
    now,
    timeZone,
  }));
}

/**
 * Personal evidence is allowed to break a tie only inside the deterministic
 * task router's candidate set. Narrowing to the selected singleton makes the
 * decision enforceable while preserving that hard subset guarantee.
 */
export function applyPersonalizedMethodTieToRouting(
  routing: LearningScienceRoutingBrief,
  personalization: GenerationPersonalizationContext | null | undefined,
  committedMethodId?: CoreMethodId | null,
): LearningScienceRoutingBrief {
  if (committedMethodId) {
    return {
      ...routing,
      suggestedPrimaryMethodId: committedMethodId,
      allowedMethodIds: [committedMethodId],
      methods: learningScienceCatalogForPrompt([committedMethodId]),
      decisionBasis: [
        ...routing.decisionBasis,
        `Committed StudyRoute: ${committedMethodId} is fixed for this revision.`,
      ],
    };
  }
  if (routing.preservedLegacyMethodId) return routing;
  if (!personalization) return routing;
  if (routing.methodFit?.scores.some((score) => score.observedScore !== 0)) {
    return routing;
  }
  const preferredMethodId = routing.allowedMethodIds.length > 1
    ? routing.allowedMethodIds.find((methodId) => (
      personalization.preferredMethodIds?.includes(methodId)
    ))
    : undefined;
  if (preferredMethodId) {
    return {
      ...routing,
      suggestedPrimaryMethodId: preferredMethodId,
      allowedMethodIds: [preferredMethodId],
      methods: learningScienceCatalogForPrompt([preferredMethodId]),
      decisionBasis: [
        ...routing.decisionBasis,
        `Saved method preference: ${CORE_METHOD_CATALOG[preferredMethodId].name} is the first preferred method in the task router's eligible order.`,
      ],
    };
  }
  const tie = selectPersonalizedMethodTie(
    routing.allowedMethodIds,
    {
      state: {
        controls: { experiments: false },
        activeExperiment: null,
        experimentHistory: [],
      },
      signals: personalization.methodTie.signals.filter((signal) => (
        signal.key !== "experiment_result" && !signal.id.startsWith("experiment:")
      )),
    },
    {
      taskType: routing.taskType,
      knowledgeStage: routing.knowledgeStage,
    },
  );
  const selected = tie?.methodCandidates.find((methodId) => (
    methodId === tie.value && routing.allowedMethodIds.includes(methodId)
  ));
  if (!tie || !selected) return routing;

  return {
    ...routing,
    suggestedPrimaryMethodId: selected,
    allowedMethodIds: [selected],
    methods: learningScienceCatalogForPrompt([selected]),
    decisionBasis: [
      ...routing.decisionBasis,
      `Personalization tie-break: ${tie.explanation}`,
    ],
  };
}

export function personalizationDecisions(
  personalization: GenerationPersonalizationContext | null | undefined,
  routing: Pick<LearningScienceRoutingBrief, "taskType" | "knowledgeStage">,
): readonly PersonalizationDecision[] {
  if (!personalization) return [];
  return personalization.decisions.filter((decision) => (
    decisionAppliesToRouting(decision, personalization, routing)
  ));
}

function decisionAppliesToRouting(
  decision: PersonalizationDecision,
  personalization: GenerationPersonalizationContext,
  routing: Pick<LearningScienceRoutingBrief, "taskType" | "knowledgeStage">,
) {
  const experimentSignalId = decision.signalIds.find((id) => id.startsWith("experiment:"));
  if (!experimentSignalId) return true;
  // Milestone 3 does not alternate named learning methods or reuse the old
  // two-session personal-test winner. Other bounded UI/delivery experiments
  // remain behind their existing explicit control until their own migration.
  if (decision.artifact === "method_tie") return false;
  if (!personalization.methodTie.state.controls.experiments) return false;

  const experimentId = experimentSignalId.slice("experiment:".length);
  const active = personalization.methodTie.state.activeExperiment;
  if (active?.id === experimentId) return experimentMatchesRouting(active, routing);

  const completed = personalization.methodTie.state.experimentHistory.find(
    (item) => item.id === experimentId,
  );
  const signal = personalization.methodTie.signals.find(
    (item) => item.id === experimentSignalId,
  );
  return Boolean(
    completed
    && signal
    && !signal.paused
    && experimentMatchesRouting(completed, routing),
  );
}

function experimentMatchesRouting(
  experiment: { taskType: string | null; knowledgeStage: string | null },
  routing: Pick<LearningScienceRoutingBrief, "taskType" | "knowledgeStage">,
) {
  return experiment.taskType === routing.taskType
    && experiment.knowledgeStage === routing.knowledgeStage;
}
