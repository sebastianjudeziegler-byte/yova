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
  "pretesting",
  "concept_mapping",
  "practice_problems",
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
  "method_presentation_v2" as const;

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
    name: "Feynman Technique",
    taskTypes: ["conceptual_learning", "reading_to_quiz", "problem_solving", "mixed_assessment"],
    evidenceTier: "supported",
    what: "Explain an idea in plain language, compare it with an accurate source, repair the gaps, and explain it again.",
    why: "Connecting steps, causes, and prior knowledge can expose shallow understanding and build a more useful mental model.",
    how: [
      "Study one concise explanation or example.",
      "Close it and explain the idea in your own words.",
      "Name the cause, relationship, or reason behind each important step.",
      "Compare with the source, repair the explanation, then teach it back again without copying.",
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
    name: "SQ3R",
    taskTypes: ["reading_to_quiz", "conceptual_learning"],
    evidenceTier: "supported",
    what: "Survey a bounded source, create a guiding question, read for that answer, recall it closed-source, and review the gaps.",
    why: "Question-led reading and immediate recall reduce passive fluency and reveal what the learner actually retained.",
    how: [
      "Survey the headings, summary, and structure before reading closely.",
      "Write one question the section should answer.",
      "Read one short, bounded section for that answer.",
      "Close the source, recite the answer, then reopen it to review and repair gaps.",
    ],
    completion: "The guiding question is answered from memory and the remaining unclear point is named.",
    avoidWhen: "Do not turn the routine into highlighting or repeated rereading without a closed-source recall attempt.",
  },
  pretesting: {
    id: "pretesting",
    name: "Pretesting",
    taskTypes: ["conceptual_learning", "problem_solving", "reading_to_quiz", "mixed_assessment"],
    evidenceTier: "supported",
    what: "Make a brief prediction or attempt before instruction, then learn from the gap and answer a changed follow-up.",
    why: "A bounded first attempt can focus attention on the upcoming explanation and make the initial model visible without treating the miss as failure.",
    how: [
      "Attempt one or two diagnostic prompts before seeing the explanation.",
      "Record the prediction without grading it as prior mastery.",
      "Study the accurate model and compare it with the initial attempt.",
      "Repair the gap and answer a different follow-up after instruction.",
    ],
    completion: "The initial prediction is compared with instruction and a different follow-up is answered after repair.",
    avoidWhen: "Do not use a long or high-stakes pretest, and do not count an uninstructed miss as evidence of low ability.",
  },
  concept_mapping: {
    id: "concept_mapping",
    name: "Concept Mapping",
    taskTypes: ["conceptual_learning", "reading_to_quiz", "mixed_assessment"],
    evidenceTier: "supported",
    what: "Retrieve the important concepts, state labeled relationships between them, verify those links, and repair the map.",
    why: "Making relationships explicit can reveal a fragmented mental model and supports integration when the content genuinely depends on connected concepts.",
    how: [
      "Retrieve the key concepts before reopening the source.",
      "Connect each pair with a short relationship phrase, not a decorative line.",
      "Check every important link against the source or accurate model.",
      "Repair unsupported or missing links and explain one connection in words.",
    ],
    completion: "Every required concept has at least one verified, labeled relationship and unsupported links are repaired.",
    avoidWhen: "Do not use a map for an isolated fact list or present it as a visual learning-style accommodation.",
  },
  practice_problems: {
    id: "practice_problems",
    name: "Practice Problems",
    taskTypes: ["problem_solving", "programming", "mixed_assessment"],
    evidenceTier: "established",
    what: "Solve a representative problem independently, repair the exact error, then solve a changed-context problem.",
    why: "Independent application shows whether a procedure can be selected and carried through without the model remaining visible; a changed context checks transfer rather than repetition.",
    how: [
      "Attempt a representative problem without the worked solution visible.",
      "Compare the result and identify the first incorrect decision or step.",
      "Repair that decision with the smallest justified support.",
      "Solve a different problem using the same underlying principle.",
    ],
    completion: "A representative attempt and a changed-context transfer problem are complete, with any error tied to a specific repair.",
    avoidWhen: "Do not use unsupported practice as first instruction when the learner has no usable model of the procedure.",
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
  self_explanation: ["Self-explanation"],
  read_recall_review: ["Read-recall-review", "Read recall review"],
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
