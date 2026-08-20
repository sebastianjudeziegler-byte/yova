import {
  CORE_METHOD_CATALOG,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import type { MethodOutcomeSignal } from "@/lib/personalization/method-outcomes";

/**
 * Ranks methods that are *already* valid for the task and knowledge stage.
 *
 * The task type and knowledge stage decide which methods a learner may receive.
 * This module never widens that set. It only orders the survivors, so a stated
 * preference or an observed result can choose between options that are all
 * defensible for the current objective. That separation is deliberate: a
 * learner who prefers working from examples should not be handed a worked
 * example for content they have never read.
 */

export type MethodFitSource = "declared" | "observed";

export type MethodFitSignal = {
  methodId: CoreMethodId;
  source: MethodFitSource;
  weight: number;
  /** Learner-facing fragment, written so it can follow "because". */
  reason: string;
};

export type MethodFitScore = {
  methodId: CoreMethodId;
  methodName: string;
  baselineRank: number;
  baselineScore: number;
  declaredScore: number;
  observedScore: number;
  total: number;
  signals: MethodFitSignal[];
};

export type MethodFitRanking = {
  orderedMethodIds: CoreMethodId[];
  selectedMethodId: CoreMethodId;
  baselineMethodId: CoreMethodId;
  /** True when a learner signal moved a different method into first place. */
  changedFromBaseline: boolean;
  learnerFacingReason: string | null;
  scores: MethodFitScore[];
};

export type DeclaredProfileText = {
  commonBlocker?: string | null;
  guidancePreference?: string | null;
  explanationPreference?: string | null;
  focusFrequency?: string | null;
  startingPattern?: string | null;
  primaryImprovementGoal?: string | null;
  processingPreference?: string | null;
  memoryChallenge?: string | null;
  supportPreference?: string | null;
  workspacePreference?: string | null;
  freeformContext?: string | null;
  observationCorrection?: string | null;
} | null;

/**
 * Weight constants live here rather than inline so routing behaviour can be
 * tuned and reviewed in one place.
 */
export const METHOD_FIT_WEIGHTS = {
  /**
   * Catalog order breaks ties and nudges, but must stay small enough that a
   * stated preference can still reach a method two or three places down. Every
   * method in the list is already valid for the task, so this is an ordering
   * hint rather than a ranking that needs defending.
   */
  baselineStep: 0.25,
  declaredMatch: 0.6,
  declaredCap: 1.8,
  /** Full-evidence observed weight intentionally exceeds the declared cap. */
  observedPromising: 2,
  observedEarly: 0.4,
  observedMixed: -0.3,
  observedNeedsSupport: -1,
  /**
   * One comparable session is an anecdote and carries no weight at all. Weight
   * ramps in from the second session and reaches full strength at the fourth,
   * so behaviour overtakes self-report only once it has actually repeated.
   */
  observedMinimumSessions: 2,
  observedFullEvidenceSessions: 4,
} as const;

type DeclaredAffinity = {
  pattern: RegExp;
  methodIds: CoreMethodId[];
  reason: string;
};

/**
 * Declared answers are matched against method affinities, not learning styles.
 * Each entry states an operational study tendency the learner reported and the
 * methods that tendency makes easier to start or finish.
 */
const DECLARED_AFFINITIES: DeclaredAffinity[] = [
  {
    pattern: /example|concrete|practical|show me how/i,
    methodIds: ["worked_example_fading", "self_explanation"],
    reason: "you said a concrete example helps you the most when something is new",
  },
  {
    pattern: /big picture|overview|whole|map first/i,
    methodIds: ["read_recall_review", "self_explanation"],
    reason: "you said you prefer seeing the whole picture before the details",
  },
  {
    pattern: /forget|cannot recall|can't recall|do not retain|don't retain|blank/i,
    methodIds: ["retrieval_practice", "spaced_retrieval"],
    reason: "you said material tends to fade after a few days",
  },
  {
    pattern: /confuse similar|similar ideas|mix (them |these )?up|tell.*apart/i,
    methodIds: ["interleaved_practice"],
    reason: "you said similar ideas run together for you",
  },
  {
    pattern: /cannot apply|can't apply|not independently|only with help|freeze/i,
    methodIds: ["worked_example_fading", "practice_test_error_repair"],
    reason: "you said you can follow along but stall when working alone",
  },
  {
    pattern: /explain|talk it through|out loud|teach/i,
    methodIds: ["self_explanation"],
    reason: "you said explaining something helps you find what you actually know",
  },
  {
    pattern: /least guidance|challenge|too easy|bored|independent/i,
    methodIds: ["practice_test_error_repair", "interleaved_practice"],
    reason: "you said you would rather be challenged than walked through",
  },
  {
    pattern: /structure|one step|clear steps|checklist|decide for me/i,
    methodIds: ["worked_example_fading", "scaffolded_coding"],
    reason: "you said an explicit sequence makes it easier to keep going",
  },
  {
    pattern: /mistake|error|wrong|get it wrong repeatedly/i,
    methodIds: ["practice_test_error_repair"],
    reason: "you said the same mistakes keep coming back",
  },
  {
    pattern: /read|textbook|chapter|notes|study guide/i,
    methodIds: ["read_recall_review"],
    reason: "you said you usually work from written source material",
  },
];

function declaredProfileText(profile: DeclaredProfileText) {
  if (!profile) return "";
  return Object.values(profile).filter(Boolean).join(" ");
}

/**
 * Observed evidence ramps in rather than switching on. A single comparable
 * session is a hint, not a finding, so it cannot outrank a stated preference
 * until enough sessions agree.
 */
function observedEvidenceWeight(sessions: number) {
  const { observedMinimumSessions, observedFullEvidenceSessions } = METHOD_FIT_WEIGHTS;
  if (sessions < observedMinimumSessions) return 0;
  const span = observedFullEvidenceSessions - observedMinimumSessions + 1;
  return Math.min((sessions - observedMinimumSessions + 1) / span, 1);
}

function observedStatusWeight(status: MethodOutcomeSignal["status"]) {
  switch (status) {
    case "promising":
      return METHOD_FIT_WEIGHTS.observedPromising;
    case "early_signal":
      return METHOD_FIT_WEIGHTS.observedEarly;
    case "mixed":
      return METHOD_FIT_WEIGHTS.observedMixed;
    case "needs_more_support":
      return METHOD_FIT_WEIGHTS.observedNeedsSupport;
    default:
      return 0;
  }
}

function observedReason(signal: MethodOutcomeSignal) {
  const name = signal.methodName.toLowerCase();
  switch (signal.status) {
    case "promising":
      return `your recent ${name} sessions went well on comparable work`;
    case "early_signal":
      return `${name} has an early positive signal for you on comparable work`;
    case "mixed":
      return `${name} has produced mixed results for you so far`;
    case "needs_more_support":
      return `${name} has needed more support than usual for you`;
    default:
      return `YOVA has some history with ${name} for you`;
  }
}

export type RankMethodsInput = {
  /** Methods already filtered to those valid for this task and stage. */
  eligibleMethodIds: readonly CoreMethodId[];
  declaredProfile: DeclaredProfileText;
  /** Outcome signals scoped to the comparable task type and knowledge stage. */
  observedSignals: readonly MethodOutcomeSignal[];
};

export function rankMethodsByLearnerFit(input: RankMethodsInput): MethodFitRanking | null {
  const eligible = [...new Set(input.eligibleMethodIds)];
  if (eligible.length === 0) return null;

  const baselineMethodId = eligible[0];
  const profileText = declaredProfileText(input.declaredProfile);
  const observedByMethod = new Map(
    input.observedSignals.map((signal) => [signal.methodId, signal] as const),
  );

  const scores: MethodFitScore[] = eligible.map((methodId, index) => {
    const signals: MethodFitSignal[] = [];
    const baselineScore = (eligible.length - index) * METHOD_FIT_WEIGHTS.baselineStep;

    let declaredScore = 0;
    if (profileText) {
      for (const affinity of DECLARED_AFFINITIES) {
        if (!affinity.methodIds.includes(methodId)) continue;
        if (!affinity.pattern.test(profileText)) continue;
        declaredScore += METHOD_FIT_WEIGHTS.declaredMatch;
        signals.push({
          methodId,
          source: "declared",
          weight: METHOD_FIT_WEIGHTS.declaredMatch,
          reason: affinity.reason,
        });
      }
    }
    declaredScore = Math.min(declaredScore, METHOD_FIT_WEIGHTS.declaredCap);

    let observedScore = 0;
    const observed = observedByMethod.get(methodId);
    if (observed) {
      const weight = observedStatusWeight(observed.status) * observedEvidenceWeight(observed.sessions);
      if (weight !== 0) {
        observedScore = weight;
        signals.push({
          methodId,
          source: "observed",
          weight,
          reason: observedReason(observed),
        });
      }
    }

    return {
      methodId,
      methodName: CORE_METHOD_CATALOG[methodId].name,
      baselineRank: index,
      baselineScore,
      declaredScore,
      observedScore,
      total: baselineScore + declaredScore + observedScore,
      signals,
    };
  });

  // Ties fall back to catalog order so identical inputs always route identically.
  const ordered = [...scores].sort((left, right) => (
    right.total - left.total || left.baselineRank - right.baselineRank
  ));
  const selected = ordered[0];
  const changedFromBaseline = selected.methodId !== baselineMethodId;

  return {
    orderedMethodIds: ordered.map((score) => score.methodId),
    selectedMethodId: selected.methodId,
    baselineMethodId,
    changedFromBaseline,
    learnerFacingReason: buildLearnerFacingReason(selected, changedFromBaseline),
    scores: ordered,
  };
}

/**
 * Only produces a sentence when a learner signal actually contributed. A method
 * chosen purely by task fit is explained by the existing routing rationale, and
 * repeating it here would imply personalization that did not happen.
 */
function buildLearnerFacingReason(selected: MethodFitScore, changedFromBaseline: boolean) {
  if (selected.signals.length === 0) return null;

  const observed = selected.signals.filter((signal) => signal.source === "observed");
  const declared = selected.signals.filter((signal) => signal.source === "declared");
  const leading = observed.length > 0 ? observed[0] : declared[0];
  const supporting = observed.length > 0 && declared.length > 0 ? declared[0] : null;

  const opening = changedFromBaseline
    ? `YOVA chose ${selected.methodName} over the other methods that fit this task because ${leading.reason}`
    : `${selected.methodName} also fits how you work, because ${leading.reason}`;

  return supporting ? `${opening}, and ${supporting.reason}.` : `${opening}.`;
}
