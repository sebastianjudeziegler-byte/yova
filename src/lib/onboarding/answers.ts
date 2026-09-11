import { onboardingQuestions as LEGACY_POSITIONAL_QUESTIONS } from "@/lib/sample-data";
import {
  isOnboardingOptionId,
  ONBOARDING_QUESTION_IDS,
  onboardingQuestion,
  type OnboardingQuestionId,
} from "@/lib/onboarding/questions";

/**
 * Onboarding answers keyed by stable question ID.
 *
 * Before this record existed, answers were an array indexed by question
 * position, and reordering the questions broke every saved profile. The
 * record is the authority for the ten baseline questions. It travels inside
 * the learner answer container at `ONBOARDING_ANSWERS_ANSWER_INDEX` (the same
 * carrier pattern the personalization state already uses at index 16) and
 * inside the profile's stored additional context on the server.
 *
 * `onboardingAnswersFromLegacyArray` is the one-time migration for profiles
 * saved by position. `projectOnboardingAnswersToLegacyPositions` keeps the
 * legacy positions and database columns populated for readers that were not
 * migrated in Brief 1; those positions are a derived projection, never read
 * by anything new.
 */
export const ONBOARDING_ANSWERS_VERSION = 1 as const;
export const ONBOARDING_ANSWERS_ANSWER_INDEX = 17;
export const ONBOARDING_ANSWERS_MAX_LENGTH = 4_000;

export type OnboardingSingleAnswerId = Exclude<OnboardingQuestionId, "support_needs">;

export type OnboardingAnswerValues = Partial<Record<OnboardingSingleAnswerId, string>> & {
  support_needs?: string[];
};

export type OnboardingLegacyAnswers = {
  /** Retired question "What most often makes studying difficult?" (legacy position 0). */
  common_blocker?: string;
  /** Retired question "What do you most want YOVA to improve?" (legacy position 7). */
  improvement_goal?: string;
};

export type OnboardingAnswers = {
  version: typeof ONBOARDING_ANSWERS_VERSION;
  answers: OnboardingAnswerValues;
  /** Answers to retired questions survive the migration untouched; nothing routes on them. */
  legacy: OnboardingLegacyAnswers;
};

/** Legacy position of every current question that had one. Two questions are new. */
export const LEGACY_ONBOARDING_POSITIONS: Readonly<Partial<Record<OnboardingQuestionId, number>>> = {
  guidance: 1,
  session_length: 2,
  difficulty_help: 3,
  focus_loss: 4,
  starting_pattern: 5,
  energy_window: 6,
  support_needs: 8,
  extra_context: 9,
};

const LEGACY_COMMON_BLOCKER_POSITION = 0;
const LEGACY_IMPROVEMENT_GOAL_POSITION = 7;

/**
 * Labels written by profiles saved before option IDs existed, keyed by the
 * stable question ID. Mirrors the `LEGACY_ONBOARDING_LABEL_IDS` pattern that
 * the positional list uses; keep an old label here if learner-facing copy
 * changes so a saved label still resolves to its ID.
 */
export const LEGACY_ONBOARDING_LABEL_IDS_BY_QUESTION: Readonly<Record<OnboardingQuestionId, Readonly<Record<string, string>>>> = {
  energy_window: { Morning: "morning", Afternoon: "afternoon", Evening: "evening", "Late night": "late_night", "It changes": "varies" },
  session_length: { "10 to 15 minutes": "minutes_10_15", "20 to 30 minutes": "minutes_20_30", "30 to 45 minutes": "minutes_30_45", "45 to 60 minutes": "minutes_45_60", "It depends": "task_dependent" },
  focus_loss: { Rarely: "rarely", Sometimes: "sometimes", Often: "often", "Very often": "very_often" },
  guidance: { "Tell me exactly what to do": "exact_guidance", "Give me clear structure with flexibility": "structured_flexibility", "Recommend options and let me decide": "learner_choice" },
  difficulty_help: { "A simple explanation first": "simple_explanation", "A concrete example first": "concrete_example", "Step-by-step instructions": "step_by_step", "Trying it and getting feedback": "try_then_feedback", "A mixture": "mixed" },
  prove_knowing: { "Explaining it out loud or in writing": "explain_back", "Mapping out how the pieces connect": "map_it", "Answering questions on it": "answer_questions", "Working through a problem": "solve_it" },
  gist_detail: { "I get the big picture but miss specifics": "gist_leaning", "I know the details but lose how they fit together": "detail_leaning", "Depends on the subject": "balanced" },
  starting_pattern: { "I usually begin when I plan to": "on_time", "I intend to begin but often delay": "often_delay", "I start when the deadline feels close": "deadline_pressure", "I avoid planning because it feels larger": "planning_avoidance", "It varies": "varies" },
  support_needs: { "Shorter sections with fewer steps at once": "shorter_sections", "Less text and more visual structure": "reduced_text_visual_structure", "Extra time to read and respond": "extra_reading_time", "Instructions repeated in simpler language": "simpler_repeated_instructions", "Frequent check-ins and clear stopping points": "frequent_check_ins", "No extra support right now": "no_extra_support", "It depends on the task": "task_dependent" },
  extra_context: { "I understand in class but forget during tests": "forget_during_tests", "Long plans make me shut down": "long_plan_shutdown", "I need examples before I feel ready": "examples_before_ready", "Nothing else for now": "nothing_else" },
};

export function emptyOnboardingAnswers(): OnboardingAnswers {
  return { version: ONBOARDING_ANSWERS_VERSION, answers: {}, legacy: {} };
}

/** Resolve a stored value (ID or pre-ID label) to a valid option ID for one question. */
export function onboardingOptionIdFor(id: OnboardingQuestionId, value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (isOnboardingOptionId(id, normalized)) return normalized;
  const legacyId = LEGACY_ONBOARDING_LABEL_IDS_BY_QUESTION[id][normalized] ?? null;
  return legacyId && isOnboardingOptionId(id, legacyId) ? legacyId : null;
}

/** The option ID for a question, or null when unanswered. Never a label. */
export function onboardingAnswerId(record: OnboardingAnswers, id: OnboardingSingleAnswerId): string | null {
  return onboardingOptionIdFor(id, record.answers[id]);
}

export function onboardingSupportNeeds(record: OnboardingAnswers): string[] {
  return (record.answers.support_needs ?? [])
    .map((value) => onboardingOptionIdFor("support_needs", value))
    .filter((value): value is string => Boolean(value));
}

export function onboardingAnsweredCount(record: OnboardingAnswers) {
  return ONBOARDING_QUESTION_IDS.filter((id) => (
    id === "support_needs"
      ? onboardingSupportNeeds(record).length > 0
      : onboardingAnswerId(record, id) !== null
  )).length;
}

export function withOnboardingAnswer(
  record: OnboardingAnswers,
  id: OnboardingQuestionId,
  value: string | readonly string[] | null,
): OnboardingAnswers {
  const answers: OnboardingAnswerValues = { ...record.answers };
  if (id === "support_needs") {
    const values = (typeof value === "string" ? [value] : value ?? [])
      .map((candidate) => onboardingOptionIdFor("support_needs", candidate))
      .filter((candidate): candidate is string => Boolean(candidate));
    if (values.length) answers.support_needs = [...new Set(values)];
    else delete answers.support_needs;
  } else {
    const resolved = typeof value === "string" ? onboardingOptionIdFor(id, value) : null;
    if (resolved) answers[id] = resolved;
    else delete answers[id];
  }
  return { ...record, answers };
}

/** Toggle one support option; the question is multi-select. */
export function toggleOnboardingSupportNeed(record: OnboardingAnswers, optionId: string): OnboardingAnswers {
  const current = onboardingSupportNeeds(record);
  const next = current.includes(optionId) ? current.filter((value) => value !== optionId) : [...current, optionId];
  return withOnboardingAnswer(record, "support_needs", next);
}

/**
 * One-time migration for profiles saved by position. Labels resolve through
 * the legacy label map; unknown values are dropped rather than guessed.
 */
export function onboardingAnswersFromLegacyArray(answers: readonly string[]): OnboardingAnswers {
  let record = emptyOnboardingAnswers();
  for (const id of ONBOARDING_QUESTION_IDS) {
    const position = LEGACY_ONBOARDING_POSITIONS[id];
    if (position === undefined) continue;
    const stored = answers[position];
    if (!stored?.trim()) continue;
    record = withOnboardingAnswer(record, id, id === "support_needs" ? stored.split("|") : stored);
  }
  const legacy: OnboardingLegacyAnswers = {};
  const blocker = legacyPositionalAnswerId(LEGACY_COMMON_BLOCKER_POSITION, answers[LEGACY_COMMON_BLOCKER_POSITION]);
  const goal = legacyPositionalAnswerId(LEGACY_IMPROVEMENT_GOAL_POSITION, answers[LEGACY_IMPROVEMENT_GOAL_POSITION]);
  if (blocker) legacy.common_blocker = blocker;
  if (goal) legacy.improvement_goal = goal;
  return { ...record, legacy };
}

function legacyPositionalAnswerId(position: number, value: string | undefined) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  const question = LEGACY_POSITIONAL_QUESTIONS[position];
  if (!question) return null;
  return question.options.find((option) => option.id === normalized || option.label === normalized)?.id ?? null;
}

export function parseOnboardingAnswers(value: unknown): OnboardingAnswers | null {
  if (typeof value === "string") {
    if (!value.trim()) return null;
    try {
      return parseOnboardingAnswers(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== ONBOARDING_ANSWERS_VERSION) return null;
  const rawAnswers = candidate.answers && typeof candidate.answers === "object" && !Array.isArray(candidate.answers)
    ? candidate.answers as Record<string, unknown>
    : {};
  let record = emptyOnboardingAnswers();
  for (const id of ONBOARDING_QUESTION_IDS) {
    const raw = rawAnswers[id];
    if (id === "support_needs") {
      if (Array.isArray(raw)) record = withOnboardingAnswer(record, id, raw.filter((item): item is string => typeof item === "string"));
      else if (typeof raw === "string") record = withOnboardingAnswer(record, id, [raw]);
    } else if (typeof raw === "string") {
      record = withOnboardingAnswer(record, id, raw);
    }
  }
  const rawLegacy = candidate.legacy && typeof candidate.legacy === "object" && !Array.isArray(candidate.legacy)
    ? candidate.legacy as Record<string, unknown>
    : {};
  const legacy: OnboardingLegacyAnswers = {};
  const blocker = typeof rawLegacy.common_blocker === "string" ? legacyPositionalAnswerId(LEGACY_COMMON_BLOCKER_POSITION, rawLegacy.common_blocker) : null;
  const goal = typeof rawLegacy.improvement_goal === "string" ? legacyPositionalAnswerId(LEGACY_IMPROVEMENT_GOAL_POSITION, rawLegacy.improvement_goal) : null;
  if (blocker) legacy.common_blocker = blocker;
  if (goal) legacy.improvement_goal = goal;
  return { ...record, legacy };
}

export function serializeOnboardingAnswers(record: OnboardingAnswers): string {
  const answers: OnboardingAnswerValues = {};
  for (const id of ONBOARDING_QUESTION_IDS) {
    if (id === "support_needs") {
      const values = onboardingSupportNeeds(record);
      if (values.length) answers.support_needs = values;
      continue;
    }
    const value = onboardingAnswerId(record, id);
    if (value) answers[id] = value;
  }
  const compact: OnboardingAnswers = { version: ONBOARDING_ANSWERS_VERSION, answers, legacy: { ...record.legacy } };
  const serialized = JSON.stringify(compact);
  if (serialized.length > ONBOARDING_ANSWERS_MAX_LENGTH) {
    throw new RangeError("The onboarding answers are too large to store safely.");
  }
  return serialized;
}

/**
 * Read the ID-keyed record from the learner answer container. A container
 * without the record is migrated from its legacy positions exactly once; the
 * next write stores the record so the positions are never read again.
 */
export function readOnboardingAnswers(answers: readonly string[]): OnboardingAnswers {
  return parseOnboardingAnswers(answers[ONBOARDING_ANSWERS_ANSWER_INDEX]) ?? onboardingAnswersFromLegacyArray(answers);
}

export function hasStoredOnboardingAnswers(answers: readonly string[]) {
  return parseOnboardingAnswers(answers[ONBOARDING_ANSWERS_ANSWER_INDEX]) !== null;
}

/**
 * Store the record in the container and refresh the legacy projection so
 * unmigrated readers and the profile columns see the same answers.
 */
export function writeOnboardingAnswers(answers: readonly string[], record: OnboardingAnswers): string[] {
  const next = Array.from(
    { length: Math.max(answers.length, ONBOARDING_ANSWERS_ANSWER_INDEX + 1) },
    (_, index) => answers[index] ?? "",
  );
  next[ONBOARDING_ANSWERS_ANSWER_INDEX] = serializeOnboardingAnswers(record);
  return projectOnboardingAnswersToLegacyPositions(next, record);
}

/**
 * Derived compatibility projection. Never the authority. A position whose old
 * value is not a recognised answer (for example free text saved by a much
 * older build at the "anything else" position) is left alone when the record
 * has no answer for that question, so nothing a learner wrote is discarded.
 */
export function projectOnboardingAnswersToLegacyPositions(answers: readonly string[], record: OnboardingAnswers): string[] {
  const next = [...answers];
  const project = (position: number, value: string | null, recognised: (existing: string) => boolean) => {
    const existing = next[position] ?? "";
    if (value) next[position] = value;
    else if (recognised(existing)) next[position] = "";
  };
  for (const id of ONBOARDING_QUESTION_IDS) {
    const position = LEGACY_ONBOARDING_POSITIONS[id];
    if (position === undefined) continue;
    const value = id === "support_needs" ? onboardingSupportNeeds(record)[0] ?? null : onboardingAnswerId(record, id);
    project(position, value, (existing) => onboardingOptionIdFor(id, existing) !== null);
  }
  project(LEGACY_COMMON_BLOCKER_POSITION, record.legacy.common_blocker ?? null, (existing) => legacyPositionalAnswerId(LEGACY_COMMON_BLOCKER_POSITION, existing) !== null);
  project(LEGACY_IMPROVEMENT_GOAL_POSITION, record.legacy.improvement_goal ?? null, (existing) => legacyPositionalAnswerId(LEGACY_IMPROVEMENT_GOAL_POSITION, existing) !== null);
  return next;
}

/** Learner-facing label for a stored answer; for display only, never for routing. */
export function onboardingAnswerLabel(record: OnboardingAnswers, id: OnboardingSingleAnswerId) {
  const answerId = onboardingAnswerId(record, id);
  return answerId ? onboardingQuestion(id).options.find((option) => option.id === answerId)?.label ?? null : null;
}
