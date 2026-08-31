import {
  CORE_METHOD_CATALOG,
  CORE_METHOD_IDS,
  type CoreMethodId,
  type LearningTaskType,
} from "@/lib/learning/method-catalog";

const BEST_FOR: Readonly<Record<CoreMethodId, string>> = {
  retrieval_practice: "Remembering facts and concepts, and preparing for quizzes",
  spaced_retrieval: "Keeping important material available over days and weeks",
  self_explanation: "Understanding how and why an idea or solution works",
  worked_example_fading: "Learning new maths, science, or coding procedures",
  interleaved_practice: "Telling similar problem types apart during mixed practice",
  read_recall_review: "Learning from textbooks, notes, and articles",
  pretesting: "Focusing first instruction with a brief, low-stakes prediction",
  concept_mapping: "Connecting related concepts into a verified mental model",
  practice_problems: "Building independent application and changed-context transfer",
  retrieval_based_outlining: "Planning essays, reports, and structured arguments",
  scaffolded_coding: "Programming, tracing, debugging, and independent coding",
  practice_test_error_repair: "Checking exam readiness and finding weak areas",
};

const TASK_LABELS: Readonly<Record<LearningTaskType, string>> = {
  memorization: "Memory",
  conceptual_learning: "Understanding",
  problem_solving: "Problem solving",
  reading_to_quiz: "Reading",
  writing_argumentation: "Writing",
  programming: "Coding",
  mixed_assessment: "Exam practice",
};

export type MethodLibraryEntry = Readonly<{
  id: CoreMethodId;
  name: string;
  bestFor: string;
  taskLabels: readonly string[];
  what: string;
  why: string;
  how: readonly string[];
  completion: string;
  avoidWhen: string;
}>;

/**
 * Learner-facing projection of the canonical catalog. The library owns only
 * plain-language discovery copy; method identity and learning behavior remain
 * owned by the catalog.
 */
export const METHOD_LIBRARY_ENTRIES: readonly MethodLibraryEntry[] = Object.freeze(
  CORE_METHOD_IDS.map((id) => {
    const method = CORE_METHOD_CATALOG[id];
    return Object.freeze({
      id,
      name: method.name,
      bestFor: BEST_FOR[id],
      taskLabels: Object.freeze(method.taskTypes.map((taskType) => TASK_LABELS[taskType])),
      what: method.what,
      why: method.why,
      how: Object.freeze([...method.how]),
      completion: method.completion,
      avoidWhen: method.avoidWhen,
    });
  }),
);
