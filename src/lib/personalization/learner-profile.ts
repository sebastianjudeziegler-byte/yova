import { FUNCTIONAL_SUPPORT_OPTIONS } from "@/lib/sample-data";

export const DEEP_PROFILE_QUESTIONS = [
  {
    answerIndex: 10,
    prompt: "When information is new, what usually helps it click?",
    description: "YOVA uses this to choose how an explanation begins, then checks whether the approach actually helps.",
    options: [
      "A concrete example before the rule",
      "The big picture before the details",
      "A clear sequence of small steps",
      "Trying it before seeing an explanation",
      "Comparing similar ideas side by side",
      "It depends on the task",
    ],
  },
  {
    answerIndex: 11,
    prompt: "What most often goes wrong after you study something?",
    description: "This changes what YOVA checks for, not the evidence-backed method selected for the task.",
    options: [
      "I recognize it but cannot recall it",
      "I forget it after a few days",
      "I confuse similar ideas",
      "I understand it but cannot apply it",
      "I can do it with help but not independently",
      "It depends on the topic",
    ],
  },
  {
    answerIndex: 12,
    prompt: "When you struggle, how should YOVA help first?",
    description: "YOVA can change the amount and kind of support without lowering the learning target.",
    options: [
      "Give me a small hint first",
      "Show me a different example",
      "Explain the mistake directly",
      "Break it into smaller steps",
      "Let me try again without help",
      "It depends on the task",
    ],
  },
  {
    answerIndex: 13,
    prompt: "How should a session organize the work on screen?",
    description: "This affects navigation and visible structure, not what counts as learning.",
    options: [
      "Show one step at a time",
      "Keep the full path visible",
      "Give me choices and let me decide",
      "Use the least guidance that works",
      "It depends on the session",
    ],
  },
] as const;

export const FREEFORM_LEARNING_CONTEXT_INDEX = 14;
export const OBSERVATION_CORRECTION_INDEX = 15;
export const LEARNER_ANSWER_COUNT = 16;

export type ExpandedLearnerContext = {
  functionalSupportNeed: string | null;
  processingPreference: string | null;
  memoryChallenge: string | null;
  supportPreference: string | null;
  workspacePreference: string | null;
  freeformContext: string | null;
  observationCorrection: string | null;
};

type StoredAdditionalContext = {
  schemaVersion: 2;
  functionalSupportNeed: string;
  initialContext: string;
  processingPreference: string;
  memoryChallenge: string;
  supportPreference: string;
  workspacePreference: string;
  freeformContext: string;
  observationCorrection: string;
};

export function expandedLearnerContextFromAnswers(answers: string[]): ExpandedLearnerContext {
  return {
    functionalSupportNeed: functionalSupportNeedFromAnswer(answers[8]),
    processingPreference: boundedAnswer(answers[10], 240),
    memoryChallenge: boundedAnswer(answers[11], 240),
    supportPreference: boundedAnswer(answers[12], 240),
    workspacePreference: boundedAnswer(answers[13], 240),
    freeformContext: boundedAnswer(answers[FREEFORM_LEARNING_CONTEXT_INDEX], 800),
    observationCorrection: boundedAnswer(answers[OBSERVATION_CORRECTION_INDEX], 500),
  };
}

export function encodeAdditionalLearnerContext(answers: string[]) {
  const expanded = expandedLearnerContextFromAnswers(answers);
  const stored: StoredAdditionalContext = {
    schemaVersion: 2,
    functionalSupportNeed: expanded.functionalSupportNeed ?? "",
    initialContext: boundedAnswer(answers[9], 300) ?? "",
    processingPreference: expanded.processingPreference ?? "",
    memoryChallenge: expanded.memoryChallenge ?? "",
    supportPreference: expanded.supportPreference ?? "",
    workspacePreference: expanded.workspacePreference ?? "",
    freeformContext: expanded.freeformContext ?? "",
    observationCorrection: expanded.observationCorrection ?? "",
  };
  return JSON.stringify(stored);
}

export function mergeStoredAdditionalContext(answers: string[], value: string | null) {
  const merged = Array.from({ length: LEARNER_ANSWER_COUNT }, (_, index) => answers[index] ?? "");
  if (!value) return merged;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    merged[9] = value.slice(0, 300);
    return merged;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    merged[9] = value.slice(0, 300);
    return merged;
  }

  const stored = parsed as Record<string, unknown>;
  merged[8] = functionalSupportNeedFromAnswer(readStoredText(stored, "functionalSupportNeed", 240)) ?? "";
  merged[9] = readStoredText(stored, "initialContext", 300);
  merged[10] = readStoredText(stored, "processingPreference", 240);
  merged[11] = readStoredText(stored, "memoryChallenge", 240);
  merged[12] = readStoredText(stored, "supportPreference", 240);
  merged[13] = readStoredText(stored, "workspacePreference", 240);
  merged[FREEFORM_LEARNING_CONTEXT_INDEX] = readStoredText(stored, "freeformContext", 800);
  merged[OBSERVATION_CORRECTION_INDEX] = readStoredText(stored, "observationCorrection", 500);
  return merged;
}

export function functionalSupportNeedFromAnswer(value: string | undefined) {
  const normalized = boundedAnswer(value, 240);
  return normalized && FUNCTIONAL_SUPPORT_OPTIONS.includes(normalized as (typeof FUNCTIONAL_SUPPORT_OPTIONS)[number])
    ? normalized
    : null;
}

export function expandedLearnerContextFromStored(value: string | null) {
  return expandedLearnerContextFromAnswers(mergeStoredAdditionalContext([], value));
}

export function deepProfileAnswerCount(answers: string[]) {
  return DEEP_PROFILE_QUESTIONS.filter((question) => Boolean(answers[question.answerIndex]?.trim())).length
    + (answers[FREEFORM_LEARNING_CONTEXT_INDEX]?.trim() ? 1 : 0);
}

function readStoredText(value: Record<string, unknown>, key: string, maxLength: number) {
  return typeof value[key] === "string" ? value[key].trim().slice(0, maxLength) : "";
}

function boundedAnswer(value: string | undefined, maxLength: number) {
  const normalized = value?.trim().slice(0, maxLength) ?? "";
  return normalized || null;
}
