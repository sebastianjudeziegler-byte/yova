import { FUNCTIONAL_SUPPORT_OPTIONS } from "@/lib/sample-data";

/**
 * Baseline onboarding: ten questions, ordered easy → hard, keyed by a stable
 * question ID. Routing (`@/lib/routing/session-route`) reads option IDs from
 * this list and never labels. See docs/redesign/03-ONBOARDING.md.
 *
 * The legacy positional list in `@/lib/sample-data` is retained only as the
 * compatibility projection for readers and database columns that still
 * address answers by position. Nothing new may read by position.
 */
export const ONBOARDING_QUESTION_IDS = [
  "energy_window",
  "session_length",
  "focus_loss",
  "guidance",
  "difficulty_help",
  "prove_knowing",
  "gist_detail",
  "starting_pattern",
  "support_needs",
  "extra_context",
] as const;

export type OnboardingQuestionId = (typeof ONBOARDING_QUESTION_IDS)[number];

export type OnboardingOption = Readonly<{ id: string; label: string }>;

export type OnboardingQuestion = Readonly<{
  id: OnboardingQuestionId;
  /** 1-based display number in the reordered baseline flow. */
  number: number;
  prompt: string;
  options: readonly OnboardingOption[];
  optional?: boolean;
  multi?: boolean;
  /** What the answer changes. Shown nowhere; kept beside the question so the routing claim is auditable. */
  routesTo: string;
}>;

export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = [
  {
    id: "energy_window",
    number: 1,
    prompt: "When do you usually have the most usable energy?",
    options: [
      { id: "morning", label: "Morning" },
      { id: "afternoon", label: "Afternoon" },
      { id: "evening", label: "Evening" },
      { id: "late_night", label: "Late night" },
      { id: "varies", label: "It changes" },
    ],
    routesTo: "Layer 4: learn blocks proposed in the peak window, practice off-peak.",
  },
  {
    id: "session_length",
    number: 2,
    prompt: "What study-session length usually feels realistic?",
    options: [
      { id: "minutes_10_15", label: "10 to 15 minutes" },
      { id: "minutes_20_30", label: "20 to 30 minutes" },
      { id: "minutes_30_45", label: "30 to 45 minutes" },
      { id: "minutes_45_60", label: "45 to 60 minutes" },
      { id: "task_dependent", label: "It depends" },
    ],
    routesTo: "Layer 4: base timer; question cap for the shortest band.",
  },
  {
    id: "focus_loss",
    number: 3,
    prompt: "How often do you lose focus while studying?",
    options: [
      { id: "rarely", label: "Rarely" },
      { id: "sometimes", label: "Sometimes" },
      { id: "often", label: "Often" },
      { id: "very_often", label: "Very often" },
    ],
    routesTo: "Layer 4: timer one band down and more stopping points when often or very often.",
  },
  {
    id: "guidance",
    number: 4,
    prompt: "How much guidance do you want from YOVA?",
    options: [
      { id: "exact_guidance", label: "Tell me exactly what to do" },
      { id: "structured_flexibility", label: "Give me clear structure with flexibility" },
      { id: "learner_choice", label: "Recommend options and let me decide" },
    ],
    routesTo: "Layer 5: whether the method choice is silent, visible, or offered.",
  },
  {
    id: "difficulty_help",
    number: 5,
    prompt: "When a topic is difficult, what usually helps most?",
    options: [
      { id: "simple_explanation", label: "A simple explanation first" },
      { id: "concrete_example", label: "A concrete example first" },
      { id: "step_by_step", label: "Step-by-step instructions" },
      { id: "try_then_feedback", label: "Trying it and getting feedback" },
      { id: "mixed", label: "A mixture" },
    ],
    routesTo: "Layer 3: scaffolding entry point, moved by one level at most.",
  },
  {
    id: "prove_knowing",
    number: 6,
    prompt: "When you want to prove to yourself that you actually know something, what works best?",
    options: [
      { id: "explain_back", label: "Explaining it out loud or in writing" },
      { id: "map_it", label: "Mapping out how the pieces connect" },
      { id: "answer_questions", label: "Answering questions on it" },
      { id: "solve_it", label: "Working through a problem" },
    ],
    routesTo: "Layer 3: the Shape A produce step.",
  },
  {
    id: "gist_detail",
    number: 7,
    prompt: "When you're studying, which is more likely?",
    options: [
      { id: "gist_leaning", label: "I get the big picture but miss specifics" },
      { id: "detail_leaning", label: "I know the details but lose how they fit together" },
      { id: "balanced", label: "Depends on the subject" },
    ],
    routesTo: "Layer 4: practice question weighting.",
  },
  {
    id: "starting_pattern",
    number: 8,
    prompt: "Which starting pattern sounds most like you?",
    options: [
      { id: "on_time", label: "I usually begin when I plan to" },
      { id: "often_delay", label: "I intend to begin but often delay" },
      { id: "deadline_pressure", label: "I start when the deadline feels close" },
      { id: "planning_avoidance", label: "I avoid planning because it feels larger" },
      { id: "varies", label: "It varies" },
    ],
    routesTo: "Nothing in v1. Retained as signal for stage-aware behaviour in v2.",
  },
  {
    id: "support_needs",
    number: 9,
    prompt: "Would any of these make YOVA easier for you to use?",
    options: [...FUNCTIONAL_SUPPORT_OPTIONS],
    optional: true,
    multi: true,
    routesTo: "Layer 4: delivery modifiers (timer, question cap, produce step, instruction style, stopping points).",
  },
  {
    id: "extra_context",
    number: 10,
    prompt: "Is there anything else YOVA should know?",
    options: [
      { id: "forget_during_tests", label: "I understand in class but forget during tests" },
      { id: "long_plan_shutdown", label: "Long plans make me shut down" },
      { id: "examples_before_ready", label: "I need examples before I feel ready" },
      { id: "nothing_else", label: "Nothing else for now" },
    ],
    optional: true,
    routesTo: "Layer 4: practice rounds, queue visibility, example-first.",
  },
];

export function onboardingQuestion(id: OnboardingQuestionId): OnboardingQuestion {
  const question = ONBOARDING_QUESTIONS.find((candidate) => candidate.id === id);
  if (!question) throw new Error(`Unknown onboarding question: ${id}`);
  return question;
}

export function isOnboardingQuestionId(value: unknown): value is OnboardingQuestionId {
  return typeof value === "string" && (ONBOARDING_QUESTION_IDS as readonly string[]).includes(value);
}

export function isOnboardingOptionId(id: OnboardingQuestionId, value: unknown): value is string {
  return typeof value === "string" && onboardingQuestion(id).options.some((option) => option.id === value);
}

export function onboardingOptionLabel(id: OnboardingQuestionId, optionId: string | null | undefined) {
  if (!optionId) return null;
  return onboardingQuestion(id).options.find((option) => option.id === optionId)?.label ?? null;
}
