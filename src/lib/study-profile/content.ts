import { STUDY_PROFILE_DIMENSION_NAMES } from "@/lib/study-profile/config";
import type {
  StudyProfileCalibrationDirection,
  StudyProfileClassification,
  StudyProfileDimension,
  StudyProfileMetadata,
  StudyProfileProductAdaptation,
  StudyProfileRecommendation,
  StudyProfileSnapshot,
  StudyProfileWarning,
} from "@/lib/study-profile/types";

export type StudyProfileLevelContent = {
  label: string;
  summary: string;
  detail: string;
};

export type StudyProfileDimensionContent = {
  name: string;
  levels: Record<StudyProfileClassification, StudyProfileLevelContent>;
};

export const STUDY_PROFILE_DIMENSION_CONTENT: Record<
  StudyProfileDimension,
  StudyProfileDimensionContent
> = {
  starting_friction: {
    name: STUDY_PROFILE_DIMENSION_NAMES.starting_friction,
    levels: {
      low: {
        label: "Usually easy to begin",
        summary: "You usually turn a study plan into action without much extra help.",
        detail: "You can often start with a broad goal and work out the path as you go. Keep setup short so planning does not slow down a start that already works.",
      },
      moderate: {
        label: "Some trouble beginning",
        summary: "You can usually begin, but a difficult task or unclear first step may slow you down.",
        detail: "Choose the first action before the session and make it small enough to start without a long debate. You probably do not need every later step planned in detail.",
      },
      high: {
        label: "Hard to begin",
        summary: "Getting from a plan to the first real action looks like one of your biggest obstacles right now.",
        detail: "Pressure may be doing the job that a better starting routine could do. Use a tiny, specific first action and a short timer so you can begin before the task feels fully comfortable.",
      },
    },
  },
  structure_need: {
    name: STUDY_PROFILE_DIMENSION_NAMES.structure_need,
    levels: {
      low: {
        label: "Flexible",
        summary: "You are comfortable choosing your own path from a broad goal.",
        detail: "A detailed checklist may create more work than it saves. Start with one outcome, then add a checkpoint only if you stop making progress.",
      },
      moderate: {
        label: "Balanced",
        summary: "A clear direction helps, but you do not need every step chosen for you.",
        detail: "Decide the goal, the first move, and one or two checkpoints. Leave the middle flexible enough to respond to what you learn.",
      },
      high: {
        label: "Clear steps help most",
        summary: "Too many choices can use up energy before the useful work begins.",
        detail: "Write a short sequence before you start and keep the current step visible. The plan should be specific, but short enough that maintaining it does not become another assignment.",
      },
    },
  },
  attention_variability: {
    name: STUDY_PROFILE_DIMENSION_NAMES.attention_variability,
    levels: {
      low: {
        label: "Steady",
        summary: "Your focus tends to stay steady once you are working.",
        detail: "You may not need frequent changes to keep going. Longer uninterrupted blocks can work when the task stays active and the goal is clear.",
      },
      moderate: {
        label: "Focus changes sometimes",
        summary: "Your focus may fade over time, and seeing progress can help you stay with the work.",
        detail: "Keep one topic while changing the activity at planned checkpoints. For example, move from recall to explanation or practice questions instead of switching topics at random.",
      },
      high: {
        label: "Focus changes often",
        summary: "Drifting, boredom, or switching can show up quickly during long or repetitive work.",
        detail: "Use short timed blocks, quick feedback, and planned changes in activity. Keep the same topic so variety helps you learn instead of scattering your attention.",
      },
    },
  },
  calibration_risk: {
    name: STUDY_PROFILE_DIMENSION_NAMES.calibration_risk,
    levels: {
      low: {
        label: "Confidence usually matches",
        summary: "Your confidence usually seems to match what you can recall or apply.",
        detail: "This comes from your own answers, so keep an occasional closed-note check in your routine. It will help you confirm that confidence still matches the result.",
      },
      moderate: {
        label: "Confidence is mixed",
        summary: "Your feeling of knowing is useful sometimes, but it may not be dependable in every situation.",
        detail: "Predict how you will do, answer without notes, and compare the prediction with the result. This shows when confidence is useful and when familiar material needs another check.",
      },
      high: {
        label: "Check knowledge more often",
        summary: "The feeling of knowing may not always match what you can produce without help.",
        detail: "Use a short closed-note check earlier in the session. Let the result choose what you review instead of relying on familiarity alone.",
      },
    },
  },
  mistake_sensitivity: {
    name: STUDY_PROFILE_DIMENSION_NAMES.mistake_sensitivity,
    levels: {
      low: {
        label: "Mistakes feel manageable",
        summary: "You are usually willing to try before you know the answer is correct.",
        detail: "That helps you get feedback sooner. Keep making early attempts, then slow down long enough to understand important errors before moving on.",
      },
      moderate: {
        label: "Some concern about mistakes",
        summary: "You usually balance making progress with wanting the work to be right.",
        detail: "When you feel unsure, put a time limit on the first attempt. Feedback can improve a real answer instead of being delayed by more checking or polishing.",
      },
      high: {
        label: "Mistakes can slow you down",
        summary: "Uncertainty or the risk of a wrong answer can make it harder to act.",
        detail: "Use private, low-stakes attempts and plan to revise after checking. The first answer only needs to show you what to improve. It does not need to prove that you already know everything.",
      },
    },
  },
  cognitive_stamina: {
    name: STUDY_PROFILE_DIMENSION_NAMES.cognitive_stamina,
    levels: {
      low: {
        label: "Longer blocks can work",
        summary: "Your focus seems fairly steady during demanding work.",
        detail: "Longer uninterrupted sessions may work for you when the task needs them. Take a break when accuracy or pace drops, not just because a timer says so.",
      },
      moderate: {
        label: "Energy fades over time",
        summary: "Your work may get less accurate or focused after a while, even if you can keep going.",
        detail: "Use a planned checkpoint to catch the point where more minutes stop helping. A short break or a change in activity may restore the quality of your work.",
      },
      high: {
        label: "Short blocks work best",
        summary: "Long, demanding sessions can lose accuracy or focus fairly quickly for you.",
        detail: "Use shorter blocks and put hard work in your best time window. Reset before the quality drops instead of trying to force a long session.",
      },
    },
  },
};

export const STUDY_PROFILE_CALIBRATION_DIRECTION_CONTENT: Record<
  StudyProfileCalibrationDirection,
  Pick<StudyProfileLevelContent, "label" | "summary" | "detail">
> = {
  relatively_calibrated: STUDY_PROFILE_DIMENSION_CONTENT.calibration_risk.levels.low,
  mixed: STUDY_PROFILE_DIMENSION_CONTENT.calibration_risk.levels.moderate,
  overconfidence_risk: {
    label: "Test yourself sooner",
    summary: "Familiar material may sometimes feel learned before you can produce it without notes.",
    detail: "Test yourself earlier so gaps show up before a quiz or exam. This result comes from your answers and is not a fixed judgment about you.",
  },
  underconfidence_risk: {
    label: "Trust correct results more",
    summary: "You may sometimes feel less prepared than your later result shows.",
    detail: "Record correct closed-note answers as well as mistakes. Your confidence needs evidence of what is working, not only a list of gaps.",
  },
};

type RecommendationLevels = Record<StudyProfileClassification, StudyProfileRecommendation>;

export const STUDY_PROFILE_RECOMMENDATIONS: Record<StudyProfileDimension, RecommendationLevels> = {
  starting_friction: recommendationLevels("starting", "Starting", {
    low: ["Begin with a clear goal and keep setup short.", "Start with the question or task that will show you the most."],
    moderate: ["Name the exact first action before the session.", "Use a 10-minute first commitment when the task feels uncomfortable."],
    high: ["Shrink the first required action until it is difficult to postpone.", "Start with active work immediately and let continuation be optional after the first block."],
  }, "Reduce the distance between deciding and doing."),
  structure_need: recommendationLevels("structure", "Structure", {
    low: ["Use a broad outcome and choose the path as you work.", "Add steps only when you actually get stuck."],
    moderate: ["Set the first move and one checkpoint.", "Leave room to adjust the middle of the session."],
    high: ["Write a short ordered sequence before starting.", "Keep only the current and next step visible."],
  }, "Match the amount of guidance to the amount of choice that helps."),
  attention_variability: recommendationLevels("focus", "Focus", {
    low: ["Protect an uninterrupted block around one goal.", "Stay with the topic while your attention is holding."],
    moderate: ["Make progress visible at short checkpoints.", "Change the activity on purpose while keeping the same goal."],
    high: ["Use short active rounds with fast feedback.", "Plan variation in advance so it does not become random switching."],
  }, "Make engagement visible and purposeful."),
  calibration_risk: recommendationLevels("checking_what_you_know", "Checking what you know", {
    low: ["Keep occasional closed-note checks in the routine.", "Use your score, not how familiar the material feels, to decide whether to move on."],
    moderate: ["Predict how you will do, then test without notes.", "Compare confidence with the result before choosing more review."],
    high: ["Retrieve or apply before rereading again.", "Commit to an answer and check it against a reliable answer or rubric."],
  }, "Use your results to decide what to review."),
  mistake_sensitivity: recommendationLevels("handling_mistakes", "Handling mistakes", {
    low: ["Keep attempting early, then pause to diagnose why an error happened.", "Turn each important miss into one targeted correction."],
    moderate: ["Time-box the first attempt before checking.", "Separate rough work from the final version."],
    high: ["Use frequent, private, low-stakes attempts.", "Label the first pass as information gathering and revise after feedback."],
  }, "Make errors useful without making them feel final."),
  cognitive_stamina: recommendationLevels("session_length_energy", "Session length / energy", {
    low: ["Use longer blocks when the task benefits from continuity.", "Take a break when quality drops, not only when a timer says to."],
    moderate: ["Place a quality checkpoint around the middle of the session.", "Reset briefly when accuracy or pace begins to soften."],
    high: ["Use shorter demanding rounds with planned resets.", "Put the hardest work in your stronger energy window when possible."],
  }, "Protect the quality of effort across the session."),
};

export const STUDY_PROFILE_CALIBRATION_RECOMMENDATIONS: Record<
  StudyProfileCalibrationDirection,
  StudyProfileRecommendation
> = {
  relatively_calibrated: STUDY_PROFILE_RECOMMENDATIONS.calibration_risk.low,
  mixed: STUDY_PROFILE_RECOMMENDATIONS.calibration_risk.moderate,
  overconfidence_risk: {
    category: "checking_what_you_know",
    heading: "Checking what you know",
    summary: "Find gaps before familiar material convinces you to move on.",
    actions: ["Predict, then retrieve without notes.", "Review only after you have produced an answer you can check."],
    researchTags: ["metacognition", "retrieval-practice"],
  },
  underconfidence_risk: {
    category: "checking_what_you_know",
    heading: "Checking what you know",
    summary: "Let correct answers raise your confidence when you have earned it.",
    actions: ["Record successful closed-note answers.", "Compare your prediction with the result instead of trusting doubt alone."],
    researchTags: ["metacognition", "self-efficacy"],
  },
};

type WarningRule = StudyProfileWarning & {
  priority: number;
  matches: (profile: StudyProfileSnapshot, metadata?: Partial<StudyProfileMetadata>) => boolean;
};

export const STUDY_PROFILE_WARNING_RULES: readonly WarningRule[] = [
  warning("vague_goals", "Vague study goals", "An instruction like “work on biology” leaves too many decisions inside the session.", 100, (p) => high(p, "structure_need")),
  warning("giant_first_commitments", "Giant first commitments", "Planning around a full session before you start can make beginning feel harder than it needs to.", 95, (p) => high(p, "starting_friction")),
  warning("checking_before_attempting", "Checking before attempting", "Hints and notes can remove the uncertainty that would have shown you what you actually know.", 90, (p) => high(p, "mistake_sensitivity")),
  warning("passive_rereading", "Passive rereading", "Material can feel familiar even when you cannot explain or use it without notes.", 85, (p) => p.calibrationDirection === "overconfidence_risk" || high(p, "calibration_risk")),
  warning("confidence_as_score", "Treating doubt as a score", "Feeling uncertain is not the same as performing poorly; use a real attempt as evidence.", 84, (p) => p.calibrationDirection === "underconfidence_risk"),
  warning("random_switching", "Random task switching", "Unplanned changes may feel refreshing while repeatedly resetting the work.", 80, (p) => high(p, "attention_variability")),
  warning("long_passive_sessions", "Long passive sessions", "More time in the same format may add fatigue faster than useful learning.", 75, (p) => high(p, "cognitive_stamina")),
  warning("weak_energy_window", "Hard work at the wrong time", "If your focus changes by time of day, putting the hardest task wherever it happens to fit may make the work less accurate.", 70, (p, m) => p.classifications.cognitive_stamina !== "low" && m?.energyWindow != null && m.energyWindow !== "varies"),
  warning("forced_structure", "Too much structure", "A detailed step-by-step plan can waste time when you already choose tasks and begin reliably.", 65, (p) => low(p, "structure_need")),
  warning("unnecessary_setup", "Too much warmup", "When starting is already easy, a long warmup can delay the practice that tells you what you know.", 60, (p) => low(p, "starting_friction")),
  warning("invisible_progress", "Progress you cannot see", "A long block without checkpoints may make engagement harder to maintain.", 50, (p) => p.classifications.attention_variability === "moderate"),
  warning("endless_polishing", "Polishing before feedback", "Improving an untested first pass can consume time without revealing whether the core answer works.", 45, (p) => p.classifications.mistake_sensitivity === "moderate"),
  warning("fixed_session_length", "A fixed session length at any cost", "Continuing after the quality of your work has dropped can make time studied a misleading target.", 40, (p) => p.classifications.cognitive_stamina === "moderate"),
  warning("review_without_retrieval", "Review without a check", "Even when confidence feels reliable, occasionally answer without notes so you can confirm what you know.", 10, () => true),
  warning("complex_study_system", "A system that takes too much upkeep", "Planning should make studying easier, not become a second assignment.", 9, () => true),
];

export function selectStudyProfileWarnings(
  profile: StudyProfileSnapshot,
  metadata?: Partial<StudyProfileMetadata>,
  limit = 3,
) {
  return STUDY_PROFILE_WARNING_RULES
    .filter((rule) => rule.matches(profile, metadata))
    .sort((left, right) => right.priority - left.priority)
    .slice(0, Math.max(0, limit))
    .map((rule) => ({
      id: rule.id,
      title: rule.title,
      detail: rule.detail,
    }));
}

export const STUDY_PROFILE_PRODUCT_ADAPTATIONS: Record<
  StudyProfileDimension,
  Record<StudyProfileClassification, StudyProfileProductAdaptation>
> = {
  starting_friction: adaptations("starting", {
    low: ["A direct start", "YOVA could skip unnecessary warmups and move you into useful work quickly."],
    moderate: ["A concrete opening", "YOVA could define the first action while leaving the rest of the session flexible."],
    high: ["A smaller first action", "YOVA could lower the required opening commitment and expand only after momentum appears."],
  }),
  structure_need: adaptations("structure", {
    low: ["More choice", "YOVA could offer a broad goal with fewer forced steps."],
    moderate: ["Selective structure", "YOVA could set the first move and checkpoints without prescribing every choice."],
    high: ["Fewer decisions", "YOVA could choose a short sequence in advance and reveal one step at a time."],
  }),
  attention_variability: adaptations("attention", {
    low: ["Longer uninterrupted work", "YOVA could preserve depth without inserting changes you do not need."],
    moderate: ["Visible progress", "YOVA could add clear checkpoints and occasional changes in activity."],
    high: ["Planned changes", "YOVA could switch between active methods in short rounds while keeping the same goal."],
  }),
  calibration_risk: adaptations("calibration", {
    low: ["Lightweight verification", "YOVA could use occasional retrieval checks to keep confidence anchored."],
    moderate: ["Confidence comparison", "YOVA could ask for a prediction, test it, and compare the two over time."],
    high: ["Earlier recall", "YOVA could ask you to answer without notes before familiarity guides more review."],
  }),
  mistake_sensitivity: adaptations("mistakes", {
    low: ["Earlier practice questions", "YOVA could let you attempt early, then slow down around the errors that matter."],
    moderate: ["Timed first attempts", "YOVA could prevent polishing or checking from expanding before feedback."],
    high: ["Lower-stakes feedback", "YOVA could make early attempts private, revisable, and useful for learning."],
  }),
  cognitive_stamina: adaptations("stamina", {
    low: ["Continuity when useful", "YOVA could use longer blocks when your performance remains steady."],
    moderate: ["Quality checkpoints", "YOVA could watch for fading performance and offer a reset at the useful moment."],
    high: ["Shorter required sessions", "YOVA could plan demanding work in shorter rounds and stronger energy windows."],
  }),
};

export const STUDY_PROFILE_CALIBRATION_PRODUCT_ADAPTATIONS: Record<
  StudyProfileCalibrationDirection,
  StudyProfileProductAdaptation
> = {
  relatively_calibrated: {
    id: "calibration_relatively_calibrated",
    title: "Lightweight verification",
    detail: "YOVA could use occasional retrieval checks to keep confidence anchored without interrupting every session.",
  },
  mixed: {
    id: "calibration_mixed",
    title: "Confidence comparison",
    detail: "YOVA could ask for a prediction, test it, and compare the two over time.",
  },
  overconfidence_risk: {
    id: "calibration_overconfidence",
    title: "Earlier closed-note retrieval",
    detail: "YOVA could expose gaps before familiarity is allowed to guide more review.",
  },
  underconfidence_risk: {
    id: "calibration_underconfidence",
    title: "Evidence-backed confidence",
    detail: "YOVA could preserve successful retrieval evidence and use it to challenge doubt that performance does not support.",
  },
};

export const STUDY_PROFILE_PROTOCOLS_BY_INTERACTION = {
  friction_structure: ["Choose one topic.", "Write the exact first question or task.", "Set a required first block of 10 minutes.", "Choose the next two steps before the timer starts.", "Continue only if momentum is there."],
  friction_mistakes: ["Choose one low-stakes practice item.", "Give yourself two minutes to make an imperfect attempt without notes.", "Commit to the answer.", "Check it, name one correction, and try once more."],
  friction_attention: ["Remove the setup before the session begins.", "Start with one active question for eight minutes.", "Mark each completed item visibly.", "Take a short reset, then choose whether to run another round."],
  structure_attention: ["Choose one goal.", "Plan three short activities that all serve it.", "Put them in order before starting.", "Switch only at the planned checkpoint."],
  mistakes_overconfidence: ["Predict whether you can answer three questions without notes.", "Commit to all three answers.", "Check them immediately.", "Review only the gaps the results revealed."],
  mistakes_underconfidence: ["Predict your result on three low-stakes questions.", "Answer without notes.", "Record each successful retrieval as well as each miss.", "Update the next prediction from that evidence."],
  overconfidence_low_friction: ["Skip the warmup and choose the question that will show you the most.", "Answer it without notes.", "Use the result to choose what needs review.", "Retest the gap before moving on."],
  stamina_attention: ["Choose one demanding task.", "Run a 12-minute active round.", "Take a three-minute reset away from the material.", "Use one different method, then stop if quality drops."],
  structure_stamina: ["Break the session into two or three visible chunks.", "Show only the current chunk.", "Pause briefly at each checkpoint.", "Shorten the remaining plan if accuracy or pace has fallen."],
  autonomy_low_friction_structure: ["Set one meaningful outcome for the session.", "Choose the most useful route yourself.", "Check progress once halfway through.", "Add steps only if the work is not moving."],
} as const;

export const STUDY_PROFILE_FALLBACK_PROTOCOLS: Record<StudyProfileDimension, readonly string[]> = {
  starting_friction: ["Choose one topic.", "Define a first action that takes no more than 10 minutes.", "Start immediately and decide about continuing after the block."],
  structure_need: ["Choose one outcome.", "Write the first three actions in order.", "Keep the current step visible and revise the sequence only at a checkpoint."],
  attention_variability: ["Choose one goal.", "Use a short timed practice block with visible progress.", "At each checkpoint, switch the activity while keeping the same goal."],
  calibration_risk: ["Predict how you will perform.", "Answer closed-note.", "Compare confidence with the result and review only the gaps."],
  mistake_sensitivity: ["Choose one low-stakes item.", "Make a time-boxed first attempt.", "Use feedback to revise rather than waiting to feel certain."],
  cognitive_stamina: ["Place one demanding task in your stronger window.", "Work in a short timed practice block.", "Stop or take a break when the quality of your work drops, even if you still feel motivated."],
};

export const STUDY_PROFILE_FIRST_IMPRESSION_CONTENT = {
  heading: "Your results can get more accurate over time",
  body: "This report starts with your answers. Once you use YOVA, your completed sessions can show which times, block lengths, and methods actually help you most.",
  examplesLabel: "Things YOVA can compare over time:",
  examples: [
    "You complete 20-minute sessions more consistently than 40-minute sessions.",
    "You miss evening sessions more often than afternoon sessions.",
    "Your confidence in biology is often higher than your closed-note retrieval performance.",
    "You start more reliably when the first required task is small and concrete.",
  ],
  closing: "The goal is simple: keep what works and change what does not.",
} as const;

export const STUDY_PROFILE_METHODOLOGY = {
  heading: "About your Study Profile",
  body: "Your report uses fixed scoring rules and your own answers to choose practical suggestions informed by learning research. It is not a medical, neurological, psychological, or learning-disability diagnosis.",
  researchAreas: [
    "remembering and retrieval practice",
    "planning and study habits",
    "confidence and self-checking",
    "attention and getting started",
  ],
} as const;

export const STUDY_PROFILE_WAITLIST_CONTENT = {
  eyebrow: "YOVA waitlist",
  heading: "Join the YOVA waitlist",
  body: "Get an email when YOVA is ready to try. Unsubscribe at any time.",
  helper: "We’ll use the email connected to this report.",
  buttonLabel: "Join the waitlist",
  success: "You’re on the waitlist. We’ll email you when YOVA is ready.",
} as const;

function recommendationLevels(
  category: StudyProfileRecommendation["category"],
  heading: string,
  actions: Record<StudyProfileClassification, readonly string[]>,
  summary: string,
): RecommendationLevels {
  return Object.fromEntries((["low", "moderate", "high"] as const).map((level) => [level, {
    category,
    heading,
    summary,
    actions: actions[level],
    researchTags: researchTagsFor(category),
  }])) as RecommendationLevels;
}

function researchTagsFor(category: StudyProfileRecommendation["category"]) {
  const tags: Record<StudyProfileRecommendation["category"], readonly string[]> = {
    starting: ["avoidance", "behavioral-activation"],
    structure: ["self-regulation", "executive-load"],
    focus: ["attention", "task-engagement"],
    checking_what_you_know: ["metacognition", "retrieval-practice"],
    handling_mistakes: ["feedback", "error-correction"],
    session_length_energy: ["cognitive-fatigue", "study-behavior"],
  };
  return tags[category];
}

function warning(
  id: string,
  title: string,
  detail: string,
  priority: number,
  matches: WarningRule["matches"],
): WarningRule {
  return { id, title, detail, priority, matches };
}

function adaptations(
  idPrefix: string,
  entries: Record<StudyProfileClassification, readonly [string, string]>,
) {
  return Object.fromEntries((["low", "moderate", "high"] as const).map((level) => [level, {
    id: `${idPrefix}_${level}`,
    title: entries[level][0],
    detail: entries[level][1],
  }])) as Record<StudyProfileClassification, StudyProfileProductAdaptation>;
}

function high(profile: StudyProfileSnapshot, dimension: StudyProfileDimension) {
  return profile.classifications[dimension] === "high";
}

function low(profile: StudyProfileSnapshot, dimension: StudyProfileDimension) {
  return profile.classifications[dimension] === "low";
}
