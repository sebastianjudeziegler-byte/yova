import {
  CORE_METHOD_CATALOG,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import { STUDY_PROFILE_DIMENSION_NAMES } from "@/lib/study-profile/config";
import type {
  StudyProfileAnswers,
  StudyProfileDimension,
  StudyProfileMetadata,
  StudyProfileMethodRecommendation,
  StudyProfilePlaybook,
  StudyProfileSchoolLevel,
  StudyProfileSessionPlan,
  StudyProfileSnapshot,
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
  practice_test_error_repair: "Use representative, low-stakes questions. A practice test should guide the next review, not become a judgment about ability.",
};

export function buildStudyProfilePlaybook(
  profile: StudyProfileSnapshot,
  metadata: Partial<StudyProfileMetadata>,
  answers?: StudyProfileAnswers,
): StudyProfilePlaybook {
  const context = { profile, metadata, answers };
  const methods = selectStudyProfileMethods(context).map((methodId) => (
    buildMethodRecommendation(methodId, context)
  ));
  const primary = STUDY_PROFILE_DIMENSION_NAMES[profile.primaryPattern.dimension].toLowerCase();
  const secondary = STUDY_PROFILE_DIMENSION_NAMES[profile.secondaryPattern.dimension].toLowerCase();

  return {
    heading: "A study plan you can try today",
    intro: `Your answers point most strongly to ${primary} and ${secondary}. Use this as a starting experiment, then keep the parts that improve your work.`,
    nextSession: buildStudyProfileSessionPlan(context),
    methods,
  };
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
    title: `Start with a ${workMinutes} minute study block`,
    workMinutes,
    breakMinutes,
    rounds,
    bestTime: timingPlan(metadata.energyWindow),
    setupSteps: setupSteps(profile, answers),
    focusRule: focusRule(profile, answers, workMinutes),
    checkingRule: checkingRule(profile, answers),
    stopRule: stopRule(profile, answers, breakMinutes, rounds),
  };
}

function buildMethodRecommendation(
  methodId: CoreMethodId,
  context: ProfileContext,
): StudyProfileMethodRecommendation {
  const method = CORE_METHOD_CATALOG[methodId];
  return {
    id: method.id,
    name: method.name,
    useWhen: METHOD_USE_CASES[methodId],
    whyItFits: whyMethodFits(methodId, context),
    steps: methodSteps(methodId, context),
    example: schoolExample(methodId, context.metadata.schoolLevel ?? "other"),
    caution: METHOD_CAUTIONS[methodId] ?? plainCaution(methodId),
    basedOn: dimensionsForMethod(methodId, context.profile),
  };
}

function whyMethodFits(methodId: CoreMethodId, { profile, answers }: ProfileContext) {
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

function methodSteps(methodId: CoreMethodId, { profile, answers }: ProfileContext): readonly string[] {
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
  return [
    "Study one short, accurate explanation or worked example.",
    "Close it and explain how the idea works in your own words.",
    "Name why each important step or relationship matters.",
    "Compare with the source and fix the missing part.",
  ];
}

/**
 * Picks the material each method should be practised on.
 *
 * A single shared phrase was reused for every method, so a report showing three
 * methods repeated the same clause three times and read as mail-merge, which
 * undercuts the claim that the methods were matched to the learner.
 */
function methodSource(methodId: CoreMethodId, schoolLevel: StudyProfileSchoolLevel) {
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
      return source.questions;
    case "read_recall_review":
      return source.reading;
    case "self_explanation":
      return source.idea;
    default:
      return source.notes;
  }
}

function schoolExample(methodId: CoreMethodId, schoolLevel: StudyProfileSchoolLevel) {
  const source = methodSource(methodId, schoolLevel);

  const examples: Partial<Record<CoreMethodId, string>> = {
    retrieval_practice: `Example: turn ${source} into five questions, close them, and answer all five before checking.`,
    spaced_retrieval: `Example: pick five important items from ${source} and repeat the same closed-note check tomorrow, in three days, and in a week.`,
    self_explanation: `Example: take ${source}, explain how it works without looking, then compare your explanation with the source.`,
    worked_example_fading: `Example: study ${source}, redo it with two steps hidden, then solve a similar problem with nothing in front of you.`,
    read_recall_review: `Example: read ${source}, close it, and write the main idea plus two supporting points from memory.`,
    practice_test_error_repair: `Example: answer five of ${source} without notes, group what you missed by cause, and redo one question per cause.`,
  };
  return examples[methodId] ?? `Example: apply this method to ${source} and record the result before choosing what to do next.`;
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
  if (answers?.q6 === "b" || profile.classifications.attention_variability === "moderate") {
    return "Make progress visible. Tally completed questions, recalled ideas, or finished steps at the end of each block.";
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

function dimensionsForMethod(
  methodId: CoreMethodId,
  profile: StudyProfileSnapshot,
): readonly StudyProfileDimension[] {
  const mapped: Partial<Record<CoreMethodId, readonly StudyProfileDimension[]>> = {
    retrieval_practice: ["calibration_risk", "mistake_sensitivity"],
    spaced_retrieval: ["structure_need", "cognitive_stamina"],
    self_explanation: ["calibration_risk", "structure_need"],
    worked_example_fading: ["starting_friction", "structure_need", "mistake_sensitivity"],
    read_recall_review: ["attention_variability", "cognitive_stamina"],
    practice_test_error_repair: ["calibration_risk", "mistake_sensitivity"],
  };
  return mapped[methodId] ?? [profile.primaryPattern.dimension];
}

function plainCaution(methodId: CoreMethodId) {
  return CORE_METHOD_CATALOG[methodId].avoidWhen
    .replace("Do not ", "Avoid ")
    .replace("the learner", "you");
}
