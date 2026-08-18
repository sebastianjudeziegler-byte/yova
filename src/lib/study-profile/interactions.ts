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
    summary: "Starting becomes harder when the work also requires you to decide what to do first. Your system should remove that decision before the session begins.",
    actions: [
      "Make the first action tiny and concrete.",
      "Pre-decide the first short sequence.",
      "Show one visible step at a time until momentum develops.",
    ],
    matches: (profile) => isHigh(profile, "starting_friction") && isHigh(profile, "structure_need"),
  },
  {
    id: "friction_mistakes",
    priority: 90,
    dimensions: ["starting_friction", "mistake_sensitivity"],
    title: "The first attempt needs to feel safe enough to make",
    summary: "When starting friction and concern about mistakes rise together, preparing or checking can quietly replace doing. A deliberately imperfect first pass creates useful motion.",
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
    summary: "A long setup period gives both delay and distraction more room. The opening should move directly into short, active work with progress you can see.",
    actions: [
      "Keep setup friction extremely low.",
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
    summary: "You may benefit from changing the kind of work you do, but random switching creates more decisions. Plan the changes so variety supports the session instead of fragmenting it.",
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
    summary: "Checking too early can protect a feeling of familiarity without testing it. Low-stakes commitment followed by objective feedback makes gaps visible and keeps errors useful.",
    actions: [
      "Commit to an answer before checking notes or hints.",
      "Use immediate, objective feedback.",
      "Treat each error as a correction target, not a verdict.",
    ],
    matches: (profile) => isHigh(profile, "mistake_sensitivity")
      && profile.calibrationDirection === "overconfidence_risk",
  },
  {
    id: "mistakes_underconfidence",
    priority: 59,
    dimensions: ["mistake_sensitivity", "calibration_risk"],
    title: "Performance evidence should outrank the feeling of doubt",
    summary: "Frequent, low-stakes attempts can show what you actually know. Recording successful retrieval gives your confidence something concrete to update from.",
    actions: [
      "Use frequent attempts where mistakes have little cost.",
      "Keep visible evidence of successful performance.",
      "Recalibrate confidence from results, not only feelings.",
    ],
    matches: (profile) => isHigh(profile, "mistake_sensitivity")
      && profile.calibrationDirection === "underconfidence_risk",
  },
  {
    id: "overconfidence_low_friction",
    priority: 50,
    dimensions: ["calibration_risk", "starting_friction"],
    title: "Start quickly—and test sooner",
    summary: "Motivation support is unlikely to be the bottleneck. The higher-value move is to expose gaps early with closed-note retrieval rather than extending review.",
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
    summary: "When focus varies and performance drops during longer work, extending the same block can add time without adding much learning. Planned resets preserve useful effort.",
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
    summary: "A clear plan can help, but one long rigid checklist may become its own source of overload. Keep the sequence explicit while revealing it in manageable sections.",
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
    title: "Your system can leave more room for autonomy",
    summary: "Your answers do not suggest that starting or choosing a path needs heavy support. Too many forced steps may add friction rather than remove it.",
    actions: [
      "Use broad objectives instead of micromanaged steps.",
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
