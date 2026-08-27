import {
  CORE_METHOD_CATALOG,
  CORE_METHOD_IDS,
  type CoreMethodId,
  type LearningTaskType,
} from "@/lib/learning/method-catalog";
import {
  BLURTING_SUPPORTING_TECHNIQUE_ID,
  BLURTING_VISIBLE_METHOD_NAME,
} from "@/lib/learning/method-recipes";

const BEST_FOR: Readonly<Record<CoreMethodId, string>> = {
  retrieval_practice: "Remembering facts and concepts, and preparing for quizzes",
  spaced_retrieval: "Keeping important material available over days and weeks",
  self_explanation: "Understanding how and why an idea or solution works",
  worked_example_fading: "Learning new maths, science, or coding procedures",
  interleaved_practice: "Telling similar problem types apart during mixed practice",
  read_recall_review: "Learning from textbooks, notes, and articles",
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

/**
 * Blurting is intentionally separate from the nine core methods. It is a
 * future supporting recipe over Active Recall, not a selectable core method.
 */
export const FUTURE_BLURTING_LIBRARY_ENTRY = Object.freeze({
  id: BLURTING_SUPPORTING_TECHNIQUE_ID,
  name: BLURTING_VISIBLE_METHOD_NAME,
  status: "coming_later" as const,
  bestFor: "Source-based concepts after an initial understanding has been built",
  what: "Recall what you know without looking, compare it with the source, repair the gaps, then complete a fresh closed-source check.",
  how: Object.freeze([
    "Close the source and write what you can recall.",
    "Open the source and compare it with your recall.",
    "Correct the important gaps in your own words.",
    "Close the source again and answer a fresh check independently.",
  ]),
  availability: "Blurting is not available in plans, sessions, or preferences yet.",
});
