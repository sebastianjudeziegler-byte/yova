import "server-only";

import { createHash } from "node:crypto";
import type { SessionAdjustment } from "@/lib/session-generation/schema";
import { sessionCacheScopeFingerprint } from "@/lib/session-generation/cache-contract";

export type SessionCacheContext = {
  effectiveMinutes: number;
  adjustmentFingerprint: string;
  contractFingerprint?: string;
  scopeFingerprint: string;
  routeRevisionId?: string;
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
  contractKey,
  routeRevisionId,
}: {
  plannedMinutes: number;
  adjustment: SessionAdjustment | null | undefined;
  /**
   * A privacy-safe canonical description of a versioned generation contract.
   * Only its hash is persisted. Omit it for contracts whose structural cache
   * validator is fully backward compatible.
   */
  contractKey?: string | null;
  routeRevisionId?: string | null;
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
    ...(contractKey ? {
      contractFingerprint: createHash("sha256").update(contractKey).digest("hex"),
    } : {}),
    scopeFingerprint: sessionCacheScopeFingerprint({
      plannedMinutes,
      adjustment,
      contractKey,
      routeRevisionId,
    }),
    ...(routeRevisionId ? { routeRevisionId } : {}),
  };
}

export function sessionCacheContextMatches(
  cached: SessionCacheContext | undefined,
  requested: SessionCacheContext,
) {
  return Boolean(
    cached
    && cached.effectiveMinutes === requested.effectiveMinutes
    && cached.adjustmentFingerprint === requested.adjustmentFingerprint
    && cached.scopeFingerprint === requested.scopeFingerprint
    && (
      requested.routeRevisionId === undefined
      || cached.routeRevisionId === requested.routeRevisionId
    )
    && (
      requested.contractFingerprint === undefined
      || cached.contractFingerprint === requested.contractFingerprint
    )
  );
}

/**
 * The route revision is duplicated at the generated-session boundary and in
 * its cache context on purpose. Reuse is safe only when both receipts name the
 * exact requested route. Legacy requests remain compatible with legacy cache
 * entries, but never inherit content that was authorized by a later route.
 */
export function sessionCacheRouteRevisionMatches(
  cachedSessionRouteRevisionId: string | undefined,
  cachedContextRouteRevisionId: string | undefined,
  requestedRouteRevisionId: string | undefined,
) {
  if (requestedRouteRevisionId === undefined) {
    return cachedSessionRouteRevisionId === undefined
      && cachedContextRouteRevisionId === undefined;
  }
  return cachedSessionRouteRevisionId === requestedRouteRevisionId
    && cachedContextRouteRevisionId === requestedRouteRevisionId;
}
