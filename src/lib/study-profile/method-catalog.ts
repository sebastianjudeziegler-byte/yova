import {
  STUDY_PROFILE_NAMED_PATTERN_IDS,
  type StudyProfileMethodCatalogDefinition,
  type StudyProfileMethodCatalogEntry,
  type StudyProfileMethodFit,
  type StudyProfileNamedPatternId,
} from "@/lib/study-profile/types";
import { studyProfilePatternCopy } from "@/lib/study-profile/patterns";

const FIT_LABELS: Record<StudyProfileMethodFit, string> = {
  strong_fit: "Strong fit",
  situational: "Useful in the right situation",
  skip_for_now: "Skip for now",
};

function fits(
  strongFor: readonly StudyProfileNamedPatternId[],
  skipFor: readonly StudyProfileNamedPatternId[] = [],
): Record<StudyProfileNamedPatternId, StudyProfileMethodFit> {
  return Object.fromEntries(STUDY_PROFILE_NAMED_PATTERN_IDS.map((patternId) => [
    patternId,
    strongFor.includes(patternId)
      ? "strong_fit"
      : skipFor.includes(patternId)
        ? "skip_for_now"
        : "situational",
  ])) as Record<StudyProfileNamedPatternId, StudyProfileMethodFit>;
}

/**
 * The lead magnet has its own practical catalog instead of borrowing the app's
 * smaller learning-method catalog. Several entries here are session routines,
 * so keeping this list separate avoids changing the semantics of product data.
 */
export const STUDY_PROFILE_METHOD_CATALOG: readonly StudyProfileMethodCatalogDefinition[] = [
  {
    id: "active_recall",
    name: "Active Recall",
    whatItIs: "Close the source and produce the answer from memory before checking it.",
    whyItWorks: "Recall shows what you can actually use, not just what looks familiar.",
    steps: [
      "Turn a short section into three to five questions.",
      "Hide your notes and answer every question from memory.",
      "Mark each answer correct, partly correct, or missed.",
      "Review only the gaps, then retry the missed items.",
    ],
    timeCost: "10 to 20 minutes",
    tonightVersion: "Write three questions from today's notes and answer them with the notes closed.",
    fitByPattern: fits(
      ["familiarity_trap", "evidence_doubter", "all_rounder"],
    ),
  },
  {
    id: "spaced_practice",
    name: "Spaced Practice",
    whatItIs: "Return to the same material in short sessions spread across several days.",
    whyItWorks: "A planned return strengthens memory and removes the daily decision about what to review.",
    steps: [
      "Do one short closed-note check today.",
      "Repeat the same check on days 2, 3, and 7.",
      "Bring missed items back sooner and let correct items wait longer.",
      "Schedule the next review before you stop.",
    ],
    timeCost: "10 minutes per review",
    tonightVersion: "Schedule 10-minute reviews for days 2, 3, and 7, then do the first closed-note check.",
    fitByPattern: fits(["scattershot", "sprinter", "all_rounder"]),
  },
  {
    id: "exam_condition_practice",
    name: "Exam-Condition Practice",
    whatItIs: "Answer a representative set of questions with the same limits you will face in the real assessment.",
    whyItWorks: "It replaces guesses about readiness with direct evidence and makes exam conditions less novel.",
    steps: [
      "Choose a small, representative question set.",
      "Set the real time limit and put notes away.",
      "Predict your result, then complete the set without hints.",
      "Compare the prediction with the result and list what to repair.",
    ],
    timeCost: "20 to 45 minutes",
    tonightVersion: "Complete one past question under a strict timer, then check it against the mark scheme.",
    fitByPattern: fits(
      ["familiarity_trap", "evidence_doubter", "polisher"],
      ["stalled_starter"],
    ),
  },
  {
    id: "error_log",
    name: "Error Log",
    whatItIs: "Keep a short record of each important miss, its cause, and the repair that worked.",
    whyItWorks: "It turns mistakes into patterns you can fix instead of events you need to avoid.",
    steps: [
      "Record the question or skill you missed.",
      "Name the cause, such as a knowledge gap, a rushed step, or a misread prompt.",
      "Write the correct idea or step in one sentence.",
      "Retry a similar item without help and date the result.",
    ],
    timeCost: "3 to 5 minutes per error",
    tonightVersion: "Take one recent mistake and write its cause, correction, and one new test question.",
    fitByPattern: fits(["polisher", "familiarity_trap"]),
  },
  {
    id: "teach_back",
    name: "Teach-Back",
    whatItIs: "Explain an idea in plain language as if you were teaching someone who has not seen it.",
    whyItWorks: "A clear explanation exposes missing links that rereading can hide.",
    steps: [
      "Choose one concept and close the source.",
      "Explain it aloud or in writing without jargon.",
      "Include how it works and why each main step matters.",
      "Check the source and repair the first gap you find.",
    ],
    timeCost: "8 to 15 minutes",
    tonightVersion: "Record a two-minute voice note explaining one topic, then check it for one missing link.",
    fitByPattern: fits(["familiarity_trap", "drifter"]),
  },
  {
    id: "five_minute_start",
    name: "Five-Minute Start",
    whatItIs: "Commit only to a tiny, clearly defined first action for five minutes.",
    whyItWorks: "It lowers the cost of beginning while still creating enough momentum to continue.",
    steps: [
      "Choose one task that can be started without another decision.",
      "Write the first visible action in a single sentence.",
      "Set a five-minute timer and do only that action.",
      "When the timer ends, choose deliberately whether to continue for one block.",
    ],
    timeCost: "5 minutes",
    tonightVersion: "Open the right material, write the first question, and work on it for five minutes.",
    fitByPattern: fits(
      ["stalled_starter"],
      ["familiarity_trap", "evidence_doubter"],
    ),
  },
  {
    id: "implementation_intentions",
    name: "If-Then Study Plans",
    whatItIs: "Connect a specific cue to a specific study action before the moment arrives.",
    whyItWorks: "A prepared cue reduces the number of choices between intending to study and starting.",
    steps: [
      "Choose a cue you can notice, such as finishing dinner or arriving at the library.",
      "Write: If that cue happens, then I will do one exact study action.",
      "Prepare the material and remove one likely obstacle.",
      "Track whether the cue led to the action, then adjust the plan.",
    ],
    timeCost: "3 minutes to plan",
    tonightVersion: "Write one plan: If I finish dinner, then I will answer five closed-note questions at my desk.",
    fitByPattern: fits(["stalled_starter", "scattershot"]),
  },
  {
    id: "timeboxing",
    name: "Timeboxing",
    whatItIs: "Give one defined task a fixed work block with a clear stopping point.",
    whyItWorks: "A visible finish line protects attention and keeps a session from expanding after useful effort fades.",
    steps: [
      "Choose one outcome for the block.",
      "Set a timer that matches your current energy.",
      "Keep one capture note for distractions instead of following them.",
      "Stop on time, record progress, and decide the next block.",
    ],
    timeCost: "15 to 35 minutes",
    tonightVersion: "Run one 20-minute block on a single outcome, followed by a five-minute break.",
    fitByPattern: fits(["sprinter", "drifter"]),
  },
  {
    id: "interleaving",
    name: "Interleaving",
    whatItIs: "Mix related problem types after you know the basic method for each one.",
    whyItWorks: "Choosing between methods builds flexible knowledge and adds purposeful variety.",
    steps: [
      "Choose two or three related problem types you have already learned.",
      "Mix them in an order that does not reveal which method comes next.",
      "Before solving each item, name the method you chose and why.",
      "Check the answer and the method choice separately.",
    ],
    timeCost: "20 to 30 minutes",
    tonightVersion: "Mix six questions from two familiar problem types and name the method before each answer.",
    fitByPattern: fits(
      ["drifter", "all_rounder"],
      ["stalled_starter", "scattershot"],
    ),
  },
  {
    id: "brain_dump",
    name: "Brain Dump",
    whatItIs: "Write everything you can recall about a topic before reopening the source.",
    whyItWorks: "It makes the boundary between available knowledge and familiar-looking material visible.",
    steps: [
      "Write the topic at the top of a blank page.",
      "Set a short timer and record facts, links, diagrams, or steps from memory.",
      "Check the source in a different colour.",
      "Turn the most important gap into a question for later recall.",
    ],
    timeCost: "8 to 12 minutes",
    tonightVersion: "Do a five-minute brain dump on one topic and circle the three largest gaps.",
    fitByPattern: fits(["familiarity_trap", "evidence_doubter"]),
  },
  {
    id: "pretesting",
    name: "Pretesting",
    whatItIs: "Attempt a few questions before studying the material, even when you expect to miss some.",
    whyItWorks: "The attempt gives the lesson a target and makes the relevant explanation easier to notice.",
    steps: [
      "Choose three to five questions from the next topic.",
      "Attempt each one briefly without looking up the answer.",
      "Mark what you knew, partly knew, and did not know.",
      "Study with those gaps in view, then retry the same questions.",
    ],
    timeCost: "5 to 10 minutes before study",
    tonightVersion: "Answer three end-of-section questions before reading the section, then retry them afterward.",
    fitByPattern: fits(
      ["all_rounder", "drifter"],
      ["polisher"],
    ),
  },
  {
    id: "worked_example_fading",
    name: "Worked Example Fading",
    whatItIs: "Start with a complete solution, then remove help one step at a time.",
    whyItWorks: "It provides a safe route into a complex task while still ending in independent performance.",
    steps: [
      "Study one correct example and explain why each step is there.",
      "Complete a similar example with one or two steps hidden.",
      "Try one comparable problem without the example visible.",
      "Repair the exact missed step, then try a new problem.",
    ],
    timeCost: "20 to 30 minutes",
    tonightVersion: "Take one solved problem, hide its final two steps, and finish it before trying a similar problem alone.",
    fitByPattern: fits(["scattershot", "polisher"]),
  },
  {
    id: "elaborative_interrogation",
    name: "Ask Why and How",
    whatItIs: "Ask why a fact is true or how one idea causes another, then answer in your own words.",
    whyItWorks: "Connecting new information to reasons and relationships makes it easier to retrieve later.",
    steps: [
      "Choose one important claim, rule, or process.",
      "Ask why it is true and how it connects to what you already know.",
      "Answer without copying the source.",
      "Check the explanation and add one missing link.",
    ],
    timeCost: "10 to 15 minutes",
    tonightVersion: "Choose one key fact and write three sentences answering why it is true and when it matters.",
    fitByPattern: fits(
      ["all_rounder", "polisher"],
      ["stalled_starter"],
    ),
  },
  {
    id: "weekly_review",
    name: "Weekly Review",
    whatItIs: "Use a short weekly check to choose what to keep, revisit, and stop doing.",
    whyItWorks: "It converts scattered study sessions into one visible system and keeps old gaps from disappearing.",
    steps: [
      "List what you studied and the next fixed deadline.",
      "Review recent recall results and error-log entries.",
      "Choose the three most important returns for the next week.",
      "Put those sessions on the calendar and remove one low-value task.",
    ],
    timeCost: "30 minutes weekly",
    tonightVersion: "List your three next deadlines and schedule one concrete review for each.",
    fitByPattern: fits(
      ["scattershot", "sprinter"],
      ["stalled_starter"],
    ),
  },
  {
    id: "session_shutdown",
    name: "Session Shutdown",
    whatItIs: "End each session by recording progress and preparing one obvious next action.",
    whyItWorks: "A deliberate ending protects energy, prevents endless polishing, and lowers the cost of restarting.",
    steps: [
      "Write what you completed in one sentence.",
      "Record one unresolved question or error.",
      "Choose the first visible action for the next session.",
      "Put the needed material in place, then stop.",
    ],
    timeCost: "3 to 5 minutes",
    tonightVersion: "Before you stop, write tomorrow's first action and leave the right page or file ready.",
    fitByPattern: fits(["polisher", "sprinter", "stalled_starter"]),
  },
] as const;

export function buildStudyProfileMethodCatalog(
  patternId: StudyProfileNamedPatternId,
): readonly StudyProfileMethodCatalogEntry[] {
  return STUDY_PROFILE_METHOD_CATALOG.map((method) => {
    const fit = method.fitByPattern[patternId];
    return {
      id: method.id,
      name: method.name,
      whatItIs: method.whatItIs,
      whyItWorks: method.whyItWorks,
      steps: method.steps,
      timeCost: method.timeCost,
      tonightVersion: method.tonightVersion,
      fit,
      fitLabel: studyProfileMethodFitLabel(fit, patternId),
    };
  });
}

export function selectStudyProfileTopMethods(
  patternId: StudyProfileNamedPatternId,
  limit = 3,
): readonly StudyProfileMethodCatalogEntry[] {
  const rank: Record<StudyProfileMethodFit, number> = {
    strong_fit: 0,
    situational: 1,
    skip_for_now: 2,
  };
  return [...buildStudyProfileMethodCatalog(patternId)]
    .sort((left, right) => rank[left.fit] - rank[right.fit])
    .slice(0, Math.max(0, limit));
}

export function studyProfileMethodFitLabel(
  fit: StudyProfileMethodFit,
  patternId?: StudyProfileNamedPatternId,
) {
  if (!patternId || fit === "situational") return FIT_LABELS[fit];
  if (fit === "skip_for_now") {
    return patternId === "stalled_starter"
      ? "Skip for now. Fix starting first"
      : FIT_LABELS[fit];
  }
  const patternName = studyProfilePatternCopy(patternId).name.replace(/^The /, "");
  return `Strong fit for ${patternName}`;
}
