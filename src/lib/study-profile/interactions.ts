import type {
  StudyProfileInteraction,
  StudyProfileSnapshot,
} from "@/lib/study-profile/types";

type StudyProfileInteractionRule = StudyProfileInteraction & {
  matches: (profile: StudyProfileSnapshot) => boolean;
};

export const STUDY_PROFILE_INTERACTION_RULES: readonly StudyProfileInteractionRule[] = [
  {
    id: "friction_structure",
    priority: 100,
    dimensions: ["starting_friction", "structure_need"],
    title: "Momentum depends on a clear first move",
    summary: "Starting is harder when you also have to decide what to do first. Choose that first move before the session begins.",
    actions: [
      "Make the first action tiny and concrete.",
      "Choose the first short sequence in advance.",
      "Show one visible step at a time until momentum develops.",
    ],
    matches: (profile) => isHigh(profile, "starting_friction") && isHigh(profile, "structure_need"),
  },
  {
    id: "friction_mistakes",
    priority: 90,
    dimensions: ["starting_friction", "mistake_sensitivity"],
    title: "The first attempt needs to feel safe enough to make",
    summary: "When starting and making mistakes both feel difficult, preparing or checking can replace real practice. A rough first pass gives you something useful to improve.",
    actions: [
      "Begin with a low-risk attempt, not more preparation.",
      "Explicitly allow an incomplete first pass.",
      "Get quick feedback after committing to an answer.",
    ],
    matches: (profile) => isHigh(profile, "starting_friction") && isHigh(profile, "mistake_sensitivity"),
  },
  {
    id: "friction_attention",
    priority: 80,
    dimensions: ["starting_friction", "attention_variability"],
    title: "Engagement needs to arrive quickly",
    summary: "A long setup gives delay and distraction more room. Move straight into short practice with progress you can see.",
    actions: [
      "Keep setup short and simple.",
      "Start with an active question or task immediately.",
      "Use a short first commitment with visible progress.",
    ],
    matches: (profile) => isHigh(profile, "starting_friction") && isHigh(profile, "attention_variability"),
  },
  {
    id: "structure_attention",
    priority: 70,
    dimensions: ["structure_need", "attention_variability"],
    title: "Variation works best inside a clear sequence",
    summary: "Changing the activity can help, but random switching creates more decisions. Plan each change so you keep working toward the same goal.",
    actions: [
      "Use a short, ordered sequence.",
      "Build in controlled changes of activity.",
      "Decide when to switch before the session begins.",
    ],
    matches: (profile) => isHigh(profile, "structure_need") && isHigh(profile, "attention_variability"),
  },
  {
    id: "mistakes_overconfidence",
    priority: 60,
    dimensions: ["mistake_sensitivity", "calibration_risk"],
    title: "Commit first, then use the error",
    summary: "Checking too early can make material feel familiar without testing what you know. Commit to a low-stakes answer, check it, and use the result to find the gap.",
    actions: [
      "Commit to an answer before checking notes or hints.",
      "Check the answer right away.",
      "Treat each error as a correction target, not a verdict.",
    ],
    matches: (profile) => isHigh(profile, "mistake_sensitivity")
      && profile.calibrationDirection === "overconfidence_risk",
  },
  {
    id: "mistakes_underconfidence",
    priority: 59,
    dimensions: ["mistake_sensitivity", "calibration_risk"],
    title: "Let correct answers challenge your doubt",
    summary: "Frequent, low-stakes attempts show what you actually know. Record correct answers so doubt does not erase evidence of progress.",
    actions: [
      "Use frequent attempts where mistakes have little cost.",
      "Keep a visible record of correct answers.",
      "Update your confidence from results, not only feelings.",
    ],
    matches: (profile) => isHigh(profile, "mistake_sensitivity")
      && profile.calibrationDirection === "underconfidence_risk",
  },
  {
    id: "overconfidence_low_friction",
    priority: 50,
    dimensions: ["calibration_risk", "starting_friction"],
    title: "Start quickly, then test yourself sooner",
    summary: "Starting does not look like the main problem. Spend less time on warmups and find gaps early by answering without notes.",
    actions: [
      "Skip unnecessary motivational setup.",
      "Use closed-note retrieval near the start.",
      "Let detected gaps choose what to review next.",
    ],
    matches: (profile) => profile.calibrationDirection === "overconfidence_risk"
      && isLow(profile, "starting_friction"),
  },
  {
    id: "stamina_attention",
    priority: 40,
    dimensions: ["cognitive_stamina", "attention_variability"],
    title: "Short active rounds are likely to outperform endurance",
    summary: "When focus and accuracy drop during long work, more minutes may not add much learning. Short blocks and planned breaks can protect the quality of the session.",
    actions: [
      "Use shorter rounds of active work.",
      "Reset between rounds before accuracy collapses.",
      "Reduce long passive blocks.",
    ],
    matches: (profile) => isHigh(profile, "cognitive_stamina") && isHigh(profile, "attention_variability"),
  },
  {
    id: "structure_stamina",
    priority: 30,
    dimensions: ["structure_need", "cognitive_stamina"],
    title: "Structure should come in visible chunks",
    summary: "A clear plan helps, but one long checklist can become overwhelming. Break it into small sections and show only what comes next.",
    actions: [
      "Break long sequences into visible chunks.",
      "Make the next checkpoint clear.",
      "Avoid turning the whole session into one long checklist.",
    ],
    matches: (profile) => isHigh(profile, "structure_need") && isHigh(profile, "cognitive_stamina"),
  },
  {
    id: "autonomy_low_friction_structure",
    priority: 20,
    dimensions: ["starting_friction", "structure_need"],
    title: "Leave yourself more room to choose",
    summary: "Starting and choosing a path do not look like major problems for you. Too many required steps may slow you down instead of helping.",
    actions: [
      "Use broad goals instead of a detailed checklist.",
      "Keep required setup light.",
      "Add structure only when performance shows it is useful.",
    ],
    matches: (profile) => isLow(profile, "starting_friction") && isLow(profile, "structure_need"),
  },
];

export function selectStudyProfileInteractions(profile: StudyProfileSnapshot) {
  return STUDY_PROFILE_INTERACTION_RULES
    .filter((rule) => rule.matches(profile))
    .sort((left, right) => right.priority - left.priority)
    .map((rule) => ({
      id: rule.id,
      priority: rule.priority,
      dimensions: rule.dimensions,
      title: rule.title,
      summary: rule.summary,
      actions: rule.actions,
    }));
}

function isHigh(profile: StudyProfileSnapshot, dimension: keyof StudyProfileSnapshot["classifications"]) {
  return profile.classifications[dimension] === "high";
}

function isLow(profile: StudyProfileSnapshot, dimension: keyof StudyProfileSnapshot["classifications"]) {
  return profile.classifications[dimension] === "low";
}
