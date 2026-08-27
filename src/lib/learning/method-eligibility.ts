import type { SessionLearningMode } from "@/lib/domain";
import {
  CORE_METHOD_CATALOG,
  type CoreMethodId,
  type LearningTaskType,
} from "@/lib/learning/method-catalog";

export const METHOD_ELIGIBILITY_POLICY_VERSION = "method_eligibility_v1" as const;

export const KNOWLEDGE_STAGES = [
  "novice",
  "developing",
  "retrieval_ready",
] as const;

export type KnowledgeStage = (typeof KNOWLEDGE_STAGES)[number];

const METHOD_ELIGIBILITY_MATRIX: Readonly<
  Record<LearningTaskType, Readonly<Record<KnowledgeStage, readonly CoreMethodId[]>>>
> = {
  memorization: {
    novice: ["retrieval_practice", "spaced_retrieval"],
    developing: ["retrieval_practice", "spaced_retrieval", "interleaved_practice"],
    retrieval_ready: ["practice_test_error_repair", "spaced_retrieval", "interleaved_practice"],
  },
  conceptual_learning: {
    novice: ["self_explanation", "read_recall_review", "retrieval_practice"],
    developing: ["self_explanation", "retrieval_practice", "spaced_retrieval"],
    retrieval_ready: ["retrieval_practice", "practice_test_error_repair", "spaced_retrieval"],
  },
  problem_solving: {
    novice: ["worked_example_fading", "self_explanation"],
    developing: ["worked_example_fading", "interleaved_practice", "practice_test_error_repair"],
    retrieval_ready: ["interleaved_practice", "practice_test_error_repair"],
  },
  reading_to_quiz: {
    novice: ["read_recall_review", "self_explanation", "retrieval_practice"],
    developing: ["read_recall_review", "retrieval_practice", "spaced_retrieval"],
    retrieval_ready: ["practice_test_error_repair", "retrieval_practice", "spaced_retrieval"],
  },
  writing_argumentation: {
    novice: ["retrieval_based_outlining", "self_explanation"],
    developing: ["retrieval_based_outlining", "practice_test_error_repair"],
    retrieval_ready: ["retrieval_based_outlining", "practice_test_error_repair"],
  },
  programming: {
    novice: ["scaffolded_coding", "worked_example_fading"],
    developing: ["scaffolded_coding", "interleaved_practice", "practice_test_error_repair"],
    retrieval_ready: ["interleaved_practice", "practice_test_error_repair", "scaffolded_coding"],
  },
  mixed_assessment: {
    novice: ["self_explanation", "retrieval_practice", "worked_example_fading"],
    developing: ["retrieval_practice", "interleaved_practice", "practice_test_error_repair"],
    retrieval_ready: ["practice_test_error_repair", "spaced_retrieval", "interleaved_practice"],
  },
};

const TEACHING_FIRST_METHODS = new Set<CoreMethodId>([
  "self_explanation",
  "worked_example_fading",
  "read_recall_review",
  "retrieval_based_outlining",
  "scaffolded_coding",
]);

export function methodFitsSessionMode(
  methodId: CoreMethodId,
  taskType: LearningTaskType,
  learningMode: SessionLearningMode,
) {
  if (learningMode === "study") return true;
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
  const eligible = METHOD_ELIGIBILITY_MATRIX[taskType][knowledgeStage].filter((methodId) => (
    CORE_METHOD_CATALOG[methodId].taskTypes.includes(taskType)
    && methodFitsSessionMode(methodId, taskType, learningMode)
  ));
  if (eligible.length > 0) return eligible;

  // A route can explicitly ask to teach a target whose prior evidence is
  // already developing or retrieval-ready. In that unusual but valid case,
  // Learn mode returns to the task's novice teaching recipe rather than
  // falling through to a practice-only method.
  const teachingFallback = learningMode === "learn"
    ? METHOD_ELIGIBILITY_MATRIX[taskType].novice.filter((methodId) => (
      CORE_METHOD_CATALOG[methodId].taskTypes.includes(taskType)
      && methodFitsSessionMode(methodId, taskType, learningMode)
    ))
    : [];
  if (teachingFallback.length === 0) {
    throw new Error(
      `No method is eligible for ${taskType}/${knowledgeStage}/${learningMode} under ${METHOD_ELIGIBILITY_POLICY_VERSION}.`,
    );
  }
  return teachingFallback;
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
