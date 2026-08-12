import "server-only";

import { createHash } from "node:crypto";
import type { SessionAdjustment } from "@/lib/session-generation/schema";

export type SessionCacheContext = {
  effectiveMinutes: number;
  adjustmentFingerprint: string;
};

/**
 * A plan session has one durable generated-session slot. Bind that slot to the
 * exact request that produced it so a custom 20-minute lesson can never be
 * reused later as the default 25-minute lesson (or after a different note).
 * Only the hash is stored; learner directions are not copied into cache metadata.
 */
export function buildSessionCacheContext({
  plannedMinutes,
  adjustment,
}: {
  plannedMinutes: number;
  adjustment: SessionAdjustment | null | undefined;
}): SessionCacheContext {
  const effectiveMinutes = adjustment?.availableMinutes ?? plannedMinutes;
  const canonicalAdjustment = adjustment
    ? {
      familiarity: adjustment.familiarity,
      availableMinutes: effectiveMinutes,
      knownTargets: [...adjustment.knownTargets].map((target) => target.trim()).sort(),
      note: adjustment.note.trim(),
    }
    : {
      familiarity: "as_planned",
      availableMinutes: effectiveMinutes,
      knownTargets: [],
      note: "",
    };
  return {
    effectiveMinutes,
    adjustmentFingerprint: createHash("sha256")
      .update(JSON.stringify(canonicalAdjustment))
      .digest("hex"),
  };
}

export function sessionCacheContextMatches(
  cached: SessionCacheContext | undefined,
  requested: SessionCacheContext,
) {
  return Boolean(
    cached
    && cached.effectiveMinutes === requested.effectiveMinutes
    && cached.adjustmentFingerprint === requested.adjustmentFingerprint,
  );
}
