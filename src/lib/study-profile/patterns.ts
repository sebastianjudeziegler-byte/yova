import { STUDY_PROFILE_STUDY_GOAL_LABELS } from "@/lib/study-profile/config";
import { STUDY_PROFILE_QUESTION_BY_ID } from "@/lib/study-profile/questions";
import type {
  StudyProfileAnswers,
  StudyProfileDimension,
  StudyProfileNamedPattern,
  StudyProfileNamedPatternId,
  StudyProfileSnapshot,
  StudyProfileStudyGoal,
} from "@/lib/study-profile/types";

type PatternCopy = Omit<StudyProfileNamedPattern, "modifier">;

const PATTERN_COPY: Record<StudyProfileNamedPatternId, PatternCopy> = {
  stalled_starter: {
    id: "stalled_starter",
    name: "The Stalled Starter",
    dimension: "starting_friction",
    tell: "Once you are in, you are fine. Starting is the wall.",
    twist: "Your follow-through is stronger once the work is moving.",
  },
  scattershot: {
    id: "scattershot",
    name: "The Scattershot",
    dimension: "structure_need",
    tell: "You work hard in whatever order feels most urgent.",
    twist: "Your effort and stamina are real. A short sequence gives them a target.",
  },
  drifter: {
    id: "drifter",
    name: "The Drifter",
    dimension: "attention_variability",
    tell: "You start clean, then your attention leaks out of the session.",
    twist: "You can re-engage quickly when the format changes on purpose.",
  },
  familiarity_trap: {
    id: "familiarity_trap",
    name: "The Familiarity Trap",
    dimension: "calibration_risk",
    tell: "Material can feel easy before you can produce it without notes.",
    twist: "Your effort is real. A better feedback loop makes that effort count.",
  },
  evidence_doubter: {
    id: "evidence_doubter",
    name: "The Evidence Doubter",
    dimension: "calibration_risk",
    tell: "Your results may be stronger than the feeling you trust before a test.",
    twist: "You already create useful evidence. The next step is letting correct work update your confidence.",
  },
  polisher: {
    id: "polisher",
    name: "The Polisher",
    dimension: "mistake_sensitivity",
    tell: "It can feel safer to check or improve the work before you commit to an answer.",
    twist: "Your standards are useful once they are aimed at the errors that matter most.",
  },
  sprinter: {
    id: "sprinter",
    name: "The Sprinter",
    dimension: "cognitive_stamina",
    tell: "Your best work happens early, then quality drops as the session stretches.",
    twist: "Your peak is genuinely strong. The plan should protect it instead of forcing endurance.",
  },
  all_rounder: {
    id: "all_rounder",
    name: "The All-Rounder",
    dimension: null,
    tell: "No single habit is creating a clear leak right now.",
    twist: "Your next gains come from upgrading methods and using your study time more efficiently.",
  },
};

const DIMENSION_PATTERN: Record<StudyProfileDimension, StudyProfileNamedPatternId> = {
  starting_friction: "stalled_starter",
  structure_need: "scattershot",
  attention_variability: "drifter",
  calibration_risk: "familiarity_trap",
  mistake_sensitivity: "polisher",
  cognitive_stamina: "sprinter",
};

const DIMENSION_QUESTION_PAIRS: Record<
  StudyProfileDimension,
  readonly [keyof StudyProfileAnswers, keyof StudyProfileAnswers]
> = {
  starting_friction: ["q1", "q2"],
  structure_need: ["q3", "q4"],
  attention_variability: ["q5", "q6"],
  calibration_risk: ["q7", "q8"],
  mistake_sensitivity: ["q9", "q10"],
  cognitive_stamina: ["q11", "q12"],
};

export function resolveStudyProfileNamedPattern(
  profile: StudyProfileSnapshot,
): StudyProfileNamedPattern {
  if (profile.isBalanced) return { ...PATTERN_COPY.all_rounder, modifier: null };

  const primaryId = patternIdForDimension(
    profile.primaryPattern.dimension,
    profile,
  );
  const secondaryEligible = profile.secondaryPattern.rawScore >= 3;
  const secondaryId = secondaryEligible
    ? patternIdForDimension(profile.secondaryPattern.dimension, profile)
    : null;

  return {
    ...PATTERN_COPY[primaryId],
    modifier: secondaryId
      ? `Also showing: ${PATTERN_COPY[secondaryId].name}`
      : null,
  };
}

export function studyProfilePatternCopy(id: StudyProfileNamedPatternId) {
  return PATTERN_COPY[id];
}

export function buildStudyProfileFreeInsight(
  profile: StudyProfileSnapshot,
  answers?: StudyProfileAnswers,
) {
  const pattern = resolveStudyProfileNamedPattern(profile);
  if (pattern.id === "all_rounder") {
    return {
      heading: "No single habit is getting in your way",
      body: profile.lowSignal
        ? "Your answers showed very little friction across all six habits. Treat that as a starting snapshot, then use real practice results to check whether it holds."
        : "No habit crossed the main-opportunity threshold. That means the biggest return is likely to come from method upgrades, not a repair plan for one weak point.",
    };
  }

  const evidence = answers && pattern.dimension
    ? quoteAnswerPair(pattern.dimension, answers)
    : "Two answers in this part of the profile pointed in the same direction.";
  return {
    heading: "The connection in your answers",
    body: `${evidence} ${pattern.tell}`,
  };
}

export function buildStudyProfileWhySection(
  profile: StudyProfileSnapshot,
  answers?: StudyProfileAnswers,
  studyGoal?: StudyProfileStudyGoal | null,
) {
  const pattern = resolveStudyProfileNamedPattern(profile);
  if (pattern.id === "all_rounder") {
    const goal = studyGoal
      ? `For ${STUDY_PROFILE_STUDY_GOAL_LABELS[studyGoal].toLowerCase()}, that points toward method upgrades and a tighter weekly plan.`
      : "That points toward method upgrades and a tighter weekly plan.";
    return {
      heading: "Why this pattern fits",
      body: profile.lowSignal
        ? `Every habit answer showed low friction. That can be accurate, but real closed-note results are the best way to check the snapshot. ${goal}`
        : `None of the six habits crossed the main-opportunity threshold, and no single answer created a severe spike. ${goal}`,
    };
  }
  const evidence = answers && pattern.dimension
    ? quoteAnswerPair(pattern.dimension, answers)
    : "Your strongest signal came from two answers about the same study habit.";
  const goal = studyGoal
    ? `That matters most while you are focused on ${STUDY_PROFILE_STUDY_GOAL_LABELS[studyGoal].toLowerCase()}.`
    : "That matters because it changes which study method should come first.";

  return {
    heading: "Why this is happening",
    body: `${evidence} Those answers point to ${pattern.name}. The rest of your habits may be more mixed, but this is the best place to start. ${pattern.tell} ${goal}`,
  };
}

function patternIdForDimension(
  dimension: StudyProfileDimension,
  profile: StudyProfileSnapshot,
) {
  if (
    dimension === "calibration_risk"
    && profile.calibrationDirection === "underconfidence_risk"
  ) {
    return "evidence_doubter" as const;
  }
  return DIMENSION_PATTERN[dimension];
}

function quoteAnswerPair(
  dimension: StudyProfileDimension,
  answers: StudyProfileAnswers,
) {
  const [firstId, secondId] = DIMENSION_QUESTION_PAIRS[dimension];
  const first = withoutTerminalPunctuation(selectedOptionLabel(firstId, answers[firstId]));
  const second = withoutTerminalPunctuation(selectedOptionLabel(secondId, answers[secondId]));
  return `You chose "${first}." You also chose "${second}."`;
}

function withoutTerminalPunctuation(value: string) {
  return value.replace(/[.!?]+$/, "");
}

function selectedOptionLabel(
  questionId: keyof StudyProfileAnswers,
  answerId: StudyProfileAnswers[keyof StudyProfileAnswers],
) {
  const question = STUDY_PROFILE_QUESTION_BY_ID[questionId];
  return question.options.find((option) => option.id === answerId)?.label
    ?? "That answer is no longer available";
}
