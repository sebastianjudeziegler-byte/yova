export const LEARNING_TASK_TYPES = [
  "memorization",
  "conceptual_learning",
  "problem_solving",
  "reading_to_quiz",
  "writing_argumentation",
  "programming",
  "mixed_assessment",
] as const;

export type LearningTaskType = (typeof LEARNING_TASK_TYPES)[number];

export const CORE_METHOD_IDS = [
  "retrieval_practice",
  "spaced_retrieval",
  "self_explanation",
  "worked_example_fading",
  "interleaved_practice",
  "read_recall_review",
  "retrieval_based_outlining",
  "scaffolded_coding",
  "practice_test_error_repair",
] as const;

export type CoreMethodId = (typeof CORE_METHOD_IDS)[number];
export type MethodEvidenceTier = "established" | "supported";

/**
 * Versions the learner-facing projection separately from method selection,
 * eligibility, and runtime behavior. A display-name change can therefore be
 * audited without implying that any learning recipe changed.
 */
export const METHOD_PRESENTATION_POLICY_VERSION =
  "method_presentation_v1" as const;

export type CoreLearningMethod = {
  id: CoreMethodId;
  name: string;
  taskTypes: LearningTaskType[];
  evidenceTier: MethodEvidenceTier;
  what: string;
  why: string;
  how: string[];
  completion: string;
  avoidWhen: string;
};

export const CORE_METHOD_CATALOG: Record<CoreMethodId, CoreLearningMethod> = {
  retrieval_practice: {
    id: "retrieval_practice",
    name: "Active Recall",
    taskTypes: ["memorization", "conceptual_learning", "reading_to_quiz", "mixed_assessment"],
    evidenceTier: "established",
    what: "Produce an answer from memory before looking at the source.",
    why: "Retrieval makes current knowledge visible and strengthens later recall more reliably than passive rereading alone.",
    how: [
      "Hide the answer or close the source.",
      "Produce the answer before checking.",
      "Compare with the source and repair only the missing or incorrect parts.",
      "Retry missed ideas later instead of immediately copying them.",
    ],
    completion: "Every target idea has been attempted without support and each miss is marked for another retrieval.",
    avoidWhen: "Do not use unsupported recall as the only teaching step when the learner has not built an initial mental model.",
  },
  spaced_retrieval: {
    id: "spaced_retrieval",
    name: "Spaced Repetition",
    taskTypes: ["memorization", "conceptual_learning", "reading_to_quiz", "mixed_assessment"],
    evidenceTier: "established",
    what: "Return to important material across separated sessions and retrieve it before reviewing.",
    why: "Separating successful retrieval attempts over time supports more durable retention than massing the same work into one block.",
    how: [
      "Complete a short retrieval set now.",
      "Schedule the next attempt after a delay.",
      "Retrieve before reviewing on every return.",
      "Bring missed or uncertain items back sooner than stable ones.",
    ],
    completion: "The next retrieval is scheduled and today’s misses have a specific return point.",
    avoidWhen: "Spacing cannot replace first instruction when the learner has not yet encountered the idea.",
  },
  self_explanation: {
    id: "self_explanation",
    name: "Self-explanation",
    taskTypes: ["conceptual_learning", "reading_to_quiz", "problem_solving", "mixed_assessment"],
    evidenceTier: "supported",
    what: "Explain how and why an idea works in your own words, then compare it with an accurate model.",
    why: "Connecting steps, causes, and prior knowledge can expose shallow understanding and build a more useful mental model.",
    how: [
      "Study one concise explanation or example.",
      "Close it and explain the idea in your own words.",
      "Name the cause, relationship, or reason behind each important step.",
      "Compare with the source and repair the explanation.",
    ],
    completion: "The explanation accurately includes the central relationship and at least one supporting reason or example.",
    avoidWhen: "Do not substitute elaborate explanation for direct retrieval when exact terms or facts are the main goal.",
  },
  worked_example_fading: {
    id: "worked_example_fading",
    name: "Worked Examples",
    taskTypes: ["problem_solving", "programming"],
    evidenceTier: "established",
    what: "Study one complete solution, then solve a similar task as support is gradually removed.",
    why: "Examples reduce unnecessary load while a novice builds a usable procedure; fading then checks whether the procedure can be performed independently.",
    how: [
      "Study a complete example and explain why each step is used.",
      "Complete a similar example with one or more steps removed.",
      "Attempt a comparable problem independently.",
      "Classify any error and retry the affected step.",
    ],
    completion: "A comparable problem is completed independently or the exact step needing repair is identified.",
    avoidWhen: "Do not keep full guidance visible after the learner can already solve the task independently.",
  },
  interleaved_practice: {
    id: "interleaved_practice",
    name: "Interleaving",
    taskTypes: ["problem_solving", "programming", "memorization", "mixed_assessment"],
    evidenceTier: "supported",
    what: "Mix related problem or concept types so the learner must decide which approach applies.",
    why: "Mixing can improve discrimination and transfer after a basic foundation exists, even when practice feels harder.",
    how: [
      "Mix a small set of related categories or problem types.",
      "Identify the type and choose a method before solving.",
      "Complete the item without seeing a category label when possible.",
      "Review errors by decision type, not only by final answer.",
    ],
    completion: "The learner can identify and apply the correct approach across a mixed set, with errors grouped for repair.",
    avoidWhen: "Do not heavily interleave unfamiliar material before the learner has a basic schema for each category.",
  },
  read_recall_review: {
    id: "read_recall_review",
    name: "Read-recall-review",
    taskTypes: ["reading_to_quiz", "conceptual_learning"],
    evidenceTier: "supported",
    what: "Read a short section with a guiding question, close it, recall the main idea, then reopen it to correct gaps.",
    why: "Question-led reading and immediate recall reduce passive fluency and reveal what the learner actually retained.",
    how: [
      "Preview one question the section should answer.",
      "Read one short, bounded section.",
      "Close the source and state the main idea plus key support.",
      "Reopen the source, correct the recall, and record one unclear point.",
    ],
    completion: "The guiding question is answered from memory and the remaining unclear point is named.",
    avoidWhen: "Do not turn the routine into highlighting or repeated rereading without a closed-source recall attempt.",
  },
  retrieval_based_outlining: {
    id: "retrieval_based_outlining",
    name: "Outline from Memory",
    taskTypes: ["writing_argumentation"],
    evidenceTier: "supported",
    what: "Build the claim and structure from memory before returning to sources for evidence and revision.",
    why: "Generating the structure first exposes gaps, prevents endless note collection, and creates a bounded path into drafting.",
    how: [
      "State the main claim without reopening the source.",
      "List the supporting reasons or sections from memory.",
      "Return to the source and attach evidence to each claim.",
      "Draft a bounded section, then revise against the rubric.",
    ],
    completion: "A claim, ordered support, and at least one matched piece of evidence are ready for drafting.",
    avoidWhen: "Do not ask for unsupported factual detail; verify evidence against the learner’s source before drafting it as fact.",
  },
  scaffolded_coding: {
    id: "scaffolded_coding",
    name: "Trace–Code–Test",
    taskTypes: ["programming"],
    evidenceTier: "supported",
    what: "Trace and complete a working code example before writing a comparable solution with less support.",
    why: "A concrete example can build the program schema while fading prevents the learner from remaining dependent on copied code.",
    how: [
      "Trace one correct example and predict its output.",
      "Explain the purpose of each important line or block.",
      "Complete a version with selected code removed.",
      "Write or debug a comparable solution independently.",
    ],
    completion: "The learner independently selects the construct and produces or repairs a comparable solution.",
    avoidWhen: "Do not leave the complete solution visible during the independent attempt.",
  },
  practice_test_error_repair: {
    id: "practice_test_error_repair",
    name: "Practice Tests",
    taskTypes: ["mixed_assessment", "problem_solving", "reading_to_quiz", "memorization"],
    evidenceTier: "established",
    what: "Attempt representative questions under reduced support, then diagnose and repair the specific errors.",
    why: "A realistic attempt creates objective evidence of readiness; targeted correction keeps review focused on remaining gaps.",
    how: [
      "Predict your result before starting.",
      "Complete the questions without notes or feedback.",
      "Submit before reviewing answers.",
      "Classify each miss, state the correction, and complete one similar item.",
    ],
    completion: "The test is submitted, confidence is compared with performance, and every miss has a correction or follow-up item.",
    avoidWhen: "Do not use a high-stakes simulation as first instruction for a learner with no initial model of the material.",
  },
};

/**
 * Names already written by the original nine-method catalog. They remain
 * valid compatibility labels for route-free imports and immutable historical
 * StudyRoutes, while every new route projects the recognizable catalog name.
 */
export const LEGACY_CORE_METHOD_NAMES: Readonly<
  Partial<Record<CoreMethodId, readonly string[]>>
> = {
  retrieval_practice: ["Retrieval practice"],
  spaced_retrieval: ["Spaced retrieval"],
  worked_example_fading: ["Worked example fading"],
  interleaved_practice: ["Interleaved practice"],
  retrieval_based_outlining: ["Retrieval-based outlining"],
  scaffolded_coding: ["Scaffolded coding with fading"],
  practice_test_error_repair: ["Practice test and error repair"],
};

export function recognizedCoreMethodNames(id: CoreMethodId) {
  return [CORE_METHOD_CATALOG[id].name, ...(LEGACY_CORE_METHOD_NAMES[id] ?? [])];
}

export function isRecognizedCoreMethodName(id: CoreMethodId, value: string) {
  const normalized = normalizeMethodName(value);
  return recognizedCoreMethodNames(id).some((name) => (
    normalizeMethodName(name) === normalized
  ));
}

export function getCoreLearningMethod(id: CoreMethodId) {
  return CORE_METHOD_CATALOG[id];
}

export function learningScienceCatalogForPrompt(ids: CoreMethodId[] = [...CORE_METHOD_IDS]) {
  return ids.map((id) => {
    const method = CORE_METHOD_CATALOG[id];
    return {
      id: method.id,
      name: method.name,
      applies_to: method.taskTypes,
      evidence_tier: method.evidenceTier,
      what: method.what,
      why: method.why,
      how: method.how,
      completion: method.completion,
      avoid_when: method.avoidWhen,
    };
  });
}

function normalizeMethodName(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}
