import { z } from "zod";
import type { ConceptEvidence, SessionCompletion } from "@/lib/domain";
import { METHOD_PHASES } from "@/lib/learning/method-fidelity";

export const ConceptEvidenceSchema = z.object({
  routeRevisionId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
  concept: z.string().trim().min(2).max(120),
  outcome: z.enum(["secure", "needs_review"]),
  activityType: z.enum(["multiple_choice", "free_response"]),
  methodPhase: z.enum(METHOD_PHASES).optional(),
  attempt: z.union([z.literal(1), z.literal(2)]).optional(),
  misconceptionSummary: z.string().trim().min(8).max(300).optional(),
});

export const ConceptEvidenceListSchema = z.array(ConceptEvidenceSchema).max(24);

/**
 * A pre-instruction prediction is useful method context, but it is not
 * mastery, gap, or method-outcome evidence. Keep this boundary shared by
 * live completion, restored history, map projection, and adaptation inputs so
 * an old or forged pretest entry cannot advance the learning state.
 */
export function conceptEvidenceMayUpdateLearningState(
  evidence: Pick<ConceptEvidence, "methodPhase">,
) {
  return evidence.methodPhase !== "pretest";
}

export function learningStateConceptEvidence(
  evidence: readonly ConceptEvidence[],
) {
  return evidence.filter(conceptEvidenceMayUpdateLearningState);
}

export type ConceptSignal = {
  topicId?: string;
  /** Exact route behind the latest observation when route provenance exists. */
  lastRouteRevisionId?: string;
  concept: string;
  attempts: number;
  secureAttempts: number;
  needsReviewAttempts: number;
  lastOutcome: ConceptEvidence["outcome"];
  lastObservedAt: string;
  status: "early_signal" | "needs_review" | "showing_strength";
  misconceptionSummary?: string;
};

export function readConceptEvidenceProperty(resultData: unknown): ConceptEvidence[] {
  if (!resultData || typeof resultData !== "object" || Array.isArray(resultData)) return [];
  const candidate = (resultData as Record<string, unknown>).conceptEvidence;
  const parsed = ConceptEvidenceListSchema.safeParse(candidate);
  return parsed.success ? learningStateConceptEvidence(parsed.data) : [];
}

export function summarizeConceptEvidence(
  completions: Array<Pick<SessionCompletion, "completedAt" | "conceptEvidence">>,
): ConceptSignal[] {
  const signals = new Map<string, Omit<ConceptSignal, "status">>();

  for (const completion of [...completions].sort((left, right) => left.completedAt.localeCompare(right.completedAt))) {
    for (const evidence of completion.conceptEvidence ?? []) {
      if (!conceptEvidenceMayUpdateLearningState(evidence)) continue;
      const concept = evidence.concept.trim().replace(/\s+/g, " ");
      if (!concept) continue;
      const key = evidence.topicId ?? concept.toLocaleLowerCase();
      const current = signals.get(key);
      signals.set(key, {
        ...(evidence.topicId ? { topicId: evidence.topicId } : current?.topicId ? { topicId: current.topicId } : {}),
        ...(evidence.routeRevisionId ? { lastRouteRevisionId: evidence.routeRevisionId } : {}),
        concept,
        attempts: (current?.attempts ?? 0) + 1,
        secureAttempts: (current?.secureAttempts ?? 0) + (evidence.outcome === "secure" ? 1 : 0),
        needsReviewAttempts: (current?.needsReviewAttempts ?? 0) + (evidence.outcome === "needs_review" ? 1 : 0),
        lastOutcome: evidence.outcome,
        lastObservedAt: completion.completedAt,
        ...(evidence.outcome === "needs_review" && evidence.misconceptionSummary
          ? { misconceptionSummary: evidence.misconceptionSummary }
          : current?.misconceptionSummary
            ? { misconceptionSummary: current.misconceptionSummary }
            : {}),
      });
    }
  }

  return [...signals.values()]
    .map((signal): ConceptSignal => ({
      ...signal,
      status: signal.lastOutcome === "needs_review"
        ? "needs_review"
        : signal.attempts >= 2 && signal.secureAttempts >= 2
          ? "showing_strength"
          : "early_signal",
    }))
    .sort((left, right) => {
      const priority = { needs_review: 0, early_signal: 1, showing_strength: 2 };
      return priority[left.status] - priority[right.status]
        || right.lastObservedAt.localeCompare(left.lastObservedAt);
    });
}
