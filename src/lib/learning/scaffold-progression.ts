import type { ConceptEvidence, SessionCompletion, SessionLearningMode } from "@/lib/domain";
import type { MethodPhase } from "@/lib/learning/method-fidelity";

const SUPPORTED_PHASES = new Set<MethodPhase>([
  "guided_practice",
  "code_trace",
  "evidence_match",
]);

const INDEPENDENT_PHASES = new Set<MethodPhase>([
  "retrieve",
  "explain",
  "independent_practice",
  "discriminate",
  "transfer",
]);

export type ScaffoldProgressionStatus =
  | "collect_evidence"
  | "restore_support"
  | "fade_support"
  | "independent_transfer";

export type ScaffoldProgressionSignal = {
  concept: string;
  checks: number;
  supportedChecks: number;
  independentChecks: number;
  secureIndependentChecks: number;
  latestOutcome: ConceptEvidence["outcome"];
  latestPhase: MethodPhase;
  status: ScaffoldProgressionStatus;
  evidence: string;
  guidance: string;
};

export type SessionSupportPlan = {
  level: "supported_start" | "fading" | "independent_start";
  title: string;
  explanation: string;
  evidenceLabel: string;
  concept: string | null;
};

type ProgressionActivity = {
  methodPhase: MethodPhase;
  type: "instruction" | "multiple_choice" | "free_response" | "reflection";
  concept: string | null;
};

export function buildScaffoldProgressionSignals(
  completions: Array<Pick<SessionCompletion, "completedAt" | "conceptEvidence">>,
): ScaffoldProgressionSignal[] {
  const grouped = new Map<string, {
    concept: string;
    checks: number;
    supportedChecks: number;
    secureSupportedChecks: number;
    independentChecks: number;
    secureIndependentChecks: number;
    latestOutcome: ConceptEvidence["outcome"];
    latestPhase: MethodPhase;
  }>();

  for (const completion of [...completions].sort((left, right) => left.completedAt.localeCompare(right.completedAt))) {
    for (const item of completion.conceptEvidence ?? []) {
      if (!item.methodPhase || !isScaffoldEvidencePhase(item.methodPhase)) continue;
      const concept = item.concept.trim().replace(/\s+/g, " ");
      if (!concept) continue;
      const key = concept.toLocaleLowerCase();
      const current = grouped.get(key) ?? {
        concept,
        checks: 0,
        supportedChecks: 0,
        secureSupportedChecks: 0,
        independentChecks: 0,
        secureIndependentChecks: 0,
        latestOutcome: item.outcome,
        latestPhase: item.methodPhase,
      };
      const supported = SUPPORTED_PHASES.has(item.methodPhase);
      current.concept = concept;
      current.checks += 1;
      current.supportedChecks += supported ? 1 : 0;
      current.secureSupportedChecks += supported && item.outcome === "secure" ? 1 : 0;
      current.independentChecks += supported ? 0 : 1;
      current.secureIndependentChecks += !supported && item.outcome === "secure" ? 1 : 0;
      current.latestOutcome = item.outcome;
      current.latestPhase = item.methodPhase;
      grouped.set(key, current);
    }
  }

  return [...grouped.values()]
    .map((result): ScaffoldProgressionSignal => {
      const status: ScaffoldProgressionStatus = result.latestOutcome === "needs_review"
        ? "restore_support"
        : result.secureIndependentChecks >= 2
          ? "independent_transfer"
          : result.secureSupportedChecks > 0 || result.secureIndependentChecks > 0
            ? "fade_support"
            : "collect_evidence";
      return {
        concept: result.concept,
        checks: result.checks,
        supportedChecks: result.supportedChecks,
        independentChecks: result.independentChecks,
        secureIndependentChecks: result.secureIndependentChecks,
        latestOutcome: result.latestOutcome,
        latestPhase: result.latestPhase,
        status,
        evidence: progressionEvidence(result, status),
        guidance: progressionGuidance(status),
      };
    })
    .sort((left, right) => {
      const priority: Record<ScaffoldProgressionStatus, number> = {
        restore_support: 0,
        fade_support: 1,
        independent_transfer: 2,
        collect_evidence: 3,
      };
      return priority[left.status] - priority[right.status] || right.checks - left.checks;
    });
}

export function validateScaffoldProgression({
  signals,
  activities,
}: {
  signals: ScaffoldProgressionSignal[];
  activities: ProgressionActivity[];
}) {
  const relevant = signals.find((signal) => activities.some((activity) => (
    isKnowledgeCheck(activity)
    && sameConcept(activity.concept, signal.concept)
  )));
  if (!relevant || relevant.status === "collect_evidence") return null;

  const conceptChecks = activities.filter((activity) => (
    isKnowledgeCheck(activity)
    && sameConcept(activity.concept, relevant.concept)
  ));
  const firstConceptCheck = conceptChecks[0];

  if (relevant.status === "restore_support") {
    const supportIndex = activities.findIndex((activity) => (
      activity.methodPhase === "model"
      || (isKnowledgeCheck(activity) && SUPPORTED_PHASES.has(activity.methodPhase))
    ));
    const independentAfterSupport = activities.some((activity, index) => (
      index > supportIndex
      && isKnowledgeCheck(activity)
      && sameConcept(activity.concept, relevant.concept)
      && INDEPENDENT_PHASES.has(activity.methodPhase)
    ));
    if (supportIndex < 0 || !independentAfterSupport) {
      return `${relevant.concept} needs a model or guided step followed by another independent attempt.`;
    }
  }

  if (relevant.status === "fade_support") {
    const independentAttempt = conceptChecks.some((activity) => INDEPENDENT_PHASES.has(activity.methodPhase));
    if (!independentAttempt) {
      return `${relevant.concept} needs an independent attempt after its earlier supported or first secure check.`;
    }
  }

  if (relevant.status === "independent_transfer") {
    if (!INDEPENDENT_PHASES.has(firstConceptCheck.methodPhase)) {
      return `${relevant.concept} has repeated independent success, so its next check must begin without guided support.`;
    }
    if (!conceptChecks.some((activity) => activity.methodPhase === "transfer" || activity.methodPhase === "discriminate")) {
      return `${relevant.concept} needs a different transfer or discrimination check instead of repeated guided practice.`;
    }
  }

  return null;
}

export function buildSessionSupportPlan({
  signals,
  activities,
  learningMode,
}: {
  signals: ScaffoldProgressionSignal[];
  activities: ProgressionActivity[];
  learningMode: SessionLearningMode;
}): SessionSupportPlan {
  const relevant = signals.find((signal) => activities.some((activity) => (
    isKnowledgeCheck(activity)
    && sameConcept(activity.concept, signal.concept)
  )));

  if (!relevant) {
    return learningMode === "learn"
      ? {
        level: "supported_start",
        title: "Support fades inside this session",
        explanation: "YOVA does not have a comparable completed check yet, so it will teach or model the idea before requiring an independent attempt.",
        evidenceLabel: "Establishing a baseline",
        concept: null,
      }
      : {
        level: "independent_start",
        title: "Start without support",
        explanation: "YOVA needs a genuine attempt before showing the answer so the session can establish what is already available from memory.",
        evidenceLabel: "Establishing a baseline",
        concept: null,
      };
  }

  if (relevant.status === "restore_support") {
    return {
      level: "supported_start",
      title: `Support restored for ${relevant.concept}`,
      explanation: "The latest completed check still showed a gap, so YOVA will rebuild the step briefly before returning to independent work.",
      evidenceLabel: `${relevant.checks} completed ${relevant.checks === 1 ? "check" : "checks"}`,
      concept: relevant.concept,
    };
  }
  if (relevant.status === "independent_transfer") {
    return {
      level: "independent_start",
      title: `Independent transfer for ${relevant.concept}`,
      explanation: "Repeated independent checks were secure, so YOVA is withholding guided support and changing the application instead of repeating the same example.",
      evidenceLabel: `${relevant.secureIndependentChecks} secure independent checks`,
      concept: relevant.concept,
    };
  }

  return {
    level: "fading",
    title: `Support reduced for ${relevant.concept}`,
    explanation: "The previous check was secure enough to remove some guidance, but YOVA still needs another independent result before treating the concept as stable.",
    evidenceLabel: `${relevant.checks} completed ${relevant.checks === 1 ? "check" : "checks"}`,
    concept: relevant.concept,
  };
}

function progressionEvidence(
  result: {
    checks: number;
    supportedChecks: number;
    independentChecks: number;
    secureIndependentChecks: number;
    latestOutcome: ConceptEvidence["outcome"];
  },
  status: ScaffoldProgressionStatus,
) {
  if (status === "restore_support") {
    return `The latest completed check needs review after ${result.supportedChecks} supported and ${result.independentChecks} independent attempts.`;
  }
  if (status === "independent_transfer") {
    return `${result.secureIndependentChecks} independent checks were secure. That supports a different transfer task, not a permanent mastery claim.`;
  }
  if (status === "fade_support") {
    return `The concept has a secure completed check, but only ${result.secureIndependentChecks} secure independent ${result.secureIndependentChecks === 1 ? "attempt" : "attempts"}.`;
  }
  return "There is not yet enough phase-specific evidence to change the amount of support.";
}

function progressionGuidance(status: ScaffoldProgressionStatus) {
  if (status === "restore_support") return "Give a brief model or guided step, then require a new independent attempt.";
  if (status === "fade_support") return "Remove some guidance and require an independent check before showing the answer.";
  if (status === "independent_transfer") return "Begin independently and use a different transfer or discrimination task.";
  return "Use the normal task-first sequence and record whether the completed check was supported or independent.";
}

function isKnowledgeCheck(activity: ProgressionActivity) {
  return activity.type === "multiple_choice" || activity.type === "free_response";
}

function isScaffoldEvidencePhase(phase: MethodPhase) {
  return SUPPORTED_PHASES.has(phase) || INDEPENDENT_PHASES.has(phase);
}

function sameConcept(left: string | null, right: string) {
  return left?.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}
