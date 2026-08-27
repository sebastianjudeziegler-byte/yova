import { z } from "zod";
import type {
  LearningPlan,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import {
  CORE_METHOD_IDS,
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
import { PERSONALIZATION_EXPERIMENT_VARIABLES } from "@/lib/personalization/personalization-state";
import { STUDY_PROFILE_DIMENSIONS } from "@/lib/study-profile/types";

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
  return GenerationPersonalizationContextSchema.parse({
    decisions: resolution.decisions,
    methodTie: {
      state: {
        controls: { experiments: resolution.state.controls.experiments },
        activeExperiment: resolution.state.activeExperiment ? {
          id: resolution.state.activeExperiment.id,
          variable: resolution.state.activeExperiment.variable,
          variantA: resolution.state.activeExperiment.variantA,
          variantB: resolution.state.activeExperiment.variantB,
          taskType: resolution.state.activeExperiment.taskType,
          knowledgeStage: resolution.state.activeExperiment.knowledgeStage,
          nextVariant: resolution.state.activeExperiment.nextVariant,
        } : null,
        experimentHistory: resolution.state.experimentHistory.map((item) => ({
          id: item.id,
          variable: item.variable,
          variantA: item.variantA,
          variantB: item.variantB,
          taskType: item.taskType,
          knowledgeStage: item.knowledgeStage,
          result: item.result,
        })),
      },
      signals: resolution.signals.map((signal) => ({
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
  if (!personalization) return routing;
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
