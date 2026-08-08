import type { LearningIntent, SessionLearningMode } from "@/lib/domain";

export const LEARNING_INTENT_COPY: Record<LearningIntent, {
  name: string;
  shortName: string;
  description: string;
  sequence: string;
}> = {
  learn: {
    name: "Teach first",
    shortName: "Teaching first",
    description: "Build understanding or a skill you cannot yet explain or perform independently.",
    sequence: "YOVA teaches a concise model or example, guides an attempt, then checks what you can do independently.",
  },
  study: {
    name: "Practice first",
    shortName: "Practice first",
    description: "Strengthen, retrieve, and test material you have already encountered.",
    sequence: "YOVA starts with an attempt from memory, identifies gaps, then targets review and retry.",
  },
};

export type LearningIntentRecommendation = {
  intent: LearningIntent;
  reason: string;
};

type StartingEvidence = {
  goal: string;
  startingPoint?: string;
  diagnosticResponses?: Array<{
    answer: string;
    evaluation: "correct" | "incorrect" | "self_report";
  }>;
};

export function resolveLearningIntent(evidence: StartingEvidence): LearningIntentRecommendation {
  const startingPoint = evidence.startingPoint?.toLowerCase() ?? "";
  if (/haven't learned|have not learned|new to|completely new|know nothing|none yet|never (?:learned|seen)|doesn't make sense|does not make sense|starting from scratch/.test(startingPoint)) {
    return {
      intent: "learn",
      reason: "You said this is new or not yet clear, so YOVA should build understanding before expecting recall.",
    };
  }
  if (/need practice|test my recall|mostly reviewing|understand the basics|already learned/.test(startingPoint)) {
    return {
      intent: "study",
      reason: "You have already encountered the material, so YOVA should begin with an attempt and target the gaps it reveals.",
    };
  }

  const responses = evidence.diagnosticResponses ?? [];
  const objectiveChecks = responses.filter((response) => response.evaluation !== "self_report");
  const selfReportText = responses
    .filter((response) => response.evaluation === "self_report")
    .map((response) => response.answer.toLowerCase())
    .join(" ");
  const selfReportSignalsMissingFoundation = /do not know|don't know|know nothing|no idea|none yet|completely new|cannot explain|can't explain|not confident|starting from scratch|never (?:learned|seen)|doesn't make sense|does not make sense/.test(selfReportText);
  const allChecksIncorrect = objectiveChecks.length >= 2
    && objectiveChecks.every((response) => response.evaluation === "incorrect");
  if (selfReportSignalsMissingFoundation || allChecksIncorrect) {
    return {
      intent: "learn",
      reason: "Your starting check does not show a reliable foundation yet, so YOVA should teach the core idea before asking you to perform independently.",
    };
  }

  const allChecksCorrect = objectiveChecks.length > 0
    && objectiveChecks.every((response) => response.evaluation === "correct");
  if (allChecksCorrect) {
    return {
      intent: "study",
      reason: "Your starting check shows a usable foundation, so YOVA can begin with practice and retrieval.",
    };
  }

  return recommendLearningIntent(evidence.goal);
}

type EffectiveSessionModeInput = {
  planLearningIntent: LearningIntent;
  plannedMode: SessionLearningMode;
  completedSessionCount: number;
  familiarity?: "as_planned" | "already_know" | "need_teaching" | "challenge_me" | null;
};

/**
 * Resolve the mode that the learner should actually receive now.
 *
 * The saved session is a proposal. Direct learner evidence is authoritative:
 * a learner who asked to build a foundation cannot be sent into unsupported
 * retrieval before completing any teaching. This also repairs older saved
 * plans whose first session was incorrectly labelled practice-first.
 */
export function resolveEffectiveSessionLearningMode({
  planLearningIntent,
  plannedMode,
  completedSessionCount,
  familiarity = null,
}: EffectiveSessionModeInput): SessionLearningMode {
  if (familiarity === "need_teaching") return "learn";
  if (familiarity === "already_know" || familiarity === "challenge_me") return "study";
  if (planLearningIntent === "learn" && completedSessionCount === 0) return "learn";
  return plannedMode;
}

export function teachingFirstSessionCopy(topic: string) {
  return {
    method: "Guided explanation and self-explanation",
    methodReason: "You are building this foundation, so YOVA will teach a clear model and example before asking you to work without support.",
    objective: `Build an accurate first mental model of ${topic}, use one concrete example, and then explain the central relationship with less support.`,
  };
}

export function recommendLearningIntent(goal: string): LearningIntentRecommendation {
  const normalized = goal.toLowerCase();
  const learningSignal = /\b(learn|understand|teach me|explain|new to|from scratch|beginner|how does|fundamentals|foundations)\b/.test(normalized);
  const studySignal = /\b(study|review|prepare|test|exam|quiz|final|recall|remember|practice test|flashcards?|cram)\b/.test(normalized);

  if (learningSignal && !studySignal) {
    return {
      intent: "learn",
      reason: "Your goal sounds like it needs initial understanding or guided skill-building.",
    };
  }
  if (studySignal && !learningSignal) {
    return {
      intent: "study",
      reason: "Your goal sounds like preparation or review of material you have already encountered.",
    };
  }
  if (learningSignal && studySignal) {
    return {
      intent: "study",
      reason: "This goal includes learning and preparation. YOVA will start with an attempt, then teach any foundation the attempt exposes as missing.",
    };
  }

  return {
    intent: "learn",
    reason: "YOVA cannot see a demonstrated foundation yet, so it will teach briefly before asking for independent performance.",
  };
}

export function learningModeContract(mode: SessionLearningMode) {
  if (mode === "learn") {
    return {
      purpose: "Build an accurate mental model or usable procedure before expecting unsupported performance.",
      requiredSequence: [
        "Teach one concise explanation, model, or complete example.",
        "Guide one attempt while the learner can still use support.",
        "Fade the support and require an independent explanation or application.",
        "Use the final check to identify a specific gap, not to pretend that one success proves mastery.",
      ],
      firstActivityRule: "The first topic activity must teach or model the target idea before a scored knowledge check.",
    };
  }

  return {
    purpose: "Strengthen and verify knowledge the learner has already encountered through retrieval or application.",
    requiredSequence: [
      "Begin with a closed-note retrieval or application attempt before teaching the answer.",
      "Use the attempt to identify the exact gap or error.",
      "Review or re-teach only the exposed gap.",
      "Require a retry or transfer question after feedback.",
    ],
    firstActivityRule: "The first topic activity must be a question or independent attempt; do not place a topic explanation before it.",
  };
}

export function inferLegacySessionLearningMode(method: string, objective: string): SessionLearningMode {
  const combined = `${method} ${objective}`;
  return /teach|explain|understand|model|worked example|scaffold|guided|foundation|first learn/i.test(combined)
    ? "learn"
    : "study";
}
