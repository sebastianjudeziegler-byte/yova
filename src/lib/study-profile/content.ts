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
        label: "Low",
        summary: "Your answers suggest that intention usually becomes action without much extra support.",
        detail: "You may be able to begin from a broad objective and work out the path as you go. A study system should preserve that momentum instead of adding rituals or checkpoints you do not need.",
      },
      moderate: {
        label: "Moderate",
        summary: "You can usually begin, but discomfort or a vague first step may slow the transition into real work.",
        detail: "A clear opening move and a modest first commitment may be enough. The goal is to reduce the negotiation before starting without over-structuring the rest of the session.",
      },
      high: {
        label: "High",
        summary: "Your answers suggest that turning a plan into the first real action is a meaningful point of friction right now.",
        detail: "Pressure may sometimes do the work that a good starting system should do. Small, concrete opening actions can lower the cost of beginning and let momentum develop before a larger commitment is required.",
      },
    },
  },
  structure_need: {
    name: STUDY_PROFILE_DIMENSION_NAMES.structure_need,
    levels: {
      low: {
        label: "Flexible",
        summary: "You appear comfortable choosing a path from a broad objective.",
        detail: "Heavy sequencing may feel restrictive or create needless setup. Your system can give you autonomy, then add a checkpoint only when progress or performance shows that more guidance would help.",
      },
      moderate: {
        label: "Balanced",
        summary: "A clear direction helps, while every individual step does not need to be prescribed.",
        detail: "You may benefit from knowing the goal, the first move, and one or two checkpoints. Between those points, enough flexibility should remain to respond to what you discover.",
      },
      high: {
        label: "High-structure",
        summary: "Ambiguity and too many choices appear likely to consume energy before useful studying begins.",
        detail: "A short ordered sequence can move planning out of the session itself. The best structure is visible and specific, while still being short enough that the plan does not become another task to manage.",
      },
    },
  },
  attention_variability: {
    name: STUDY_PROFILE_DIMENSION_NAMES.attention_variability,
    levels: {
      low: {
        label: "Steady",
        summary: "Your attention appears relatively steady once you are engaged with the work.",
        detail: "You may not need frequent novelty or interruptions to continue. Longer coherent blocks can work, especially when they remain active and have a clear purpose.",
      },
      moderate: {
        label: "Variable",
        summary: "Your engagement may fade gradually, with visible progress helping you stay connected to the work.",
        detail: "A session can keep one objective while changing the kind of activity at sensible checkpoints. The aim is purposeful variation, not switching whenever attention dips.",
      },
      high: {
        label: "Highly variable",
        summary: "Your answers suggest that drift, boredom, or switching can appear quickly during longer or repetitive work.",
        detail: "Short active rounds, clear feedback, and planned changes of activity may protect engagement. Each change should still advance the same objective so variation does not become fragmentation.",
      },
    },
  },
  calibration_risk: {
    name: STUDY_PROFILE_DIMENSION_NAMES.calibration_risk,
    levels: {
      low: {
        label: "Relatively calibrated",
        summary: "Your current confidence appears to correspond reasonably well with what you can retrieve or apply.",
        detail: "That is still a self-reported signal, not a measurement of accuracy. Occasional closed-note checks can preserve the connection between familiarity, confidence, and demonstrated performance.",
      },
      moderate: {
        label: "Mixed",
        summary: "Your sense of knowing may be useful but does not appear fully dependable across situations.",
        detail: "Brief predictions followed by closed-note retrieval can show when confidence is informative and when familiarity is doing too much of the work.",
      },
      high: {
        label: "Needs more checking",
        summary: "Your answers suggest a meaningful gap may sometimes exist between the feeling of knowing and demonstrated performance.",
        detail: "This does not establish your actual metacognitive accuracy. It does make earlier, objective checks especially useful so review decisions follow evidence rather than familiarity alone.",
      },
    },
  },
  mistake_sensitivity: {
    name: STUDY_PROFILE_DIMENSION_NAMES.mistake_sensitivity,
    levels: {
      low: {
        label: "Low",
        summary: "You seem relatively willing to make an attempt before knowing that it is correct.",
        detail: "That willingness can make feedback arrive sooner. Your system should protect it while still creating a moment to inspect errors carefully rather than moving past them too quickly.",
      },
      moderate: {
        label: "Moderate",
        summary: "You generally balance making progress with wanting an answer or piece of work to be right.",
        detail: "When uncertainty rises, a time limit for the first attempt can keep checking or polishing from expanding. Feedback can then improve a real attempt instead of delaying one.",
      },
      high: {
        label: "High",
        summary: "Uncertainty, visible mistakes, or an imperfect first pass may change how readily you act.",
        detail: "Low-stakes attempts and explicit permission to revise can separate learning from evaluation. The purpose of an early answer is to produce information, not to prove that you already know it.",
      },
    },
  },
  cognitive_stamina: {
    name: STUDY_PROFILE_DIMENSION_NAMES.cognitive_stamina,
    levels: {
      low: {
        label: "Stable",
        summary: "Your usable focus appears fairly stable across a demanding study block.",
        detail: "You may be able to use longer coherent sessions when the work warrants them. Breaks should still follow performance and fatigue rather than a need to endure for its own sake.",
      },
      moderate: {
        label: "Moderate decline",
        summary: "Your performance may soften after a while, even when you can continue working.",
        detail: "Planned checkpoints can catch the point where added minutes stop producing the same quality. A brief reset or activity change may restore useful effort.",
      },
      high: {
        label: "Fast decline",
        summary: "Long demanding sessions appear likely to lose accuracy or focus relatively quickly.",
        detail: "Shorter rounds and stronger timing choices may outperform attempts to force endurance. Ending or resetting before quality collapses protects both learning and confidence.",
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
    label: "Overconfidence risk",
    summary: "Familiar material may sometimes feel more available than it proves to be without notes.",
    detail: "Your answers suggest that earlier closed-note retrieval could reveal gaps before they become surprises. This is an initial self-report signal, not a validated measure of your calibration.",
  },
  underconfidence_risk: {
    label: "Underconfidence risk",
    summary: "Your confidence may sometimes run below what your later performance supports.",
    detail: "Recording successful retrieval can give confidence better evidence to update from. This is an initial self-report signal, not a validated measure of your calibration.",
  },
};

type RecommendationLevels = Record<StudyProfileClassification, StudyProfileRecommendation>;

export const STUDY_PROFILE_RECOMMENDATIONS: Record<StudyProfileDimension, RecommendationLevels> = {
  starting_friction: recommendationLevels("starting", "Starting", {
    low: ["Begin from a clear objective without adding a long setup ritual.", "Use your willingness to start on the most diagnostic task first."],
    moderate: ["Name the exact first action before the session.", "Use a 10-minute first commitment when the task feels uncomfortable."],
    high: ["Shrink the first required action until it is difficult to postpone.", "Start with active work immediately and let continuation be optional after the first block."],
  }, "Reduce the distance between deciding and doing."),
  structure_need: recommendationLevels("structure", "Structure", {
    low: ["Use a broad outcome and choose the path as you work.", "Add steps only when you actually get stuck."],
    moderate: ["Set the first move and one checkpoint.", "Leave room to adjust the middle of the session."],
    high: ["Write a short ordered sequence before starting.", "Keep only the current and next step visible."],
  }, "Match the amount of guidance to the amount of choice that helps."),
  attention_variability: recommendationLevels("focus", "Focus", {
    low: ["Protect a coherent block around one objective.", "Prefer depth over novelty when attention is holding."],
    moderate: ["Make progress visible at short checkpoints.", "Change activity deliberately while keeping the same objective."],
    high: ["Use short active rounds with fast feedback.", "Plan variation in advance so it does not become random switching."],
  }, "Make engagement visible and purposeful."),
  calibration_risk: recommendationLevels("checking_what_you_know", "Checking what you know", {
    low: ["Keep occasional closed-note checks in the routine.", "Use the result—not the feeling of fluency—to decide whether to move on."],
    moderate: ["Predict how you will do, then test without notes.", "Compare confidence with the result before choosing more review."],
    high: ["Retrieve or apply before rereading again.", "Commit to an answer and score it against objective feedback."],
  }, "Use performance evidence to guide review."),
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
    summary: "Expose gaps before familiarity turns into a study decision.",
    actions: ["Predict, then retrieve without notes.", "Review only after you have produced an answer you can check."],
    researchTags: ["metacognition", "retrieval-practice"],
  },
  underconfidence_risk: {
    category: "checking_what_you_know",
    heading: "Checking what you know",
    summary: "Use demonstrated performance to recalibrate confidence upward when it earns it.",
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
  warning("giant_first_commitments", "Giant first commitments", "Requiring a full session before you have begun can make the starting threshold unnecessarily expensive.", 95, (p) => high(p, "starting_friction")),
  warning("checking_before_attempting", "Checking before attempting", "Hints and notes can remove the uncertainty that would have shown you what you actually know.", 90, (p) => high(p, "mistake_sensitivity")),
  warning("passive_rereading", "Passive rereading", "Familiarity can rise while closed-note access remains weak.", 85, (p) => p.calibrationDirection === "overconfidence_risk" || high(p, "calibration_risk")),
  warning("confidence_as_score", "Treating doubt as a score", "Feeling uncertain is not the same as performing poorly; use a real attempt as evidence.", 84, (p) => p.calibrationDirection === "underconfidence_risk"),
  warning("random_switching", "Random task switching", "Unplanned changes may feel refreshing while repeatedly resetting the work.", 80, (p) => high(p, "attention_variability")),
  warning("long_passive_sessions", "Long passive sessions", "More time in the same format may add fatigue faster than useful learning.", 75, (p) => high(p, "cognitive_stamina")),
  warning("weak_energy_window", "Demanding work in a weaker window", "If timing changes your usable attention, scheduling the hardest task by convenience alone can be costly.", 70, (p, m) => p.classifications.cognitive_stamina !== "low" && m?.energyWindow != null && m.energyWindow !== "varies"),
  warning("forced_structure", "Too much forced structure", "A detailed prescribed path can add overhead when you already choose and begin reliably.", 65, (p) => low(p, "structure_need")),
  warning("unnecessary_setup", "Unnecessary motivational setup", "When starting is already reliable, elaborate warmups can delay the diagnostic work that matters.", 60, (p) => low(p, "starting_friction")),
  warning("invisible_progress", "Progress you cannot see", "A long block without checkpoints may make engagement harder to maintain.", 50, (p) => p.classifications.attention_variability === "moderate"),
  warning("endless_polishing", "Polishing before feedback", "Improving an untested first pass can consume time without revealing whether the core answer works.", 45, (p) => p.classifications.mistake_sensitivity === "moderate"),
  warning("fixed_session_length", "A fixed session length at any cost", "Continuing after the quality of your work has dropped can make time studied a misleading target.", 40, (p) => p.classifications.cognitive_stamina === "moderate"),
  warning("review_without_retrieval", "Review without a check", "Even when confidence feels dependable, occasional closed-note evidence keeps it anchored.", 10, () => true),
  warning("complex_study_system", "A system that takes too much upkeep", "Planning should reduce study friction, not become a second assignment.", 9, () => true),
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
    low: ["More autonomy", "YOVA could offer a broad objective with fewer forced steps."],
    moderate: ["Selective structure", "YOVA could set the first move and checkpoints without prescribing every choice."],
    high: ["Fewer decisions", "YOVA could pre-sequence short steps and reveal the next one at the right time."],
  }),
  attention_variability: adaptations("attention", {
    low: ["Longer coherent work", "YOVA could preserve depth without inserting changes you do not need."],
    moderate: ["Visible progress", "YOVA could add purposeful checkpoints and occasional changes in activity."],
    high: ["Controlled variation", "YOVA could alternate active formats in short rounds while holding the objective steady."],
  }),
  calibration_risk: adaptations("calibration", {
    low: ["Lightweight verification", "YOVA could use occasional retrieval checks to keep confidence anchored."],
    moderate: ["Confidence comparison", "YOVA could ask for a prediction, test it, and compare the two over time."],
    high: ["Earlier retrieval", "YOVA could test closed-note access before allowing familiarity to guide more review."],
  }),
  mistake_sensitivity: adaptations("mistakes", {
    low: ["More diagnostic challenge", "YOVA could let you attempt early, then slow down around the errors that matter."],
    moderate: ["Timed first attempts", "YOVA could prevent polishing or checking from expanding before feedback."],
    high: ["Lower-stakes feedback", "YOVA could make early attempts private, revisable, and explicitly diagnostic."],
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
  friction_structure: ["Choose one topic.", "Write the exact first question or task.", "Set a required first block of 10 minutes.", "Pre-decide the next two steps; do not choose them during the block.", "Continue only if momentum is there."],
  friction_mistakes: ["Choose one low-stakes practice item.", "Give yourself two minutes to make an imperfect attempt without notes.", "Commit to the answer.", "Check it, name one correction, and try once more."],
  friction_attention: ["Remove the setup before the session begins.", "Start with one active question for eight minutes.", "Mark each completed item visibly.", "Take a short reset, then choose whether to run another round."],
  structure_attention: ["Choose one objective.", "Plan three short activities that all serve it.", "Put them in order before starting.", "Switch only at the planned checkpoint."],
  mistakes_overconfidence: ["Predict whether you can answer three questions without notes.", "Commit to all three answers.", "Check them immediately.", "Review only the gaps the results revealed."],
  mistakes_underconfidence: ["Predict your result on three low-stakes questions.", "Answer without notes.", "Record each successful retrieval as well as each miss.", "Update the next prediction from that evidence."],
  overconfidence_low_friction: ["Skip the warmup and choose the most diagnostic question.", "Answer it closed-note.", "Use the result to choose what needs review.", "Retest the gap before moving on."],
  stamina_attention: ["Choose one demanding objective.", "Run a 12-minute active round.", "Take a three-minute reset away from the material.", "Run one different active format, then stop if quality drops."],
  structure_stamina: ["Break the session into two or three visible chunks.", "Show only the current chunk.", "Pause briefly at each checkpoint.", "Shorten the remaining plan if accuracy or pace has fallen."],
  autonomy_low_friction_structure: ["Set one meaningful outcome for the session.", "Choose the most useful route yourself.", "Check progress once halfway through.", "Add structure only if the objective is not moving."],
} as const;

export const STUDY_PROFILE_FALLBACK_PROTOCOLS: Record<StudyProfileDimension, readonly string[]> = {
  starting_friction: ["Choose one topic.", "Define a first action that takes no more than 10 minutes.", "Start immediately and decide about continuing after the block."],
  structure_need: ["Choose one outcome.", "Write the first three actions in order.", "Keep the current step visible and revise the sequence only at a checkpoint."],
  attention_variability: ["Choose one objective.", "Use a short active round with visible progress.", "Change the activity—not the objective—at the checkpoint."],
  calibration_risk: ["Predict how you will perform.", "Answer closed-note.", "Compare confidence with the result and review only the gaps."],
  mistake_sensitivity: ["Choose one low-stakes item.", "Make a time-boxed first attempt.", "Use feedback to revise rather than waiting to feel certain."],
  cognitive_stamina: ["Place one demanding task in your stronger window.", "Work in a bounded active round.", "Reset or stop when quality—not just motivation—drops."],
};

export const STUDY_PROFILE_FIRST_IMPRESSION_CONTENT = {
  heading: "This is only YOVA’s first impression",
  body: "This profile is based on what you told us. YOVA is being built to go further by learning from how you actually study.",
  examplesLabel: "Examples of what YOVA could eventually learn—not claims about you:",
  examples: [
    "You complete 20-minute sessions more consistently than 40-minute sessions.",
    "You miss evening sessions more often than afternoon sessions.",
    "Your confidence in biology is often higher than your closed-note retrieval performance.",
    "You start more reliably when the first required task is small and concrete.",
  ],
  closing: "The quiz can learn from what you tell us. YOVA will learn from what you actually do.",
} as const;

export const STUDY_PROFILE_METHODOLOGY = {
  heading: "About this initial profile",
  body: "YOVA Study Profile uses self-reported study behaviors to create an initial set of recommendations informed by research on learning, self-regulation, metacognition, attention, avoidance, and study behavior. Its routing thresholds are product rules, not psychometrically validated cutoffs. It is not a medical, neurological, or psychological diagnosis.",
  researchAreas: [
    "learning and retrieval practice",
    "self-regulation and study behavior",
    "metacognition and confidence calibration",
    "attention, avoidance, and task engagement",
  ],
} as const;

export const STUDY_PROFILE_EARLY_ACCESS_CONTENT = {
  heading: "Want YOVA to build around your profile automatically?",
  buttonLabel: "Get early access to YOVA",
  betaPrompt: "I’d also be interested in testing YOVA before launch.",
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
