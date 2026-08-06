import { z } from "zod";
import type { ConceptEvidence, SessionCompletion } from "@/lib/domain";
import { METHOD_PHASES } from "@/lib/learning/method-fidelity";

export const ConceptEvidenceSchema = z.object({
  concept: z.string().trim().min(2).max(120),
  outcome: z.enum(["secure", "needs_review"]),
  activityType: z.enum(["multiple_choice", "free_response"]),
  methodPhase: z.enum(METHOD_PHASES).optional(),
});

export const ConceptEvidenceListSchema = z.array(ConceptEvidenceSchema).max(24);

export type ConceptSignal = {
  concept: string;
  attempts: number;
  secureAttempts: number;
  needsReviewAttempts: number;
  lastOutcome: ConceptEvidence["outcome"];
  lastObservedAt: string;
  status: "early_signal" | "needs_review" | "showing_strength";
};

export function readConceptEvidenceProperty(resultData: unknown): ConceptEvidence[] {
  if (!resultData || typeof resultData !== "object" || Array.isArray(resultData)) return [];
  const candidate = (resultData as Record<string, unknown>).conceptEvidence;
  const parsed = ConceptEvidenceListSchema.safeParse(candidate);
  return parsed.success ? parsed.data : [];
}

export function summarizeConceptEvidence(
  completions: Array<Pick<SessionCompletion, "completedAt" | "conceptEvidence">>,
): ConceptSignal[] {
  const signals = new Map<string, Omit<ConceptSignal, "status">>();

  for (const completion of [...completions].sort((left, right) => left.completedAt.localeCompare(right.completedAt))) {
    for (const evidence of completion.conceptEvidence ?? []) {
      const concept = evidence.concept.trim().replace(/\s+/g, " ");
      if (!concept) continue;
      const key = concept.toLocaleLowerCase();
      const current = signals.get(key);
      signals.set(key, {
        concept,
        attempts: (current?.attempts ?? 0) + 1,
        secureAttempts: (current?.secureAttempts ?? 0) + (evidence.outcome === "secure" ? 1 : 0),
        needsReviewAttempts: (current?.needsReviewAttempts ?? 0) + (evidence.outcome === "needs_review" ? 1 : 0),
        lastOutcome: evidence.outcome,
        lastObservedAt: completion.completedAt,
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
