import {
  StudyRouteSchema,
  type StudyRoute,
} from "@/lib/study-route/schema";
import { activeStudyRouteTargetIds } from "@/lib/study-route/targets";

export const METHOD_EVIDENCE_POLICY_VERSION =
  "method_evidence_v1" as const;
export const METHOD_EVIDENCE_COMPARABILITY_POLICY_VERSION =
  "method_compare_v1" as const;

export const METHOD_EVIDENCE_MINIMUM_SESSIONS = 4;
export const METHOD_EVIDENCE_MINIMUM_CHECKED_ANSWERS = 12;
export const METHOD_EVIDENCE_MINIMUM_DISTINCT_STUDY_DAYS = 2;

export const METHOD_EVIDENCE_DURATION_BANDS = [
  "brief",
  "compact",
  "standard",
  "extended",
  "long",
  "extra_long",
] as const;

export type MethodEvidenceDurationBand =
  (typeof METHOD_EVIDENCE_DURATION_BANDS)[number];

export const METHOD_EVIDENCE_TARGET_RELATIONSHIPS = [
  "single_target",
  "multi_target_same_stage",
  "multi_target_mixed_stage",
] as const;

export type MethodEvidenceTargetRelationship =
  (typeof METHOD_EVIDENCE_TARGET_RELATIONSHIPS)[number];

/**
 * Exact non-content dimensions that must remain aligned before outcomes may
 * accumulate into one method signal. The key deliberately excludes learner
 * text, target names, source content, and route identifiers.
 */
export type MethodEvidenceComparisonContext = Readonly<{
  policyVersion: typeof METHOD_EVIDENCE_COMPARABILITY_POLICY_VERSION;
  taskFamily: StudyRoute["target"]["taskFamily"];
  knowledgeStage: StudyRoute["target"]["targetStates"][number]["stage"];
  mode: StudyRoute["approach"]["mode"];
  executionEnvironment: StudyRoute["approach"]["executionEnvironment"];
  difficultyTier: StudyRoute["execution"]["difficultyTier"];
  durationBand: MethodEvidenceDurationBand;
  initialSupport: StudyRoute["execution"]["initialSupport"];
  targetRelationship: MethodEvidenceTargetRelationship;
  assessmentType: string;
}>;

export function methodEvidenceComparisonContextForRoute(
  routeInput: StudyRoute,
): MethodEvidenceComparisonContext {
  const route = StudyRouteSchema.parse(routeInput);
  const activeIds = new Set(activeStudyRouteTargetIds(route));
  const activeTargets = route.target.targetStates.filter((target) => (
    activeIds.has(target.targetId)
  ));
  if (activeTargets.length === 0) {
    throw new Error("Method evidence requires at least one active route target.");
  }
  const stages = new Set(activeTargets.map((target) => target.stage));
  const independentAssessmentKinds = [...new Set(
    route.execution.completionEvidence
      .filter((evidence) => evidence.requiresIndependentAttempt)
      .map((evidence) => evidence.kind),
  )].sort();

  return Object.freeze({
    policyVersion: METHOD_EVIDENCE_COMPARABILITY_POLICY_VERSION,
    taskFamily: route.target.taskFamily,
    knowledgeStage: mostSupportiveStage(activeTargets.map((target) => target.stage)),
    mode: route.approach.mode,
    executionEnvironment: route.approach.executionEnvironment,
    difficultyTier: route.execution.difficultyTier,
    durationBand: methodEvidenceDurationBand(route.timing.activeMinutes),
    initialSupport: route.execution.initialSupport,
    targetRelationship: activeTargets.length === 1
      ? "single_target"
      : stages.size === 1
        ? "multi_target_same_stage"
        : "multi_target_mixed_stage",
    assessmentType: independentAssessmentKinds.join("+") || "none",
  });
}

/** Stable, privacy-safe grouping key; never use target or learner prose. */
export function methodEvidenceComparisonKey(
  context: MethodEvidenceComparisonContext,
) {
  return [
    context.policyVersion,
    context.taskFamily,
    context.knowledgeStage,
    context.mode,
    context.executionEnvironment,
    context.difficultyTier,
    context.durationBand,
    context.initialSupport,
    context.targetRelationship,
    context.assessmentType,
  ].join(":");
}

export function methodEvidenceDurationBand(
  activeMinutes: number,
): MethodEvidenceDurationBand {
  if (!Number.isInteger(activeMinutes) || activeMinutes < 5 || activeMinutes > 180) {
    throw new Error("Method evidence requires a valid active-session duration.");
  }
  if (activeMinutes <= 10) return "brief";
  if (activeMinutes <= 15) return "compact";
  if (activeMinutes <= 25) return "standard";
  if (activeMinutes <= 45) return "extended";
  if (activeMinutes <= 60) return "long";
  return "extra_long";
}

export function methodEvidenceMeetsMinimum({
  sessions,
  checkedAnswers,
  distinctStudyDays,
}: {
  sessions: number;
  checkedAnswers: number;
  distinctStudyDays?: number;
}) {
  return sessions >= METHOD_EVIDENCE_MINIMUM_SESSIONS
    && checkedAnswers >= METHOD_EVIDENCE_MINIMUM_CHECKED_ANSWERS
    && (distinctStudyDays === undefined
      || distinctStudyDays >= METHOD_EVIDENCE_MINIMUM_DISTINCT_STUDY_DAYS);
}

function mostSupportiveStage(
  stages: readonly StudyRoute["target"]["targetStates"][number]["stage"][],
) {
  if (stages.includes("novice")) return "novice" as const;
  if (stages.includes("developing")) return "developing" as const;
  return "retrieval_ready" as const;
}
