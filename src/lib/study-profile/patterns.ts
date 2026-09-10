import { STUDY_PROFILE_STUDY_GOAL_LABELS } from "@/lib/study-profile/config";
import { STUDY_PROFILE_QUESTION_BY_ID } from "@/lib/study-profile/questions";
import {
  STUDY_PROFILE_DIMENSIONS,
  type StudyProfileAnswers,
  type StudyProfileDimension,
  type StudyProfileNamedPattern,
  type StudyProfileNamedPatternId,
  type StudyProfileOpportunityPatternId,
  type StudyProfileSnapshot,
  type StudyProfileStudyGoal,
  type StudyProfileSubtype,
} from "@/lib/study-profile/types";

type PatternCopy = Omit<StudyProfileNamedPattern, "modifier">;

type StudyProfilePairKey =
  | "starting_friction|structure_need"
  | "starting_friction|attention_variability"
  | "starting_friction|calibration_risk"
  | "starting_friction|mistake_sensitivity"
  | "starting_friction|cognitive_stamina"
  | "structure_need|attention_variability"
  | "structure_need|calibration_risk"
  | "structure_need|mistake_sensitivity"
  | "structure_need|cognitive_stamina"
  | "attention_variability|calibration_risk"
  | "attention_variability|mistake_sensitivity"
  | "attention_variability|cognitive_stamina"
  | "calibration_risk|mistake_sensitivity"
  | "calibration_risk|cognitive_stamina"
  | "mistake_sensitivity|cognitive_stamina";

type SubtypeCopy = Pick<StudyProfileSubtype, "heading" | "body" | "highestLeverageMove">;

const SUBTYPE_COPY: Record<StudyProfilePairKey, SubtypeCopy> = {
  "starting_friction|structure_need": {
    heading: "A clear first move makes starting easier.",
    body: "Delay grows when the first task also requires planning. A short sequence removes that decision and gives momentum somewhere to begin.",
    highestLeverageMove: "Write the first three actions before you sit down.",
  },
  "starting_friction|attention_variability": {
    heading: "Short setup protects your attention.",
    body: "A long setup creates more time for delay and distraction. Moving straight into a small active task gives the session traction.",
    highestLeverageMove: "Open with one question and a 10-minute timer.",
  },
  "starting_friction|calibration_risk": {
    heading: "Start with a quick knowledge check.",
    body: "The first useful action can also show what needs work. A brief closed-note check creates direction without a long warmup.",
    highestLeverageMove: "Answer three questions before opening your notes.",
  },
  "starting_friction|mistake_sensitivity": {
    heading: "Make the first attempt easier to commit to.",
    body: "Starting gets harder when the opening attempt also feels like it has to be correct. A rough first pass creates something useful to improve.",
    highestLeverageMove: "Set a five-minute first attempt with no editing.",
  },
  "starting_friction|cognitive_stamina": {
    heading: "Use your best energy on the first real task.",
    body: "Delay can push demanding work into the part of the session where energy is already falling. Prepare early and keep the first block focused.",
    highestLeverageMove: "Prepare the materials early, then start with one 15-minute block.",
  },
  "structure_need|attention_variability": {
    heading: "Give variety a clear sequence.",
    body: "Changing activity can help attention, but unplanned switching adds more decisions. A short sequence keeps each change tied to the same goal.",
    highestLeverageMove: "Choose three short activities and their order before you begin.",
  },
  "structure_need|calibration_risk": {
    heading: "Let a quick check choose the next step.",
    body: "A plan becomes more useful when real performance decides what comes next. One short check can narrow the review and remove guesswork.",
    highestLeverageMove: "Use one test, review, and retest sequence.",
  },
  "structure_need|mistake_sensitivity": {
    heading: "Give revision a clear stopping point.",
    body: "Detailed planning and repeated checking can stretch the same task. A finish rule keeps standards useful without letting revision take over.",
    highestLeverageMove: "Write the finish rule before you start.",
  },
  "structure_need|cognitive_stamina": {
    heading: "Build the plan in visible chunks.",
    body: "A clear plan helps, but seeing the whole sequence at once can make the session feel longer. Small checkpoints keep the next action manageable.",
    highestLeverageMove: "Plan two short blocks and show yourself only the next block.",
  },
  "attention_variability|calibration_risk": {
    heading: "Use quick checks to bring focus back.",
    body: "Active checks reveal what needs work while changing the task enough to re-engage attention. The result gives the next activity a clear target.",
    highestLeverageMove: "Recall for five minutes, check the gaps, then change format.",
  },
  "attention_variability|mistake_sensitivity": {
    heading: "Finish a short attempt before checking.",
    body: "Switching or checking early can interrupt the evidence you need from an independent attempt. Keep the attempt short enough to complete first.",
    highestLeverageMove: "Finish one answer before checking or switching.",
  },
  "attention_variability|cognitive_stamina": {
    heading: "Short active rounds protect the quality of your work.",
    body: "Focus and accuracy are more likely to hold when each round has a clear task and a planned reset. More time is useful only while the work stays productive.",
    highestLeverageMove: "Use two 12-minute rounds with a three-minute reset.",
  },
  "calibration_risk|mistake_sensitivity": {
    heading: "Commit first, then use the result.",
    body: "Checking before committing can hide the difference between recognition and recall. A low-stakes answer gives you evidence and a precise correction target.",
    highestLeverageMove: "Answer before checking, then write one correction.",
  },
  "calibration_risk|cognitive_stamina": {
    heading: "Check your learning before your energy drops.",
    body: "A closed-note check is most useful while attention and accuracy are still strong. Put it early enough that the result reflects your knowledge clearly.",
    highestLeverageMove: "Do a closed-note check in the first half of the session.",
  },
  "mistake_sensitivity|cognitive_stamina": {
    heading: "Use review time on the work that needs it.",
    body: "Long review can drain energy without improving every answer equally. Use the remaining time on missed and uncertain work, then stop.",
    highestLeverageMove: "Review only missed and uncertain items before stopping.",
  },
};

const UNDERCONFIDENCE_SUBTYPE_COPY: Partial<Record<StudyProfilePairKey, SubtypeCopy>> = {
  "starting_friction|calibration_risk": {
    heading: "Let a quick start build confidence.",
    body: "Starting is the clearest friction, and your confidence may lag behind your actual performance. A small closed-note attempt gives you visible evidence straight away.",
    highestLeverageMove: "Complete three questions, then record what you answered correctly.",
  },
  "structure_need|calibration_risk": {
    heading: "Use results to choose the next step.",
    body: "A clear sequence helps most when correct work can update your confidence. Let each short check decide what to review and what to leave alone.",
    highestLeverageMove: "Mark correct answers first, then plan only the gaps.",
  },
  "attention_variability|calibration_risk": {
    heading: "Short checks can steady focus and confidence.",
    body: "Brief recall changes the activity and records what you can already do. That evidence makes the next task easier to choose.",
    highestLeverageMove: "Run a five-minute recall check and keep the correct answers visible.",
  },
  "calibration_risk|mistake_sensitivity": {
    heading: "Let correct answers count.",
    body: "Doubt can remain even after good work, especially when each mistake receives more attention than each success. Keep both kinds of evidence visible.",
    highestLeverageMove: "Record correct answers beside the gaps you still need to review.",
  },
  "calibration_risk|cognitive_stamina": {
    heading: "Capture evidence while your energy is strongest.",
    body: "Confidence is easier to update when the result comes from your strongest part of the session. Check early and keep the correct work visible.",
    highestLeverageMove: "Do one early recall check and record every correct answer.",
  },
};

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

const DIMENSION_PATTERN: Record<StudyProfileDimension, StudyProfileOpportunityPatternId> = {
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
  const secondaryEligible = profile.secondaryPattern.classification !== "low";
  const secondaryId = secondaryEligible
    ? patternIdForDimension(profile.secondaryPattern.dimension, profile)
    : null;

  return {
    ...PATTERN_COPY[primaryId],
    modifier: secondaryId
      ? `Paired with ${PATTERN_COPY[secondaryId].name}`
      : null,
  };
}

export function resolveStudyProfileSubtype(
  profile: StudyProfileSnapshot,
): StudyProfileSubtype | null {
  if (profile.isBalanced || profile.secondaryPattern.classification === "low") return null;

  const primaryDimension = profile.primaryPattern.dimension;
  const secondaryDimension = profile.secondaryPattern.dimension;
  if (primaryDimension === secondaryDimension) return null;

  const pairedPatternId = patternIdForDimension(secondaryDimension, profile);
  const pairKey = studyProfilePairKey(primaryDimension, secondaryDimension);
  const copy = profile.calibrationDirection === "underconfidence_risk"
    ? UNDERCONFIDENCE_SUBTYPE_COPY[pairKey] ?? SUBTYPE_COPY[pairKey]
    : SUBTYPE_COPY[pairKey];

  return {
    pairedPattern: {
      id: pairedPatternId,
      name: PATTERN_COPY[pairedPatternId].name,
      dimension: secondaryDimension,
    },
    ...copy,
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
): StudyProfileOpportunityPatternId {
  if (
    dimension === "calibration_risk"
    && profile.calibrationDirection === "underconfidence_risk"
  ) {
    return "evidence_doubter" as const;
  }
  return DIMENSION_PATTERN[dimension];
}

function studyProfilePairKey(
  first: StudyProfileDimension,
  second: StudyProfileDimension,
): StudyProfilePairKey {
  const ordered = [first, second].sort(
    (left, right) => STUDY_PROFILE_DIMENSIONS.indexOf(left)
      - STUDY_PROFILE_DIMENSIONS.indexOf(right),
  );
  return `${ordered[0]}|${ordered[1]}` as StudyProfilePairKey;
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
