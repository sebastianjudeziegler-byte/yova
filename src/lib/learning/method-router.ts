import {
  CORE_METHOD_CATALOG,
  type CoreMethodId,
  type LearningTaskType,
  learningScienceCatalogForPrompt,
} from "@/lib/learning/method-catalog";
import type { LearningIntent, SessionLearningMode } from "@/lib/domain";
import { learningModeContract } from "@/lib/learning/learning-intent";
import {
  rankMethodsByLearnerFit,
  type MethodFitRanking,
} from "@/lib/learning/method-preference-fit";
import type { MethodOutcomeSignal } from "@/lib/personalization/method-outcomes";

export type KnowledgeStage = "novice" | "developing" | "retrieval_ready";

export type LearningTaskClassification = {
  taskType: LearningTaskType;
  confidence: "clear" | "mixed" | "default";
  evidence: string[];
};

export type MethodRoutingInput = {
  learningIntent: LearningIntent;
  sessionLearningMode: SessionLearningMode;
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
    processingPreference?: string | null;
    memoryChallenge?: string | null;
    supportPreference?: string | null;
    workspacePreference?: string | null;
    freeformContext?: string | null;
    observationCorrection?: string | null;
  } | null;
  recentResults: Array<{
    correctAnswers: number | null;
    totalAnswers: number | null;
  }>;
  interruptionCount: number;
  /**
   * A clear task classification from an authoritative upstream goal. This is
   * used by plan validation so vague generated titles cannot change the task.
   */
  taskTypeOverride?: LearningTaskType | null;
  /**
   * Outcome signals for methods this learner has already used on comparable
   * work. Supplying them lets repeated results outrank self-report; omitting
   * them simply falls back to task fit and declared preferences.
   */
  observedMethodSignals?: readonly MethodOutcomeSignal[];
};

export type LearningScienceRoutingBrief = {
  learningIntent: LearningIntent;
  sessionLearningMode: SessionLearningMode;
  taskType: LearningTaskType;
  knowledgeStage: KnowledgeStage;
  suggestedPrimaryMethodId: CoreMethodId;
  allowedMethodIds: CoreMethodId[];
  /**
   * How declared answers and observed results ordered the eligible methods.
   * Null when nothing was eligible. Retained so the learner-facing rationale
   * and the developer inspector can both reconstruct the decision.
   */
  methodFit: MethodFitRanking | null;
  methods: ReturnType<typeof learningScienceCatalogForPrompt>;
  deliveryModifiers: string[];
  decisionBasis: string[];
  guardrails: string[];
  executionContract: ReturnType<typeof learningModeContract>;
};

export function validateLearningScienceRoutingSelection({
  taskType,
  methodId,
  learningMode,
}: {
  taskType: LearningTaskType;
  methodId: CoreMethodId;
  learningMode: SessionLearningMode;
}, routing: LearningScienceRoutingBrief) {
  if (taskType !== routing.taskType) {
    return `The method briefing labeled this as ${taskType.replaceAll("_", " ")}, but the deterministic task router classified it as ${routing.taskType.replaceAll("_", " ")}.`;
  }
  if (learningMode !== routing.sessionLearningMode) {
    return `The method briefing changed the required ${routing.sessionLearningMode} session into ${learningMode}.`;
  }
  if (!routing.allowedMethodIds.includes(methodId)) {
    return `The selected method ${methodId} is not allowed for this task and knowledge stage.`;
  }
  return null;
}

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

export function buildLearningScienceRoutingBrief(input: MethodRoutingInput): LearningScienceRoutingBrief {
  const taskClassification = input.taskTypeOverride
    ? {
      taskType: input.taskTypeOverride,
      confidence: "clear" as const,
      evidence: ["the learner's original goal"],
    }
    : classifyLearningTaskParts([
      { text: input.goalTitle, importance: 1 },
      { text: input.goalTopic, importance: 1.25 },
      { text: input.goalKind, importance: 0.5 },
      { text: input.sessionTitle, importance: 1.75 },
      { text: input.sessionObjective, importance: 2.25 },
    ]);
  const taskType = taskClassification.taskType;
  const combined = [
    input.goalTitle,
    input.goalTopic,
    input.goalKind,
    input.sessionTitle,
    input.sessionObjective,
    input.plannedMethod,
    input.plannedMethodReason,
  ].join(" ");
  const observedKnowledgeStage = inferKnowledgeStage(input.recentResults, combined);
  const knowledgeStage = input.sessionLearningMode === "learn" ? "novice" : observedKnowledgeStage;
  const stageMethods = TASK_METHODS[taskType][knowledgeStage];
  const modeCompatibleMethods = stageMethods.filter((methodId) => (
    methodFitsSessionMode(methodId, taskType, input.sessionLearningMode)
  ));
  const allowedMethodIds = [...(modeCompatibleMethods.length ? modeCompatibleMethods : stageMethods)];
  const plannedMethodId = methodIdFromText(input.plannedMethod);
  const plannedMethodStillValid = Boolean(
    plannedMethodId
    && CORE_METHOD_CATALOG[plannedMethodId].taskTypes.includes(taskType)
    && methodFitsSessionMode(plannedMethodId, taskType, input.sessionLearningMode),
  );

  if (plannedMethodId && plannedMethodStillValid) {
    const existingIndex = allowedMethodIds.indexOf(plannedMethodId);
    if (existingIndex >= 0) allowedMethodIds.splice(existingIndex, 1);
    allowedMethodIds.unshift(plannedMethodId);
  }

  // Eligibility is already settled above. This only orders the survivors, so a
  // learner signal can choose between methods that all fit the task and stage.
  const methodFit = rankMethodsByLearnerFit({
    eligibleMethodIds: allowedMethodIds,
    declaredProfile: input.learnerProfile,
    observedSignals: input.observedMethodSignals ?? [],
  });
  const fitOrderedMethodIds = methodFit ? [...methodFit.orderedMethodIds] : allowedMethodIds;
  /**
   * A plan that already committed to a task-valid method keeps it. Learner fit
   * chooses the method while the plan is being generated, where the learner has
   * not yet been told what to expect. Re-choosing here would contradict the
   * method already shown on Home, Learning, Agenda, and the session setup.
   */
  const rankedMethodIds = plannedMethodId && plannedMethodStillValid
    ? [plannedMethodId, ...fitOrderedMethodIds.filter((methodId) => methodId !== plannedMethodId)]
    : fitOrderedMethodIds;
  const methodFitDecidedPrimary = Boolean(methodFit && rankedMethodIds[0] === methodFit.selectedMethodId);

  return {
    learningIntent: input.learningIntent,
    sessionLearningMode: input.sessionLearningMode,
    taskType,
    knowledgeStage,
    suggestedPrimaryMethodId: rankedMethodIds[0],
    allowedMethodIds: rankedMethodIds,
    methodFit,
    methods: learningScienceCatalogForPrompt(rankedMethodIds),
    deliveryModifiers: inferDeliveryModifiers(input),
    decisionBasis: [
      taskClassification.evidence.length > 0
        ? `Task classification: ${taskType.replaceAll("_", " ")} from signals such as ${taskClassification.evidence.join(", ")}.`
        : `Task classification: ${taskType.replaceAll("_", " ")} because the goal is primarily about building understanding.`,
      input.sessionLearningMode === "learn"
        ? "Session approach: teach and model before unsupported performance."
        : "Session approach: begin with an unsupported attempt, then repair the exposed gap.",
      knowledgeStage === "novice"
        ? "Knowledge stage: novice or not yet demonstrated; preserve instruction and scaffolding."
        : knowledgeStage === "retrieval_ready"
          ? "Knowledge stage: retrieval-ready from repeated strong checks or explicit review intent."
          : "Knowledge stage: developing; combine generation with targeted support and feedback.",
      plannedMethodId
        ? `The existing plan named ${CORE_METHOD_CATALOG[plannedMethodId].name}; keep it when it remains task-appropriate.`
        : "The plan used free-text method language; select the closest evidence-backed method from the catalog.",
      ...(methodFitDecidedPrimary && methodFit?.learnerFacingReason
        ? [`Learner fit: ${methodFit.learnerFacingReason}`]
        : []),
    ],
    guardrails: [
      "Task type chooses the learning method; learner tendencies only modify delivery, pacing, structure, and representation.",
      "Do not infer a fixed learning style, diagnosis, intelligence level, or brain type.",
      "Prefer observed performance over self-report when the two conflict, but require repeated evidence before making strong claims.",
      "The method briefing must tell the learner what they are doing, why, how to do it, and what completion means.",
    ],
    executionContract: learningModeContract(input.sessionLearningMode),
  };
}

export function inferLearningTaskType(text: string): LearningTaskType {
  return classifyLearningTask(text).taskType;
}

type WeightedTaskSignal = {
  pattern: RegExp;
  weight: number;
  evidence: string;
};

const TASK_SIGNAL_RULES: Record<LearningTaskType, WeightedTaskSignal[]> = {
  memorization: [
    { pattern: /\b(memorize|memorization|commit .* to memory)\b/i, weight: 7, evidence: "memorization" },
    { pattern: /\b(vocabulary|flashcards?|term[- ]definition|definitions?|dates and facts|facts and dates)\b/i, weight: 5, evidence: "facts or terms" },
    { pattern: /\b(recall (?:the )?(?:terms|definitions|dates|facts)|learn (?:the )?(?:terms|definitions|dates|facts))\b/i, weight: 4, evidence: "fact recall" },
  ],
  conceptual_learning: [
    { pattern: /\b(understand|explain|conceptualize|make sense of)\b/i, weight: 5, evidence: "understanding or explanation" },
    { pattern: /\b(how|why)\b.{0,70}\b(works?|happens?|changes?|causes?|affects?|relates?|matters?)\b/i, weight: 5, evidence: "how or why reasoning" },
    { pattern: /\b(function|role|purpose) of\b/i, weight: 6, evidence: "function or purpose" },
    { pattern: /\b(process|mechanism|relationship|cause and effect|big picture|mental model|meaning)\b/i, weight: 3, evidence: "concept structure" },
    { pattern: /\b(learn|teach)\b/i, weight: 2, evidence: "initial learning" },
  ],
  problem_solving: [
    { pattern: /\b(solve|calculate|compute|differentiate|integrate|derive|evaluate)\b/i, weight: 7, evidence: "solving or calculation" },
    { pattern: /\b(graph|apply)\b.{0,45}\b(functions?|equations?|formula|rule|theorem)\b/i, weight: 6, evidence: "mathematical application" },
    { pattern: /\b(calculus|algebra|derivatives?|integrals?|equations?|word problems?|problem[- ]solving|worked examples?|chemistry calculation|physics problems?)\b/i, weight: 4, evidence: "quantitative problem solving" },
  ],
  reading_to_quiz: [
    { pattern: /\b(read|review)\b.{0,45}\b(article|chapter|textbook|passage|lecture|assigned reading)\b/i, weight: 7, evidence: "assigned reading" },
    { pattern: /\b(reading quiz|read[- ]recall|read[- ]recite|question[- ]led reading)\b/i, weight: 7, evidence: "reading check" },
    { pattern: /\b(close reading|textual evidence|passage details?|imagery and setting|support an interpretation)\b/i, weight: 7, evidence: "close reading or textual interpretation" },
    { pattern: /\b(summarize|annotate|analyze)\b.{0,45}\b(article|chapter|passage|reading|lecture)\b/i, weight: 5, evidence: "reading analysis" },
    { pattern: /\b(article|chapter|textbook|passage|lecture)\b/i, weight: 1, evidence: "source reading" },
  ],
  writing_argumentation: [
    { pattern: /\b(write|draft|revise|compose)\b.{0,45}\b(essay|argument|thesis|outline|paragraph|paper|response)\b/i, weight: 8, evidence: "writing production" },
    { pattern: /\b(essay|argumentative writing|thesis statement|evidence paragraph|writing rubric)\b/i, weight: 6, evidence: "argument or essay" },
    { pattern: /\b(claim|evidence|reasoning)\b.{0,45}\b(paragraph|essay|argument|rubric)\b/i, weight: 5, evidence: "claim and evidence" },
  ],
  programming: [
    { pattern: /\b(javascript|typescript|python|java|swift|kotlin|rust|react|sql|html|css|c\+\+)\b/i, weight: 8, evidence: "programming language" },
    { pattern: /\b(write|build|implement|debug|refactor|trace|run|test)\b.{0,45}\b(code|program|script|function|class|component|algorithm)\b/i, weight: 8, evidence: "code creation or debugging" },
    { pattern: /\b(coding|programming|code tracing|software development)\b/i, weight: 7, evidence: "programming task" },
    { pattern: /\b(loop|variable|data structure|api endpoint|compiler)\b/i, weight: 4, evidence: "programming construct" },
  ],
  mixed_assessment: [
    { pattern: /\b(practice test|mock exam|mixed assessment|cumulative (?:test|exam|review)|final review|exam readiness)\b/i, weight: 10, evidence: "mixed assessment" },
    { pattern: /\b(prepare|review|study)\b.{0,45}\b(final exam|cumulative exam|practice exam)\b/i, weight: 8, evidence: "cumulative preparation" },
  ],
};

const TASK_TIE_BREAK_ORDER: LearningTaskType[] = [
  "mixed_assessment",
  "writing_argumentation",
  "programming",
  "problem_solving",
  "memorization",
  "reading_to_quiz",
  "conceptual_learning",
];

export function classifyLearningTask(text: string): LearningTaskClassification {
  return classifyLearningTaskParts([{ text, importance: 1 }]);
}

function classifyLearningTaskParts(parts: Array<{ text: string; importance: number }>): LearningTaskClassification {
  const scores = Object.fromEntries(
    TASK_TIE_BREAK_ORDER.map((taskType) => [taskType, 0]),
  ) as Record<LearningTaskType, number>;
  const evidence = TASK_TIE_BREAK_ORDER.reduce<Record<LearningTaskType, string[]>>((result, taskType) => {
    result[taskType] = [];
    return result;
  }, {} as Record<LearningTaskType, string[]>);

  for (const part of parts) {
    const text = part.text.trim();
    if (!text) continue;
    for (const taskType of TASK_TIE_BREAK_ORDER) {
      for (const signal of TASK_SIGNAL_RULES[taskType]) {
        if (!signal.pattern.test(text)) continue;
        scores[taskType] += signal.weight * part.importance;
        if (!evidence[taskType].includes(signal.evidence)) {
          evidence[taskType].push(signal.evidence);
        }
      }
    }
  }

  const ranked = TASK_TIE_BREAK_ORDER
    .map((taskType) => ({ taskType, score: scores[taskType] }))
    .sort((left, right) => right.score - left.score
      || TASK_TIE_BREAK_ORDER.indexOf(left.taskType) - TASK_TIE_BREAK_ORDER.indexOf(right.taskType));
  const winner = ranked[0];
  const runnerUp = ranked[1];

  if (!winner || winner.score <= 0) {
    return { taskType: "conceptual_learning", confidence: "default", evidence: [] };
  }

  return {
    taskType: winner.taskType,
    confidence: winner.score >= 5 && winner.score - runnerUp.score >= 2 ? "clear" : "mixed",
    evidence: evidence[winner.taskType].slice(0, 3),
  };
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
  if (/outlin(?:e|ing)|drafting|argument/.test(normalized)) return "retrieval_based_outlining";
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
  if (/big picture/i.test(profileText)) {
    modifiers.push("Begin new teaching with a concise whole-to-parts map, then connect each detail back to that model.");
  }
  if (/compare|similar ideas|confuse similar/i.test(profileText)) {
    modifiers.push("Use a contrast or discrimination check so the learner must distinguish similar ideas instead of recognizing them separately.");
  }
  if (/cannot recall|forget.*few days|do not retain/i.test(profileText)) {
    modifiers.push("Require closed-note retrieval now and preserve the idea for a later retrieval check; do not treat recognition as completion.");
  }
  if (/cannot apply|not independently|with help/i.test(profileText)) {
    modifiers.push("Move from one bounded model or guided attempt to a genuinely independent application before counting the content as secure.");
  }
  if (/small hint/i.test(profileText)) {
    modifiers.push("After a miss, offer the smallest useful hint before revealing a complete solution when the activity permits.");
  }
  if (/different example/i.test(profileText)) {
    modifiers.push("When repair is needed, change the example while preserving the underlying concept so the learner cannot succeed through surface repetition alone.");
  }
  if (/explain the mistake directly/i.test(profileText)) {
    modifiers.push("Name the incorrect relationship directly, contrast it with the correct model, and require a fresh attempt.");
  }
  if (/least guidance/i.test(profileText)) {
    modifiers.push("Start with the least support justified by current evidence, and restore guidance only after a real attempt exposes a gap.");
  }
  if (input.learnerProfile?.observationCorrection) {
    modifiers.push(`Respect this learner correction when it is relevant: ${input.learnerProfile.observationCorrection}`);
  }
  if (input.interruptionCount >= 2) {
    modifiers.push("Recent sessions ended early more than once; reduce switching and keep the activity count conservative without lowering intellectual challenge.");
  }

  return modifiers.length ? modifiers.slice(0, 6) : [
    "No repeated delivery preference is established yet; use a clear, moderate amount of guidance and learn from the result.",
  ];
}
