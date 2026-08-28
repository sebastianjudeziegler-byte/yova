import "server-only";

import type { SessionEvidenceSnapshot } from "@/lib/domain";
import { ConceptEvidenceListSchema } from "@/lib/learning/concept-evidence";
import {
  readDisabledBlurtingRepositoryExecutionCapabilityV18,
  type DisabledBlurtingRepositoryExecutionCapabilityV18,
} from "@/lib/server/disabled-blurting-private-resource-v18";
import {
  readDisabledBlurtingVerifiedCompletionContextV18,
  type DisabledBlurtingVerifiedCompletionContextV18,
} from "@/lib/server/disabled-blurting-verified-completion-v18";

export type DisabledBlurtingVerifiedEvidenceSummaryV18 = DeepReadonly<
  SessionEvidenceSnapshot
>;

/**
 * The only Blurting ConceptEvidence derivation seam.
 *
 * Its first parameter is intentionally the branded value returned by the
 * repository-joined verified-completion constructor. The branded reader is
 * invoked again against the same opaque repository execution capability.
 * Target order and canonical concept text come only from its private resource;
 * no caller-authored expectation can attribute evidence. Browser progress, a
 * bare result vector, public DTO, or raw resource JSON cannot satisfy this API.
 */
export function deriveDisabledBlurtingVerifiedTransferEvidenceV18(
  verifiedCompletionValue: DisabledBlurtingVerifiedCompletionContextV18,
  capabilityValue: DisabledBlurtingRepositoryExecutionCapabilityV18,
): DisabledBlurtingVerifiedEvidenceSummaryV18 | null {
  const capability = readDisabledBlurtingRepositoryExecutionCapabilityV18(
    capabilityValue,
  );
  if (
    !capability
    || capability.deliveryReceipt.state !== "completed"
    || capability.deliveryReceipt.disclosureStage !== "complete"
  ) {
    return null;
  }
  const targets = capability.resource.session.orderedTargets;
  const delivery = capability.deliveryReceipt;
  const row = capability.loadedResourceRow;
  const publicTargets = row.publicPayload.orderedTargets;
  if (!sameOrderedBindings(targets, publicTargets)) return null;
  const identity = {
    planId: row.routeIdentity.planId,
    sessionId: row.routeIdentity.sessionId,
    routeRevisionId: row.routeIdentity.routeRevisionId,
    resourceFingerprint: row.resourceFingerprint,
    resourceGeneratedAt: row.resourceGeneratedAt,
    deliveryHandle: delivery.deliveryHandle,
    runId: delivery.runId,
    activityIndex: delivery.activityIndex,
  };

  const verifiedCompletion = readDisabledBlurtingVerifiedCompletionContextV18(
    verifiedCompletionValue,
    {
      userId: row.userId,
      identity,
      resourceIdentity: {
        resourceId: row.resourceId,
        resourceFingerprint: row.resourceFingerprint,
        resourceGeneratedAt: row.resourceGeneratedAt,
        resourceDigest: row.resourceDigest,
      },
      orderedBindings: publicTargets.map((target) => ({
        targetId: target.targetId,
        evidenceId: target.evidenceId,
      })),
    },
  );
  if (!verifiedCompletion) return null;

  const parsedEvidence = ConceptEvidenceListSchema.safeParse(
    targets.map((target, index) => ({
      routeRevisionId: identity.routeRevisionId,
      topicId: target.targetId,
      concept: target.concept,
      outcome: verifiedCompletion.orderedResults[index]?.result === "secure"
        ? "secure"
        : "needs_review",
      activityType: "free_response",
      methodPhase: "transfer",
    })),
  );
  if (!parsedEvidence.success) return null;

  const needsReviewConcepts = parsedEvidence.data
    .filter((evidence) => evidence.outcome === "needs_review")
    .map((evidence) => evidence.concept);

  return deepFreeze({
    correctAnswers: verifiedCompletion.orderedResults.filter((result) => (
      result.result === "secure"
    )).length,
    totalAnswers: verifiedCompletion.orderedResults.length,
    conceptEvidence: parsedEvidence.data,
    confidenceEvidence: [],
    observedGap: needsReviewConcepts.length > 0
      ? `Transfer needs another check: ${needsReviewConcepts.join("; ")}`
      : "No major gap detected in the required transfer check",
    completedImmediateRepairs: 0,
  });
}

function sameOrderedBindings(
  left: readonly { targetId: string; evidenceId: string }[],
  right: readonly { targetId: string; evidenceId: string }[],
) {
  return left.length === right.length
    && left.every((binding, index) => (
      binding.targetId === right[index]?.targetId
      && binding.evidenceId === right[index]?.evidenceId
    ));
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
