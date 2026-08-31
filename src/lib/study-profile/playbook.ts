import {
  CORE_METHOD_CATALOG,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import {
  buildStudyProfileMethodCatalog,
  selectStudyProfileTopMethods,
} from "@/lib/study-profile/method-catalog";
import { resolveStudyProfileNamedPattern } from "@/lib/study-profile/patterns";
import type {
  StudyProfileAnswers,
  StudyProfileMethodCatalogEntry,
  StudyProfileMethodCatalogId,
  StudyProfileMetadata,
  StudyProfileMethodRecommendation,
  StudyProfileNamedPattern,
  StudyProfilePlaybook,
  StudyProfileDimension,
  StudyProfileSchoolLevel,
  StudyProfileSessionPlan,
  StudyProfileSnapshot,
  StudyProfileStudyGoal,
} from "@/lib/study-profile/types";

type ProfileContext = {
  profile: StudyProfileSnapshot;
  metadata: Partial<StudyProfileMetadata>;
  answers?: StudyProfileAnswers;
};

const METHOD_USE_CASES: Record<CoreMethodId, string> = {
  retrieval_practice: "Use this for facts, definitions, diagrams, processes, and ideas you need to recall without help.",
  spaced_retrieval: "Use this for material you need to remember beyond the next day.",
  self_explanation: "Use this when you need to understand how a concept, process, or solution works.",
  worked_example_fading: "Use this for math, science, coding, and other tasks with a sequence of steps.",
  interleaved_practice: "Use this after you know the basics of several related problem types.",
  read_recall_review: "Use this for textbook sections, lecture notes, articles, and course modules.",
  pretesting: "Use this before first instruction when a brief prediction can focus what you notice next.",
  concept_mapping: "Use this when understanding depends on how several concepts relate, not on an isolated fact list.",
  practice_problems: "Use this after you have an initial model and need independent application in a changed context.",
  retrieval_based_outlining: "Use this when planning an essay, report, or written argument.",
  scaffolded_coding: "Use this when learning a new programming pattern or debugging approach.",
  practice_test_error_repair: "Use this when preparing for a quiz, exam, or any task with answers you can check.",
};

const METHOD_CAUTIONS: Partial<Record<CoreMethodId, string>> = {
  retrieval_practice: "Learn the idea once before testing yourself. Recall works best as practice, not as a replacement for the first explanation.",
  spaced_retrieval: "Do not wait a full week to revisit something you could not recall today. Bring misses back sooner.",
  self_explanation: "Keep the explanation focused. If exact facts are the goal, finish with a closed-note recall check.",
  worked_example_fading: "Remove the example once you can complete the steps. Copying a full solution is not independent practice.",
  read_recall_review: "The recall step is the point. Do not turn this into repeated reading or highlighting.",
  pretesting: "Keep the first attempt brief and ungraded. A miss before instruction is not evidence about ability.",
  concept_mapping: "Every line needs a meaningful relationship label; a decorative diagram is not a checked map.",
  practice_problems: "Do not keep the worked solution visible during the independent attempt or repeat only surface-identical items.",
  practice_test_error_repair: "Use representative, low-stakes questions. A practice test should guide the next review, not become a judgment about ability.",
};

export function buildStudyProfilePlaybook(
  profile: StudyProfileSnapshot,
  metadata: Partial<StudyProfileMetadata>,
  answers?: StudyProfileAnswers,
): StudyProfilePlaybook {
  const context = { profile, metadata, answers };
  const namedPattern = resolveStudyProfileNamedPattern(profile);
  const methods = selectGoalMatchedMethods(
    namedPattern.id,
    metadata.studyGoal,
  ).map((method) => (
    buildCatalogMethodRecommendation(method, namedPattern, metadata)
  ));

  return {
    heading: "A study plan you can try today",
    intro: namedPattern.id === "all_rounder"
      ? "No single habit needs a repair plan. Start with these method upgrades, compare the results, and keep the ones that improve your work."
      : `${namedPattern.name} is the clearest pattern in your answers. Start with the three methods that fit it best, then keep the parts that improve your work.`,
    nextSession: buildStudyProfileSessionPlan(context),
    methods,
  };
}

export function selectStudyProfileCatalogMethods(profile: StudyProfileSnapshot) {
  return selectStudyProfileTopMethods(resolveStudyProfileNamedPattern(profile).id);
}

export function buildStudyProfileMethodCatalogForProfile(profile: StudyProfileSnapshot) {
  return buildStudyProfileMethodCatalog(resolveStudyProfileNamedPattern(profile).id);
}

export function selectStudyProfileMethods({ profile }: ProfileContext): readonly CoreMethodId[] {
  const candidates: CoreMethodId[] = [];

  if (
    profile.classifications.mistake_sensitivity === "high"
    && (profile.classifications.starting_friction === "high"
      || profile.classifications.structure_need === "high")
  ) {
    candidates.push("worked_example_fading");
  }

  if (
    profile.calibrationDirection === "overconfidence_risk"
    || (profile.classifications.calibration_risk === "high"
      && profile.calibrationDirection !== "underconfidence_risk")
  ) {
    candidates.push("practice_test_error_repair");
  }

  if (
    profile.classifications.attention_variability === "high"
    || profile.classifications.cognitive_stamina === "high"
  ) {
    candidates.push("read_recall_review");
  }

  if (profile.calibrationDirection === "underconfidence_risk") {
    candidates.push("retrieval_practice");
  }

  candidates.push("retrieval_practice", "spaced_retrieval", "self_explanation");
  return [...new Set(candidates)].slice(0, 3);
}

export function buildStudyProfileSessionPlan({
  profile,
  metadata,
  answers,
}: ProfileContext): StudyProfileSessionPlan {
  const attention = profile.classifications.attention_variability;
  const stamina = profile.classifications.cognitive_stamina;
  const shortBlocks = attention === "high" || stamina === "high";
  const mediumBlocks = !shortBlocks && (attention === "moderate" || stamina === "moderate");
  const workMinutes = shortBlocks ? 12 : mediumBlocks ? 20 : 35;
  const breakMinutes = shortBlocks ? 3 : 5;
  const rounds = shortBlocks || mediumBlocks ? 2 : 1;

  return {
    title: `Start with a ${workMinutes} minute ${goalBlockLabel(metadata.studyGoal)}`,
    workMinutes,
    breakMinutes,
    rounds,
    bestTime: timingPlan(metadata.energyWindow),
    setupSteps: [
      goalFirstStep(metadata.studyGoal, metadata.schoolLevel),
      ...setupSteps(profile, answers),
    ],
    focusRule: focusRule(profile, answers, workMinutes),
    checkingRule: checkingRule(profile, answers),
    stopRule: stopRule(profile, answers, breakMinutes, rounds),
  };
}

function buildCatalogMethodRecommendation(
  method: StudyProfileMethodCatalogEntry,
  pattern: StudyProfileNamedPattern,
  metadata: Partial<StudyProfileMetadata>,
): StudyProfileMethodRecommendation {
  const caution = method.fit === "skip_for_now"
    ? "Leave this method for later. A simpler method above is more likely to help first."
    : method.fit === "situational"
      ? "Use this when the task matches the description above. It does not need to become part of every session."
      : "Try this for two or three sessions and compare the result with your current approach.";

  const tonightVersion = `${method.tonightVersion} ${goalMethodExample(
    metadata.studyGoal,
    metadata.schoolLevel,
  )}`;

  return {
    id: method.id,
    name: method.name,
    useWhen: method.whatItIs,
    whyItFits: method.fit === "strong_fit"
      ? `${method.whyItWorks} That makes it a strong fit for ${pattern.name}.`
      : method.whyItWorks,
    steps: method.steps,
    example: `Tonight version: ${tonightVersion}`,
    caution,
    basedOn: pattern.dimension ? [pattern.dimension] : [],
    timeCost: method.timeCost,
    tonightVersion,
    fit: method.fit,
  };
}

function whyLegacyMethodFits(methodId: CoreMethodId, { profile, answers }: ProfileContext) {
  if (methodId === "worked_example_fading") {
    return "Your answers suggest that unclear steps and the risk of a wrong first attempt can make it harder to begin. A complete example gives you a path, then fading the help gets you to independent practice.";
  }
  if (methodId === "practice_test_error_repair") {
    if (profile.calibrationDirection === "overconfidence_risk" || answers?.q8 === "c") {
      return "Your answers suggest that feeling prepared may sometimes arrive before the result supports it. A practice test gives you an honest check and tells you exactly what to review.";
    }
    return "Your answers show that checking real performance matters more than spending more time with familiar notes. This method turns each miss into a specific repair task.";
  }
  if (methodId === "read_recall_review") {
    return "Your focus may fade during long or repetitive work. Short reading sections followed by recall change the activity without pulling you away from the same topic.";
  }
  if (methodId === "pretesting") {
    return "A brief prediction can make the upcoming explanation more purposeful. YOVA treats the first attempt as an attention-setting diagnostic, never as a judgment about ability.";
  }
  if (methodId === "concept_mapping") {
    return "A checked relationship map makes the structure of an idea visible and exposes exactly which connection still needs repair.";
  }
  if (methodId === "practice_problems") {
    return "Independent problems show whether you can select and apply the procedure without a model remaining visible, while a changed follow-up checks transfer.";
  }
  if (methodId === "retrieval_practice") {
    if (profile.calibrationDirection === "underconfidence_risk" || answers?.q8 === "d") {
      return "Your confidence may be lower than your results. Recording correct answers gives you evidence of what you can already do and a clear list of what still needs work.";
    }
    if (profile.classifications.mistake_sensitivity === "high") {
      return "A short, private recall attempt lets you make useful mistakes before anything is graded. Checking afterward turns uncertainty into a concrete next step.";
    }
    return "Your report needs a reliable way to separate material that feels familiar from material you can actually use. Retrieval practice gives you that check.";
  }
  if (methodId === "spaced_retrieval") {
    return "Your study time will go further if you return to the material before it disappears completely. A simple return schedule also removes the decision about what to review next.";
  }
  return "Explaining an idea in your own words makes understanding visible. It helps you find the exact step or relationship that is still unclear.";
}

const GOAL_METHOD_PREFERENCES: Record<
  StudyProfileStudyGoal,
  readonly StudyProfileMethodCatalogId[]
> = {
  upcoming_exams: ["exam_condition_practice", "active_recall", "error_log", "spaced_practice"],
  keeping_up: ["weekly_review", "spaced_practice", "session_shutdown", "active_recall"],
  catching_up: ["five_minute_start", "timeboxing", "weekly_review", "worked_example_fading"],
  specific_qualification: ["exam_condition_practice", "active_recall", "error_log", "pretesting"],
  better_habits: ["implementation_intentions", "weekly_review", "session_shutdown", "timeboxing"],
};

function selectGoalMatchedMethods(
  patternId: StudyProfileNamedPattern["id"],
  studyGoal?: StudyProfileStudyGoal | null,
) {
  if (!studyGoal) return selectStudyProfileTopMethods(patternId);
  const fitRank = { strong_fit: 0, situational: 1, skip_for_now: 2 } as const;
  const goalRank = new Map(
    GOAL_METHOD_PREFERENCES[studyGoal].map((methodId, index) => [methodId, index]),
  );
  return [...buildStudyProfileMethodCatalog(patternId)]
    .map((method, index) => ({ method, index }))
    .sort((left, right) => (
      fitRank[left.method.fit] - fitRank[right.method.fit]
      || (goalRank.get(left.method.id) ?? Number.MAX_SAFE_INTEGER)
        - (goalRank.get(right.method.id) ?? Number.MAX_SAFE_INTEGER)
      || left.index - right.index
    ))
    .slice(0, 3)
    .map(({ method }) => method);
}

function goalBlockLabel(studyGoal?: StudyProfileStudyGoal | null) {
  if (studyGoal === "upcoming_exams" || studyGoal === "specific_qualification") {
    return "exam-practice block";
  }
  if (studyGoal === "catching_up") return "catch-up block";
  if (studyGoal === "keeping_up") return "coursework block";
  if (studyGoal === "better_habits") return "habit-building block";
  return "study block";
}

function goalFirstStep(
  studyGoal?: StudyProfileStudyGoal | null,
  schoolLevel?: StudyProfileMetadata["schoolLevel"],
) {
  if (studyGoal === "upcoming_exams") {
    return "Choose the exam that comes first and one topic or question it is likely to test.";
  }
  if (studyGoal === "specific_qualification") {
    return "Choose one objective from the target test or qualification and one question that checks it.";
  }
  if (studyGoal === "catching_up") {
    return "Choose the oldest important gap that is blocking your current work. Ignore the rest for this block.";
  }
  if (studyGoal === "keeping_up") {
    return schoolLevel === "college"
      ? "Choose one unfinished lecture objective, problem-set item, or reading from this week."
      : "Choose one unfinished class topic, assignment step, or question from this week.";
  }
  if (studyGoal === "better_habits") {
    return "Choose one small topic you can finish tonight and a time when you will repeat this setup.";
  }
  return "Choose one concrete result you want by the end of this block.";
}

function goalMethodExample(
  studyGoal?: StudyProfileStudyGoal | null,
  schoolLevel?: StudyProfileMetadata["schoolLevel"],
) {
  if (studyGoal === "upcoming_exams") return "Use material from the exam that comes first.";
  if (studyGoal === "specific_qualification") return "Use one item from the target test or specification.";
  if (studyGoal === "catching_up") return "Use the oldest topic that blocks what you are learning now.";
  if (studyGoal === "keeping_up") {
    return schoolLevel === "college"
      ? "Use material from your most recent lecture or problem set."
      : "Use material from your most recent class or assignment.";
  }
  if (studyGoal === "better_habits") {
    return "Keep the topic small enough to repeat the same setup next time.";
  }
  return "Use the most important material in front of you right now.";
}

/**
 * Keeps the pre-revamp core-method recommendations available to callers that
 * still consume the older Study Profile method contract. New public reports
 * use the named-pattern catalog above.
 */
export function buildLegacyStudyProfileMethods(
  profile: StudyProfileSnapshot,
  metadata: Partial<StudyProfileMetadata>,
  answers?: StudyProfileAnswers,
) {
  const context = { profile, metadata, answers };
  return selectStudyProfileMethods(context).map((methodId) => (
    buildLegacyMethodRecommendation(methodId, context)
  ));
}

function buildLegacyMethodRecommendation(
  methodId: CoreMethodId,
  context: ProfileContext,
): StudyProfileMethodRecommendation {
  const method = CORE_METHOD_CATALOG[methodId];
  return {
    id: method.id,
    name: method.name,
    useWhen: METHOD_USE_CASES[methodId],
    whyItFits: whyLegacyMethodFits(methodId, context),
    steps: legacyMethodSteps(methodId, context),
    example: legacySchoolExample(methodId, context.metadata.schoolLevel ?? "other"),
    caution: METHOD_CAUTIONS[methodId] ?? plainLegacyCaution(methodId),
    basedOn: legacyDimensionsForMethod(methodId, context.profile),
  };
}

function legacyMethodSteps(
  methodId: CoreMethodId,
  { profile, answers }: ProfileContext,
): readonly string[] {
  if (methodId === "retrieval_practice") {
    const first = profile.classifications.structure_need === "high"
      ? "Write three to five questions before you start, then hide your notes."
      : "Choose a small set of ideas or questions and hide your notes.";
    const evidence = profile.calibrationDirection === "underconfidence_risk" || answers?.q8 === "d"
      ? "Mark every correct answer as well as every miss so your confidence can use the full result."
      : "Mark each answer correct, partly correct, or missed before you review.";
    return [
      first,
      "Answer from memory before looking for help.",
      evidence,
      "Review only the missing parts, then retry those items later.",
    ];
  }
  if (methodId === "spaced_retrieval") {
    return [
      "Do one short closed-note check today.",
      "Repeat it tomorrow, then about three days later, then about one week later.",
      "Bring missed items back sooner and let correct items wait longer.",
      "Put the next review on your calendar before you stop.",
    ];
  }
  if (methodId === "practice_test_error_repair") {
    return [
      "Predict your score before you begin.",
      "Answer a small set of representative questions without notes or hints.",
      "For each miss, write what went wrong and the correct idea or step.",
      "Complete one similar question without help before moving on.",
    ];
  }
  if (methodId === "worked_example_fading") {
    return [
      "Study one correct example and explain why each step is there.",
      "Complete a similar example with one or two steps hidden.",
      "Try one comparable problem without the example visible.",
      "If you miss it, repair the exact step and try a new problem.",
    ];
  }
  if (methodId === "read_recall_review") {
    return [
      "Write one question the next short section should answer.",
      "Read only that section, then close the source.",
      "Answer the question from memory in a few sentences or a quick sketch.",
      "Reopen the source, correct the gaps, and move to the next section.",
    ];
  }
  if (methodId === "pretesting") {
    return [
      "Make one or two low-stakes predictions before opening the explanation.",
      "Study the accurate model and compare it with the initial attempt.",
      "Repair the exact gap without treating the pretest as a grade.",
      "Answer a different follow-up after instruction.",
    ];
  }
  if (methodId === "concept_mapping") {
    return [
      "Retrieve the important concepts before reopening the source.",
      "Join them with short relationship phrases that state how each pair connects.",
      "Verify every important link against the source.",
      "Repair unsupported links and explain one connection in words.",
    ];
  }
  if (methodId === "practice_problems") {
    return [
      "Attempt one representative problem without the solution visible.",
      "Find the first incorrect decision or step and repair it.",
      "Hide the repair support again.",
      "Solve a changed-context problem using the same principle.",
    ];
  }
  return [
    "Study one short, accurate explanation or worked example.",
    "Close it and explain how the idea works in your own words.",
    "Name why each important step or relationship matters.",
    "Compare with the source and fix the missing part.",
  ];
}

function legacyMethodSource(methodId: CoreMethodId, schoolLevel: StudyProfileSchoolLevel) {
  const byLevel = {
    high_school: {
      solved: "a solved problem from class",
      questions: "the questions at the end of the chapter",
      reading: "one section of the assigned reading",
      notes: "your class notes",
      idea: "the idea your teacher spent longest on",
    },
    college: {
      solved: "a worked example from lecture",
      questions: "a past exam question set",
      reading: "one section of the assigned chapter",
      notes: "your lecture notes",
      idea: "the concept the lecture built toward",
    },
    other: {
      solved: "a completed example from the course",
      questions: "the practice questions for this module",
      reading: "one section of the course material",
      notes: "your notes for this module",
      idea: "the idea the module keeps returning to",
    },
  } as const;

  const level = schoolLevel === "high_school" || schoolLevel === "college" ? schoolLevel : "other";
  const source = byLevel[level];
  switch (methodId) {
    case "worked_example_fading":
    case "scaffolded_coding":
      return source.solved;
    case "practice_test_error_repair":
    case "practice_problems":
      return source.questions;
    case "read_recall_review":
      return source.reading;
    case "self_explanation":
      return source.idea;
    default:
      return source.notes;
  }
}

function legacySchoolExample(methodId: CoreMethodId, schoolLevel: StudyProfileSchoolLevel) {
  const source = legacyMethodSource(methodId, schoolLevel);
  const examples: Partial<Record<CoreMethodId, string>> = {
    retrieval_practice: `Example: turn ${source} into five questions, close them, and answer all five before checking.`,
    spaced_retrieval: `Example: pick five important items from ${source} and repeat the same closed-note check tomorrow, in three days, and in a week.`,
    self_explanation: `Example: take ${source}, explain how it works without looking, then compare your explanation with the source.`,
    worked_example_fading: `Example: study ${source}, redo it with two steps hidden, then solve a similar problem with nothing in front of you.`,
    read_recall_review: `Example: read ${source}, close it, and write the main idea plus two supporting points from memory.`,
    pretesting: `Example: predict the answer to two questions about ${source}, study the relevant explanation, then answer a different follow-up.`,
    concept_mapping: `Example: retrieve five concepts from ${source}, connect them with labeled relationships, then verify each link.`,
    practice_problems: `Example: solve one question from ${source} without help, repair the first wrong step, then solve a changed version.`,
    practice_test_error_repair: `Example: answer five of ${source} without notes, group what you missed by cause, and redo one question per cause.`,
  };
  return examples[methodId] ?? `Example: apply this method to ${source} and record the result before choosing what to do next.`;
}

function legacyDimensionsForMethod(
  methodId: CoreMethodId,
  profile: StudyProfileSnapshot,
): readonly StudyProfileDimension[] {
  const mapped: Partial<Record<CoreMethodId, readonly StudyProfileDimension[]>> = {
    retrieval_practice: ["calibration_risk", "mistake_sensitivity"],
    spaced_retrieval: ["structure_need", "cognitive_stamina"],
    self_explanation: ["calibration_risk", "structure_need"],
    worked_example_fading: ["starting_friction", "structure_need", "mistake_sensitivity"],
    read_recall_review: ["attention_variability", "cognitive_stamina"],
    pretesting: ["starting_friction", "calibration_risk"],
    concept_mapping: ["structure_need", "calibration_risk"],
    practice_problems: ["structure_need", "mistake_sensitivity"],
    practice_test_error_repair: ["calibration_risk", "mistake_sensitivity"],
  };
  return mapped[methodId] ?? [profile.primaryPattern.dimension];
}

function plainLegacyCaution(methodId: CoreMethodId) {
  return CORE_METHOD_CATALOG[methodId].avoidWhen
    .replace("Do not ", "Avoid ")
    .replace("the learner", "you");
}

function timingPlan(energyWindow?: StudyProfileMetadata["energyWindow"]) {
  if (energyWindow === "morning") {
    return "Put the hardest closed-note or problem-solving work in the morning, when you said your focus is strongest.";
  }
  if (energyWindow === "afternoon") {
    return "Put the hardest closed-note or problem-solving work in the afternoon, when you said your focus is strongest.";
  }
  if (energyWindow === "evening") {
    return "Put the hardest closed-note or problem-solving work in the evening, when you said your focus is strongest.";
  }
  if (energyWindow === "late_night") {
    return "Use your late-night window only when it does not reduce sleep. If it does, test an earlier block and compare your accuracy.";
  }
  return "Try the same type of hard task in two different time windows this week. Keep the window where you finish more accurately and consistently.";
}

function setupSteps(profile: StudyProfileSnapshot, answers?: StudyProfileAnswers) {
  const starting = profile.classifications.starting_friction;
  const structure = profile.classifications.structure_need;
  if (starting === "high" && structure === "high") {
    return [
      "Before the session, write three steps: learn one idea, recall it without notes, and answer one practice question.",
      "Open the material and keep only the current step visible.",
      "Set a five minute start timer. You may stop when it ends, but begin the first step immediately.",
    ];
  }
  if (starting === "high" || answers?.q2 === "c" || answers?.q2 === "d") {
    return [
      "Open the exact material you need before the study block starts.",
      "Write one question you want to answer.",
      "Work for five minutes before deciding whether to continue.",
    ];
  }
  if (structure === "high") {
    return [
      "Write the next three actions in order before you start.",
      "Keep only the current and next action visible.",
      "Change the plan only at the end of a study block.",
    ];
  }
  if (starting === "low" && structure === "low") {
    return [
      "Choose one result you want by the end of the session.",
      "Skip a long setup routine and start with the question that will show you the most.",
    ];
  }
  return [
    "Choose one topic and one result for the session.",
    "Write the first action before the timer starts.",
  ];
}

function focusRule(profile: StudyProfileSnapshot, answers: StudyProfileAnswers | undefined, minutes: number) {
  if (profile.classifications.attention_variability === "high" || answers?.q5 === "d") {
    return `Stay on one topic for the full ${minutes} minutes. At the next round, change the format, such as recall, explanation, or practice questions, but keep the same topic.`;
  }
  if (answers?.q6 === "c" || profile.classifications.attention_variability === "moderate") {
    return "Change format once on purpose, such as moving from questions to explanation, while keeping the same topic.";
  }
  return "Protect one uninterrupted topic. Do not add a format change while your attention is holding.";
}

function checkingRule(profile: StudyProfileSnapshot, answers?: StudyProfileAnswers) {
  if (profile.calibrationDirection === "overconfidence_risk" || answers?.q8 === "c") {
    return "Predict your score, answer without notes, then compare the prediction with the result before deciding what to review.";
  }
  if (profile.calibrationDirection === "underconfidence_risk" || answers?.q8 === "d") {
    return "Record correct closed-note answers as well as misses. Use the full result, not the feeling of doubt, to choose the next task.";
  }
  if (answers?.q7 === "d") {
    return "Do not reread first. Produce an answer without notes, check it, and review only the missing parts.";
  }
  return "Finish each study block with one closed-note question so your next decision is based on what you can recall.";
}

function stopRule(
  profile: StudyProfileSnapshot,
  answers: StudyProfileAnswers | undefined,
  breakMinutes: number,
  rounds: number,
) {
  if (profile.classifications.cognitive_stamina === "high" || answers?.q11 === "d") {
    return `Take a ${breakMinutes} minute reset after each block. Stop after ${rounds} rounds, or sooner if accuracy drops for two items in a row.`;
  }
  if (profile.classifications.cognitive_stamina === "moderate" || answers?.q11 === "c") {
    return `Take a ${breakMinutes} minute reset after the first block. Continue only if your pace and accuracy still look steady.`;
  }
  return "Stop when the planned result is complete or the quality of your answers drops. More time is not useful if the work is getting worse.";
}
