import type { SessionLearningMode } from "@/lib/domain";
import {
  CORE_METHOD_CATALOG,
  type CoreMethodId,
  type LearningTaskType,
} from "@/lib/learning/method-catalog";
import { expandedMethodIsEnabled } from "@/lib/learning/method-expansion-rollout";

export const LEGACY_METHOD_ELIGIBILITY_POLICY_VERSION =
  "method_eligibility_v2" as const;
export const METHOD_ELIGIBILITY_POLICY_VERSION = "method_eligibility_v3" as const;
export const METHOD_ELIGIBILITY_POLICY_VERSIONS = [
  LEGACY_METHOD_ELIGIBILITY_POLICY_VERSION,
  METHOD_ELIGIBILITY_POLICY_VERSION,
] as const;

export type MethodEligibilityPolicyVersion =
  (typeof METHOD_ELIGIBILITY_POLICY_VERSIONS)[number];

export const KNOWLEDGE_STAGES = [
  "novice",
  "developing",
  "retrieval_ready",
] as const;

export type KnowledgeStage = (typeof KNOWLEDGE_STAGES)[number];

const METHOD_ELIGIBILITY_MATRIX_V2: Readonly<
  Record<LearningTaskType, Readonly<Record<KnowledgeStage, readonly CoreMethodId[]>>>
> = {
  memorization: {
    novice: ["retrieval_practice", "spaced_retrieval"],
    developing: ["retrieval_practice", "spaced_retrieval", "interleaved_practice"],
    retrieval_ready: ["practice_test_error_repair", "spaced_retrieval", "interleaved_practice"],
  },
  conceptual_learning: {
    novice: ["self_explanation", "concept_mapping", "pretesting", "read_recall_review", "retrieval_practice"],
    developing: ["self_explanation", "concept_mapping", "retrieval_practice", "spaced_retrieval"],
    retrieval_ready: ["retrieval_practice", "practice_test_error_repair", "spaced_retrieval"],
  },
  problem_solving: {
    novice: ["worked_example_fading", "pretesting", "self_explanation"],
    developing: ["worked_example_fading", "practice_problems", "interleaved_practice", "practice_test_error_repair"],
    retrieval_ready: ["practice_problems", "interleaved_practice", "practice_test_error_repair"],
  },
  reading_to_quiz: {
    novice: ["read_recall_review", "concept_mapping", "pretesting", "self_explanation", "retrieval_practice"],
    developing: ["read_recall_review", "concept_mapping", "retrieval_practice", "spaced_retrieval"],
    retrieval_ready: ["practice_test_error_repair", "retrieval_practice", "spaced_retrieval"],
  },
  writing_argumentation: {
    novice: ["retrieval_based_outlining", "self_explanation"],
    developing: ["retrieval_based_outlining", "practice_test_error_repair"],
    retrieval_ready: ["retrieval_based_outlining", "practice_test_error_repair"],
  },
  programming: {
    novice: ["scaffolded_coding", "worked_example_fading"],
    developing: ["scaffolded_coding", "practice_problems", "interleaved_practice", "practice_test_error_repair"],
    retrieval_ready: ["practice_problems", "interleaved_practice", "practice_test_error_repair", "scaffolded_coding"],
  },
  mixed_assessment: {
    novice: ["self_explanation", "pretesting", "concept_mapping", "retrieval_practice", "worked_example_fading"],
    developing: ["retrieval_practice", "practice_problems", "interleaved_practice", "practice_test_error_repair"],
    retrieval_ready: ["practice_test_error_repair", "practice_problems", "spaced_retrieval", "interleaved_practice"],
  },
};

const METHOD_ELIGIBILITY_MATRIX_V3: typeof METHOD_ELIGIBILITY_MATRIX_V2 = {
  ...METHOD_ELIGIBILITY_MATRIX_V2,
  problem_solving: {
    ...METHOD_ELIGIBILITY_MATRIX_V2.problem_solving,
    novice: [
      ...METHOD_ELIGIBILITY_MATRIX_V2.problem_solving.novice,
      "practice_problems",
    ],
  },
};

const TEACHING_FIRST_METHODS = new Set<CoreMethodId>([
  "self_explanation",
  "worked_example_fading",
  "read_recall_review",
  "pretesting",
  "concept_mapping",
  "retrieval_based_outlining",
  "scaffolded_coding",
]);

/**
 * Recipes whose base fidelity contract begins with an unsupported learner
 * attempt, retrieval, discrimination, or trace. A Practice route must never
 * silently prepend a teaching model merely because the selected method needs
 * one; that would contradict the route promise shown on every surface.
 */
const PRACTICE_FIRST_METHODS = new Set<CoreMethodId>([
  "retrieval_practice",
  "spaced_retrieval",
  "interleaved_practice",
  "concept_mapping",
  "practice_problems",
  "retrieval_based_outlining",
  "scaffolded_coding",
  "practice_test_error_repair",
]);

export function methodFitsSessionMode(
  methodId: CoreMethodId,
  taskType: LearningTaskType,
  learningMode: SessionLearningMode,
) {
  if (methodId === "pretesting") return learningMode === "learn";
  if (methodId === "practice_problems") return learningMode === "study";
  if (learningMode === "study") return PRACTICE_FIRST_METHODS.has(methodId);
  if (taskType === "memorization") return methodId === "retrieval_practice";
  return TEACHING_FIRST_METHODS.has(methodId);
}

/**
 * Returns the complete method set permitted by task, target stage, and
 * Learn/Practice mode. Callers may reorder this set but may never widen it.
 */
export function eligibleMethodIdsFor({
  taskType,
  knowledgeStage,
  learningMode,
}: {
  taskType: LearningTaskType;
  knowledgeStage: KnowledgeStage;
  learningMode: SessionLearningMode;
}): CoreMethodId[] {
  return eligibleMethodIdsForPolicyVersion(
    { taskType, knowledgeStage, learningMode },
    METHOD_ELIGIBILITY_POLICY_VERSION,
  );
}

export function eligibleMethodIdsForPolicyVersion(
  {
    taskType,
    knowledgeStage,
    learningMode,
  }: {
    taskType: LearningTaskType;
    knowledgeStage: KnowledgeStage;
    learningMode: SessionLearningMode;
  },
  policyVersion: MethodEligibilityPolicyVersion,
): CoreMethodId[] {
  const matrix = policyVersion === LEGACY_METHOD_ELIGIBILITY_POLICY_VERSION
    ? METHOD_ELIGIBILITY_MATRIX_V2
    : METHOD_ELIGIBILITY_MATRIX_V3;
  const eligible = matrix[taskType][knowledgeStage].filter((methodId) => (
    expandedMethodIsEnabled(methodId)
    &&
    CORE_METHOD_CATALOG[methodId].taskTypes.includes(taskType)
    && methodFitsSessionModeForPolicyVersion(
      methodId,
      taskType,
      learningMode,
      policyVersion,
    )
  ));
  if (eligible.length > 0) return eligible;

  // A route can explicitly ask to teach a target whose prior evidence is
  // already developing or retrieval-ready. In that unusual but valid case,
  // Learn mode returns to the task's novice teaching recipe rather than
  // falling through to a practice-only method.
  const teachingFallback = learningMode === "learn"
    ? matrix[taskType].novice.filter((methodId) => (
      expandedMethodIsEnabled(methodId)
      &&
      CORE_METHOD_CATALOG[methodId].taskTypes.includes(taskType)
      && methodFitsSessionModeForPolicyVersion(
        methodId,
        taskType,
        learningMode,
        policyVersion,
      )
    ))
    : [];
  if (teachingFallback.length === 0) {
    throw new Error(
      `No method is eligible for ${taskType}/${knowledgeStage}/${learningMode} under ${policyVersion}.`,
    );
  }
  return teachingFallback;
}

function methodFitsSessionModeForPolicyVersion(
  methodId: CoreMethodId,
  taskType: LearningTaskType,
  learningMode: SessionLearningMode,
  policyVersion: MethodEligibilityPolicyVersion,
) {
  if (policyVersion === METHOD_ELIGIBILITY_POLICY_VERSION) {
    return methodFitsSessionMode(methodId, taskType, learningMode);
  }
  if (methodId === "pretesting") return learningMode === "learn";
  if (methodId === "practice_problems") return learningMode === "study";
  if (learningMode === "study") return true;
  if (taskType === "memorization") return methodId === "retrieval_practice";
  return TEACHING_FIRST_METHODS.has(methodId);
}

export function isMethodEligibleFor({
  methodId,
  taskType,
  knowledgeStage,
  learningMode,
}: {
  methodId: CoreMethodId;
  taskType: LearningTaskType;
  knowledgeStage: KnowledgeStage;
  learningMode: SessionLearningMode;
}) {
  return eligibleMethodIdsFor({ taskType, knowledgeStage, learningMode }).includes(methodId);
}
