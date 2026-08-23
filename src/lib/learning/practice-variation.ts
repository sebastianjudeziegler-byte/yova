import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import type { ConceptSignal } from "@/lib/learning/concept-evidence";
import type { MethodPhase } from "@/lib/learning/method-fidelity";
import type { ScaffoldProgressionSignal } from "@/lib/learning/scaffold-progression";
import type { TopicCalibrationSignal } from "@/lib/learning/confidence-calibration";

export const PRACTICE_INTENTS = [
  "baseline",
  "develop_gap",
  "light_verification",
  "misconception_discrimination",
  "supported_recheck",
  "independent_transfer",
] as const;

export type PracticeIntent = (typeof PRACTICE_INTENTS)[number];

export type TopicPracticeDirective = {
  topicId: string;
  concept: string;
  evidenceStatus: "unknown" | "gap" | "developing" | "secure";
  priorityWeight: number;
  requiredCheck: boolean;
  requiredIntent: PracticeIntent;
  openingSupport: "normal" | "supported" | "independent";
  misconceptionSummary: string | null;
  calibrationFeedback: string | null;
  reason: string;
};

export type PracticeVariationContract = {
  directives: TopicPracticeDirective[];
  maximumChecks: number;
};

type PracticeActivity = {
  topicId: string | null;
  methodPhase: MethodPhase;
  type: "instruction" | "multiple_choice" | "free_response" | "reflection";
  practiceIntent?: PracticeIntent | null;
  misconceptionSummary?: string | null;
};

export type PracticeIntentReconciliation<T extends PracticeActivity> = {
  activities: T[];
  repairedCount: number;
};

export function buildPracticeVariationContract({
  topics,
  conceptSignals,
  scaffoldSignals,
  calibrationSignals,
  maximumChecks,
}: {
  topics: KnowledgeMapTopic[];
  conceptSignals: ConceptSignal[];
  scaffoldSignals: ScaffoldProgressionSignal[];
  calibrationSignals: TopicCalibrationSignal[];
  maximumChecks: number;
}): PracticeVariationContract {
  const directives = topics.map((topic): TopicPracticeDirective => {
    const conceptSignal = findByTopicOrConcept(conceptSignals, topic);
    const scaffoldSignal = findByTopicOrConcept(scaffoldSignals, topic);
    const calibration = findByTopicOrConcept(calibrationSignals, topic);
    const misconceptionSummary = calibration?.misconceptionSummary
      ?? conceptSignal?.misconceptionSummary
      ?? null;
    const confidentMisconception = calibration?.highConfidenceMisses
      ? calibration.highConfidenceMisses > 0
      : false;
    const evidenceStatus = topic.status === "secure" || conceptSignal?.status === "showing_strength"
      ? "secure"
      : topic.initialEvidence?.outcome === "gap" || conceptSignal?.status === "needs_review"
        ? "gap"
        : topic.status === "taught" || topic.status === "evidenced" || conceptSignal?.status === "early_signal"
          ? "developing"
          : "unknown";

    if (confidentMisconception) {
      return {
        topicId: topic.id,
        concept: conceptSignal?.concept ?? calibration?.concept ?? topic.title,
        evidenceStatus: "gap",
        priorityWeight: 120,
        requiredCheck: false,
        requiredIntent: "misconception_discrimination",
        openingSupport: scaffoldSignal?.status === "restore_support" ? "supported" : "normal",
        misconceptionSummary,
        calibrationFeedback: calibration?.feedback ?? null,
        reason: misconceptionSummary
          ? `A confident response showed this specific distinction needs repair: ${misconceptionSummary}`
          : "A confident response did not hold up, so this topic needs a direct discrimination check.",
      };
    }

    if (scaffoldSignal?.status === "restore_support") {
      return {
        topicId: topic.id,
        concept: scaffoldSignal.concept,
        evidenceStatus: "gap",
        priorityWeight: 110,
        requiredCheck: false,
        requiredIntent: "supported_recheck",
        openingSupport: "supported",
        misconceptionSummary,
        calibrationFeedback: calibration?.feedback ?? null,
        reason: "The latest check still showed a gap, so YOVA must restore brief support before checking again.",
      };
    }

    if (evidenceStatus === "gap") {
      return {
        topicId: topic.id,
        concept: conceptSignal?.concept ?? topic.title,
        evidenceStatus,
        priorityWeight: 100,
        requiredCheck: false,
        requiredIntent: "develop_gap",
        openingSupport: "normal",
        misconceptionSummary,
        calibrationFeedback: calibration?.feedback ?? null,
        reason: "Completed evidence shows a gap, so this topic receives the session's strongest practice weight.",
      };
    }

    if (scaffoldSignal?.status === "independent_transfer") {
      return {
        topicId: topic.id,
        concept: scaffoldSignal.concept,
        evidenceStatus: "secure",
        priorityWeight: 35,
        requiredCheck: false,
        requiredIntent: "independent_transfer",
        openingSupport: "independent",
        misconceptionSummary: null,
        calibrationFeedback: calibration?.feedback ?? null,
        reason: "Repeated independent success calls for a different transfer task, not more guided repetition.",
      };
    }

    if (evidenceStatus === "secure") {
      return {
        topicId: topic.id,
        concept: conceptSignal?.concept ?? topic.title,
        evidenceStatus,
        priorityWeight: 20,
        requiredCheck: false,
        requiredIntent: "light_verification",
        openingSupport: "independent",
        misconceptionSummary: null,
        calibrationFeedback: calibration?.feedback ?? null,
        reason: "Prior evidence is secure enough for one light verification instead of repeated full practice.",
      };
    }

    return {
      topicId: topic.id,
      concept: conceptSignal?.concept ?? topic.title,
      evidenceStatus,
      priorityWeight: evidenceStatus === "developing" ? 70 : 60,
      requiredCheck: false,
      requiredIntent: "baseline",
      openingSupport: scaffoldSignal?.status === "fade_support" ? "independent" : "normal",
      misconceptionSummary: null,
      calibrationFeedback: calibration?.feedback ?? null,
      reason: evidenceStatus === "developing"
        ? "This topic has early evidence but still needs a current check."
        : "YOVA needs a first bounded check before changing the amount of practice.",
    };
  }).sort((left, right) => right.priorityWeight - left.priorityWeight);

  const boundedMaximum = Math.max(1, Math.min(maximumChecks, 4));
  return {
    maximumChecks: boundedMaximum,
    directives: directives.map((directive, index) => ({
      ...directive,
      requiredCheck: index < boundedMaximum,
    })),
  };
}

export function validatePracticeVariation({
  contract,
  activities,
  isScheduledReview,
}: {
  contract: PracticeVariationContract;
  activities: PracticeActivity[];
  isScheduledReview: boolean;
}) {
  if (isScheduledReview) return null;

  for (const directive of contract.directives.filter((candidate) => candidate.requiredCheck)) {
    const checks = activities.filter((activity) => isKnowledgeCheck(activity) && activity.topicId === directive.topicId);
    if (checks.length === 0) {
      return `${directive.concept} is a required practice target but has no topic-linked knowledge check.`;
    }
    if (!checks.some((activity) => activity.practiceIntent === directive.requiredIntent)) {
      return `${directive.concept} needs a ${directive.requiredIntent.replaceAll("_", " ")} check based on its evidence.`;
    }
    if (directive.requiredIntent === "light_verification" && checks.length > 1) {
      return `${directive.concept} already has secure evidence, so it may receive only one light verification in this session.`;
    }
    if (directive.requiredIntent === "misconception_discrimination") {
      const discrimination = checks.find((activity) => (
        activity.practiceIntent === "misconception_discrimination"
        && activity.methodPhase === "discriminate"
      ));
      if (!discrimination) {
        return `${directive.concept} needs a discrimination question that directly separates the confident misconception from the correct model.`;
      }
      if (directive.misconceptionSummary && discrimination.misconceptionSummary !== directive.misconceptionSummary) {
        return `${directive.concept} must preserve the specific misconception context in its discrimination question.`;
      }
    }
    if (directive.openingSupport === "supported") {
      const firstCheckIndex = activities.findIndex((activity) => checks.includes(activity));
      const supportBefore = activities.some((activity, index) => (
        index < firstCheckIndex
        && (activity.methodPhase === "model" || activity.methodPhase === "guided_practice")
      ));
      if (!supportBefore) {
        return `${directive.concept} needs a brief model or guided step before its new independent check.`;
      }
    }
    if (directive.openingSupport === "independent") {
      const firstCheck = checks[0]!;
      if (!new Set<MethodPhase>(["retrieve", "explain", "independent_practice", "discriminate", "transfer"]).has(firstCheck.methodPhase)) {
        return `${directive.concept} has enough evidence to begin its next check without guided support.`;
      }
    }
  }

  return null;
}

/**
 * Reconciles provider-authored practice-intent labels with YOVA's
 * evidence-derived contract without changing any subject content or learning
 * phase. The intent is authoritative metadata, so ordinary baseline and gap
 * labels can be corrected directly. Intents that promise a particular
 * learning shape are corrected only when that shape already exists; the
 * semantic validator remains responsible for rejecting missing support,
 * repeated secure checks, and incomplete misconception discrimination.
 */
export function reconcilePracticeIntentMetadata<T extends PracticeActivity>({
  contract,
  activities,
}: {
  contract: PracticeVariationContract;
  activities: T[];
}): PracticeIntentReconciliation<T> {
  const directiveByTopicId = new Map(
    contract.directives.map((directive) => [directive.topicId, directive]),
  );
  const checksByTopicId = new Map<string, T[]>();
  for (const activity of activities) {
    if (!activity.topicId || !isKnowledgeCheck(activity)) continue;
    checksByTopicId.set(activity.topicId, [
      ...(checksByTopicId.get(activity.topicId) ?? []),
      activity,
    ]);
  }

  let repairedCount = 0;
  const reconciled = activities.map((activity, index) => {
    if (!activity.topicId || !isKnowledgeCheck(activity)) return activity;
    const directive = directiveByTopicId.get(activity.topicId);
    if (!directive) return activity;
    const intentAlreadyMatches = activity.practiceIntent === directive.requiredIntent;
    const staleMisconceptionSummary = directive.requiredIntent !== "misconception_discrimination"
      && activity.misconceptionSummary !== null
      && activity.misconceptionSummary !== undefined;
    if (intentAlreadyMatches && !staleMisconceptionSummary) return activity;
    if (
      !intentAlreadyMatches
      && !canReconcilePracticeIntent({
        activity,
        activityIndex: index,
        activities,
        directive,
        topicChecks: checksByTopicId.get(activity.topicId) ?? [],
      })
    ) return activity;

    repairedCount += 1;
    return {
      ...activity,
      practiceIntent: directive.requiredIntent,
      // Only a misconception-discrimination check may carry learner-specific
      // misconception evidence. When the server corrects any other intent,
      // discard stale or provider-invented text instead of preserving it as
      // though it were authoritative learner history.
      misconceptionSummary: directive.requiredIntent === "misconception_discrimination"
        ? activity.misconceptionSummary
        : null,
    };
  });

  return {
    activities: repairedCount > 0 ? reconciled : activities,
    repairedCount,
  };
}

function canReconcilePracticeIntent<T extends PracticeActivity>({
  activity,
  activityIndex,
  activities,
  directive,
  topicChecks,
}: {
  activity: T;
  activityIndex: number;
  activities: T[];
  directive: TopicPracticeDirective;
  topicChecks: T[];
}) {
  if (directive.requiredIntent === "misconception_discrimination") {
    return activity.methodPhase === "discriminate"
      && Boolean(directive.misconceptionSummary)
      && activity.misconceptionSummary === directive.misconceptionSummary;
  }
  if (directive.requiredIntent === "supported_recheck") {
    return activities.some((candidate, index) => (
      index < activityIndex
      && (candidate.methodPhase === "model" || candidate.methodPhase === "guided_practice")
    ));
  }
  if (directive.requiredIntent === "independent_transfer") {
    return new Set<MethodPhase>([
      "retrieve",
      "explain",
      "independent_practice",
      "discriminate",
      "transfer",
    ]).has(activity.methodPhase);
  }
  if (directive.requiredIntent === "light_verification") {
    // The validator permits one check only for secure knowledge. Relabeling
    // one of several checks would hide neither the over-practice nor its
    // underlying sequence problem, so leave all of them for strict rejection.
    return topicChecks.length === 1;
  }
  return true;
}

function findByTopicOrConcept<T extends { topicId?: string; concept: string }>(
  candidates: T[],
  topic: KnowledgeMapTopic,
) {
  const topicMatch = candidates.find((candidate) => candidate.topicId === topic.id);
  if (topicMatch) return topicMatch;
  const title = normalizeConcept(topic.title.replace(/^\d+(?:\.\d+)*\s+/, ""));
  return candidates.find((candidate) => normalizeConcept(candidate.concept) === title);
}

function normalizeConcept(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function isKnowledgeCheck(activity: PracticeActivity) {
  return activity.type === "multiple_choice" || activity.type === "free_response";
}
