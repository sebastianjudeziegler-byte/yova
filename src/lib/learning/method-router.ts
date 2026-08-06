import {
  CORE_METHOD_CATALOG,
  type CoreMethodId,
  type LearningTaskType,
  learningScienceCatalogForPrompt,
} from "@/lib/learning/method-catalog";

export type KnowledgeStage = "novice" | "developing" | "retrieval_ready";

export type MethodRoutingInput = {
  goalTitle: string;
  goalTopic: string;
  goalKind: string;
  sessionTitle: string;
  sessionObjective: string;
  plannedMethod: string;
  plannedMethodReason: string;
  learnerProfile: {
    commonBlocker: string | null;
    guidancePreference: string | null;
    explanationPreference: string | null;
    focusFrequency: string | null;
    startingPattern: string | null;
    primaryImprovementGoal: string | null;
  } | null;
  recentResults: Array<{
    correctAnswers: number | null;
    totalAnswers: number | null;
  }>;
  interruptionCount: number;
};

export type LearningScienceRoutingBrief = {
  taskType: LearningTaskType;
  knowledgeStage: KnowledgeStage;
  suggestedPrimaryMethodId: CoreMethodId;
  allowedMethodIds: CoreMethodId[];
  methods: ReturnType<typeof learningScienceCatalogForPrompt>;
  deliveryModifiers: string[];
  decisionBasis: string[];
  guardrails: string[];
};

const TASK_METHODS: Record<LearningTaskType, Record<KnowledgeStage, CoreMethodId[]>> = {
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

export function buildLearningScienceRoutingBrief(input: MethodRoutingInput): LearningScienceRoutingBrief {
  const combined = [
    input.goalTitle,
    input.goalTopic,
    input.goalKind,
    input.sessionTitle,
    input.sessionObjective,
    input.plannedMethod,
    input.plannedMethodReason,
  ].join(" ");
  const taskType = inferLearningTaskType(combined);
  const knowledgeStage = inferKnowledgeStage(input.recentResults, combined);
  const allowedMethodIds = [...TASK_METHODS[taskType][knowledgeStage]];
  const plannedMethodId = methodIdFromText(input.plannedMethod);

  if (plannedMethodId && CORE_METHOD_CATALOG[plannedMethodId].taskTypes.includes(taskType)) {
    const existingIndex = allowedMethodIds.indexOf(plannedMethodId);
    if (existingIndex >= 0) allowedMethodIds.splice(existingIndex, 1);
    allowedMethodIds.unshift(plannedMethodId);
  }

  return {
    taskType,
    knowledgeStage,
    suggestedPrimaryMethodId: allowedMethodIds[0],
    allowedMethodIds,
    methods: learningScienceCatalogForPrompt(allowedMethodIds),
    deliveryModifiers: inferDeliveryModifiers(input),
    decisionBasis: [
      `Task classification: ${taskType.replaceAll("_", " ")} from the goal and session objective.`,
      knowledgeStage === "novice"
        ? "Knowledge stage: novice or not yet demonstrated; preserve instruction and scaffolding."
        : knowledgeStage === "retrieval_ready"
          ? "Knowledge stage: retrieval-ready from repeated strong checks or explicit review intent."
          : "Knowledge stage: developing; combine generation with targeted support and feedback.",
      plannedMethodId
        ? `The existing plan named ${CORE_METHOD_CATALOG[plannedMethodId].name}; keep it when it remains task-appropriate.`
        : "The plan used free-text method language; select the closest evidence-backed method from the catalog.",
    ],
    guardrails: [
      "Task type chooses the learning method; learner tendencies only modify delivery, pacing, structure, and representation.",
      "Do not infer a fixed learning style, diagnosis, intelligence level, or brain type.",
      "Prefer observed performance over self-report when the two conflict, but require repeated evidence before making strong claims.",
      "The method briefing must tell the learner what they are doing, why, how to do it, and what completion means.",
    ],
  };
}

export function inferLearningTaskType(text: string): LearningTaskType {
  if (/\b(code|coding|program|programming|javascript|typescript|python|debug|function|array|algorithm)\b/i.test(text)) return "programming";
  if (/\b(essay|writing|argument|thesis|draft|outline|rubric|claim|evidence paragraph)\b/i.test(text)) return "writing_argumentation";
  if (/\b(calculus|algebra|equation|derivative|problem[- ]solving|solve|worked example|word problem|physics|chemistry calculation)\b/i.test(text)) return "problem_solving";
  if (/\b(reading|chapter|textbook|article|lecture|read-recall|read-recite|reading quiz)\b/i.test(text)) return "reading_to_quiz";
  if (/\b(vocabulary|terms|definitions|dates|facts|memorize|memorization|flashcards?)\b/i.test(text)) return "memorization";
  if (/\b(practice test|mock exam|mixed assessment|final review|cumulative|exam readiness)\b/i.test(text)) return "mixed_assessment";
  return "conceptual_learning";
}

export function inferKnowledgeStage(results: MethodRoutingInput["recentResults"], text: string): KnowledgeStage {
  const scored = results.filter((result) => (
    result.correctAnswers !== null
    && result.totalAnswers !== null
    && result.totalAnswers > 0
  ));
  if (scored.length >= 2) {
    const correct = scored.reduce((total, result) => total + (result.correctAnswers ?? 0), 0);
    const questions = scored.reduce((total, result) => total + (result.totalAnswers ?? 0), 0);
    if (questions > 0 && correct / questions >= 0.8) return "retrieval_ready";
    if (questions > 0 && correct / questions < 0.5) return "novice";
  }
  if (/starting from scratch|little prior knowledge|does not yet|first learn|initial teaching|novice/i.test(text)) return "novice";
  if (/practice test|final review|already understand|mostly review|retrieval-ready/i.test(text)) return "retrieval_ready";
  return "developing";
}

export function methodIdFromText(text: string): CoreMethodId | null {
  const normalized = text.toLowerCase();
  if (/practice test|assessment|error repair|error review|mistake review/.test(normalized)) return "practice_test_error_repair";
  if (/scaffolded coding|code tracing|parsons|coding/.test(normalized)) return "scaffolded_coding";
  if (/outline|drafting|argument/.test(normalized)) return "retrieval_based_outlining";
  if (/read[- ]recall|read[- ]recite|question-led reading/.test(normalized)) return "read_recall_review";
  if (/worked|faded example|example fading/.test(normalized)) return "worked_example_fading";
  if (/interleav|mixed practice/.test(normalized)) return "interleaved_practice";
  if (/spaced|successive relearning/.test(normalized)) return "spaced_retrieval";
  if (/self[- ]explan|teach[- ]back|concept model|elaborat/.test(normalized)) return "self_explanation";
  if (/retriev|recall|flashcard|closed-note/.test(normalized)) return "retrieval_practice";
  return null;
}

function inferDeliveryModifiers(input: MethodRoutingInput) {
  const profileText = input.learnerProfile ? Object.values(input.learnerProfile).filter(Boolean).join(" ") : "";
  const modifiers: string[] = [];

  if (/overwhelm|hesitat|hard to start|difficult to start|procrastinat|large task/i.test(profileText)) {
    modifiers.push("Begin with a bounded action that can be completed in roughly five minutes, without weakening the learning method.");
  }
  if (/one step|checklist|structure|decide for me|clear steps/i.test(profileText)) {
    modifiers.push("Show one visible step at a time and keep the sequence explicit; fade guidance after successful independent work.");
  }
  if (/example|practical|concrete/i.test(profileText)) {
    modifiers.push("Use one relevant concrete example before abstraction or independent application when the task permits.");
  }
  if (/concise|direct|short explanation/i.test(profileText)) {
    modifiers.push("Keep explanations concise and make the active attempt more prominent than the prose.");
  }
  if (input.interruptionCount >= 2) {
    modifiers.push("Recent sessions ended early more than once; reduce switching and keep the activity count conservative without lowering intellectual challenge.");
  }

  return modifiers.length ? modifiers.slice(0, 4) : [
    "No repeated delivery preference is established yet; use a clear, moderate amount of guidance and learn from the result.",
  ];
}
