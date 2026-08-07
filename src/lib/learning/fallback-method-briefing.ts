import type {
  LearningPlan,
  LearningPlanSession,
  SessionMethodBriefing,
} from "@/lib/domain";
import {
  getCoreLearningMethod,
  type CoreMethodId,
  type LearningTaskType,
} from "@/lib/learning/method-catalog";
import {
  inferLearningTaskType,
  methodIdFromText,
} from "@/lib/learning/method-router";

const DEFAULT_METHOD_BY_TASK: Record<LearningTaskType, CoreMethodId> = {
  memorization: "retrieval_practice",
  conceptual_learning: "self_explanation",
  problem_solving: "worked_example_fading",
  reading_to_quiz: "read_recall_review",
  writing_argumentation: "retrieval_based_outlining",
  programming: "scaffolded_coding",
  mixed_assessment: "practice_test_error_repair",
};

export function buildFallbackMethodBriefing(
  plan: LearningPlan,
  session: LearningPlanSession,
): SessionMethodBriefing {
  const taskType = inferLearningTaskType([
    plan.title,
    plan.topic,
    plan.kind,
    session.title,
    session.objective,
    session.method,
  ].join(" "));
  const namedMethodId = methodIdFromText(session.method);
  const methodId = namedMethodId && getCoreLearningMethod(namedMethodId).taskTypes.includes(taskType)
    ? namedMethodId
    : DEFAULT_METHOD_BY_TASK[taskType];
  const method = getCoreLearningMethod(methodId);
  const completion = session.completionEvidence?.find((item) => item.trim()) ?? method.completion;

  return {
    learningMode: session.learningMode,
    taskType,
    methodId,
    name: method.name,
    what: method.what,
    why: session.methodReason.trim() || method.why,
    how: method.how,
    completion,
    personalization: [
      `The method follows the ${taskType.replaceAll("_", " ")} task in this learning goal.`,
      `The amount of work is bounded to the current ${session.estimatedMinutes}-minute window.`,
      plan.studyMode === "outside_yova"
        ? "Your outside source remains the source of truth; YOVA provides the sequence and evidence check."
        : "YOVA provides the content sequence and removes support before the final check.",
    ],
  };
}
