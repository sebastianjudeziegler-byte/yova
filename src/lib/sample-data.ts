export type Question = {
  prompt: string;
  options: QuestionOption[];
  optional?: boolean;
  multi?: boolean;
};

export type QuestionOption = {
  id: string;
  label: string;
};

export const FUNCTIONAL_SUPPORT_OPTIONS = [
  { id: "shorter_sections", label: "Shorter sections with fewer steps at once" },
  { id: "reduced_text_visual_structure", label: "Less text and more visual structure" },
  { id: "extra_reading_time", label: "Extra time to read and respond" },
  { id: "simpler_repeated_instructions", label: "Instructions repeated in simpler language" },
  { id: "frequent_check_ins", label: "Frequent check-ins and clear stopping points" },
  { id: "no_extra_support", label: "No extra support right now" },
  { id: "task_dependent", label: "It depends on the task" },
] as const;

export const onboardingQuestions: Question[] = [
  {
    prompt: "What most often makes studying difficult?",
    options: [
      { id: "struggle_to_start", label: "I struggle to start" },
      { id: "unclear_first_step", label: "I do not know what to do first" },
      { id: "distracted", label: "I get distracted" },
      { id: "retention_gap", label: "I study but do not retain enough" },
      { id: "overwhelmed", label: "I feel overwhelmed" },
      { id: "perfectionism", label: "I try to make everything perfect" },
      { id: "task_dependent", label: "It depends on the task" },
    ],
  },
  {
    prompt: "How much guidance do you want from YOVA?",
    options: [
      { id: "exact_guidance", label: "Tell me exactly what to do" },
      { id: "structured_flexibility", label: "Give me clear structure with flexibility" },
      { id: "learner_choice", label: "Recommend options and let me decide" },
    ],
  },
  {
    prompt: "What study-session length usually feels realistic?",
    options: [
      { id: "minutes_10_15", label: "10 to 15 minutes" },
      { id: "minutes_20_30", label: "20 to 30 minutes" },
      { id: "minutes_30_45", label: "30 to 45 minutes" },
      { id: "minutes_45_60", label: "45 to 60 minutes" },
      { id: "task_dependent", label: "It depends" },
    ],
  },
  {
    prompt: "When a topic is difficult, what usually helps most?",
    options: [
      { id: "simple_explanation", label: "A simple explanation first" },
      { id: "concrete_example", label: "A concrete example first" },
      { id: "step_by_step", label: "Step-by-step instructions" },
      { id: "try_then_feedback", label: "Trying it and getting feedback" },
      { id: "mixed", label: "A mixture" },
    ],
  },
  {
    prompt: "How often do you lose focus while studying?",
    options: [
      { id: "rarely", label: "Rarely" },
      { id: "sometimes", label: "Sometimes" },
      { id: "often", label: "Often" },
      { id: "very_often", label: "Very often" },
    ],
  },
  {
    prompt: "Which starting pattern sounds most like you?",
    options: [
      { id: "on_time", label: "I usually begin when I plan to" },
      { id: "often_delay", label: "I intend to begin but often delay" },
      { id: "deadline_pressure", label: "I start when the deadline feels close" },
      { id: "planning_avoidance", label: "I avoid planning because it feels larger" },
      { id: "varies", label: "It varies" },
    ],
  },
  {
    prompt: "When do you usually have the most usable energy?",
    options: [
      { id: "morning", label: "Morning" },
      { id: "afternoon", label: "Afternoon" },
      { id: "evening", label: "Evening" },
      { id: "late_night", label: "Late night" },
      { id: "varies", label: "It changes" },
    ],
  },
  {
    prompt: "What do you most want YOVA to improve?",
    options: [
      { id: "begin", label: "Help me begin" },
      { id: "exact_guidance", label: "Tell me exactly what to do" },
      { id: "remember", label: "Help me remember more" },
      { id: "difficult_material", label: "Help me learn difficult material" },
      { id: "test_efficiency", label: "Prepare efficiently for tests" },
      { id: "consistency", label: "Help me stay consistent" },
      { id: "combined", label: "A combination" },
    ],
  },
  {
    prompt: "Would any of these make YOVA easier for you to use?",
    options: [...FUNCTIONAL_SUPPORT_OPTIONS],
    optional: true,
  },
  {
    prompt: "Is there anything else YOVA should know?",
    options: [
      { id: "forget_during_tests", label: "I understand in class but forget during tests" },
      { id: "long_plan_shutdown", label: "Long plans make me shut down" },
      { id: "examples_before_ready", label: "I need examples before I feel ready" },
      { id: "nothing_else", label: "Nothing else for now" },
    ],
    optional: true,
  },
];

/**
 * Exact migration boundary for profiles saved before option IDs existed.
 * Behavioral routing never reads these labels; it consumes the ID returned by
 * onboardingAnswerId. Keep an old label here if learner-facing copy changes.
 */
const LEGACY_ONBOARDING_LABEL_IDS: ReadonlyArray<Readonly<Record<string, string>>> = [
  { "I struggle to start": "struggle_to_start", "I do not know what to do first": "unclear_first_step", "I get distracted": "distracted", "I study but do not retain enough": "retention_gap", "I feel overwhelmed": "overwhelmed", "I try to make everything perfect": "perfectionism", "It depends on the task": "task_dependent" },
  { "Tell me exactly what to do": "exact_guidance", "Give me clear structure with flexibility": "structured_flexibility", "Recommend options and let me decide": "learner_choice" },
  { "10 to 15 minutes": "minutes_10_15", "20 to 30 minutes": "minutes_20_30", "30 to 45 minutes": "minutes_30_45", "45 to 60 minutes": "minutes_45_60", "It depends": "task_dependent" },
  { "A simple explanation first": "simple_explanation", "A concrete example first": "concrete_example", "Step-by-step instructions": "step_by_step", "Trying it and getting feedback": "try_then_feedback", "A mixture": "mixed" },
  { Rarely: "rarely", Sometimes: "sometimes", Often: "often", "Very often": "very_often" },
  { "I usually begin when I plan to": "on_time", "I intend to begin but often delay": "often_delay", "I start when the deadline feels close": "deadline_pressure", "I avoid planning because it feels larger": "planning_avoidance", "It varies": "varies" },
  { Morning: "morning", Afternoon: "afternoon", Evening: "evening", "Late night": "late_night", "It changes": "varies" },
  { "Help me begin": "begin", "Tell me exactly what to do": "exact_guidance", "Help me remember more": "remember", "Help me learn difficult material": "difficult_material", "Prepare efficiently for tests": "test_efficiency", "Help me stay consistent": "consistency", "A combination": "combined" },
  { "Shorter sections with fewer steps at once": "shorter_sections", "Less text and more visual structure": "reduced_text_visual_structure", "Extra time to read and respond": "extra_reading_time", "Instructions repeated in simpler language": "simpler_repeated_instructions", "Frequent check-ins and clear stopping points": "frequent_check_ins", "No extra support right now": "no_extra_support", "It depends on the task": "task_dependent" },
  { "I understand in class but forget during tests": "forget_during_tests", "Long plans make me shut down": "long_plan_shutdown", "I need examples before I feel ready": "examples_before_ready", "Nothing else for now": "nothing_else" },
];

export function onboardingAnswerId(
  questionIndex: number,
  value: string | null | undefined,
) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  const question = onboardingQuestions[questionIndex];
  if (!question) return null;
  if (question.options.some((option) => option.id === normalized)) return normalized;
  const legacyId = LEGACY_ONBOARDING_LABEL_IDS[questionIndex]?.[normalized] ?? null;
  return question.options.some((option) => option.id === legacyId) ? legacyId : null;
}

export function onboardingAnswerLabel(
  questionIndex: number,
  value: string | null | undefined,
) {
  const answerId = onboardingAnswerId(questionIndex, value);
  return onboardingQuestions[questionIndex]?.options.find((option) => option.id === answerId)?.label ?? null;
}

export const sessions = [
  { title: "Build the comparison", method: "Guided learning", when: "Completed", duration: "25 min", status: "complete" },
  { title: "Retrieve cellular respiration", method: "Closed-note retrieval", when: "Today · Afternoon", duration: "20 min", status: "ready" },
  { title: "Apply and distinguish", method: "Mixed practice", when: "Tomorrow · Evening", duration: "30 min", status: "upcoming" },
  { title: "Practice test and repair", method: "Assessment", when: "Thursday · Evening", duration: "35 min", status: "upcoming" },
  { title: "Rapid recall", method: "Final review", when: "Friday · Morning", duration: "5 min", status: "upcoming" },
];

export const agenda = [
  { window: "Afternoon", title: "Retrieve cellular respiration", item: "AP Biology Unit 3", duration: "20 min", primary: true },
  { window: "Evening", title: "Worked examples: product rule", item: "Calculus derivatives", duration: "25 min", primary: false },
];
