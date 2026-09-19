import type { PlanRevisionProposal } from "@/lib/plan-revision/revision-schema";

/**
 * Spec section 5: an inline change keeps its receipt and Undo until the next
 * change. Brief 2.5 finding 16: both lived only in memory, so a reload lost
 * them. This keeps the last inline change per account in the browser. A signed
 * proposal is kept only for browser-preview plans, whose Undo needs it; a saved
 * plan's Undo needs only its plan and revision ids.
 */
export type LastPlanRevision = { planId: string; revisionId: string; message: string; undone?: boolean; signed?: { proposal: PlanRevisionProposal; proposalReceipt: string } };

const KEY = "yova.lastPlanRevision.v1";

export function loadLastPlanRevision(storage: Storage | undefined, accountId: string): LastPlanRevision | null {
  try {
    const stored = JSON.parse(storage?.getItem(KEY) ?? "null") as ({ accountId?: string } & LastPlanRevision) | null;
    if (!stored || stored.accountId !== accountId || typeof stored.planId !== "string" || typeof stored.revisionId !== "string" || typeof stored.message !== "string") return null;
    return { planId: stored.planId, revisionId: stored.revisionId, message: stored.message, ...(stored.undone ? { undone: true } : {}), ...(stored.signed ? { signed: stored.signed } : {}) };
  } catch {
    return null;
  }
}

export function saveLastPlanRevision(storage: Storage | undefined, accountId: string, revision: LastPlanRevision | null) {
  try {
    if (!revision) storage?.removeItem(KEY);
    else storage?.setItem(KEY, JSON.stringify({ accountId, ...revision }));
  } catch {
    // Browser storage can be unavailable; the receipt still shows until reload.
  }
}

/** Shown after a reload only while the plan is still at the revision it describes. */
export function lastRevisionStillCurrent(revision: LastPlanRevision, plans: readonly { id: string; revisionId?: string }[]) {
  const plan = plans.find(candidate => candidate.id === revision.planId);
  return Boolean(plan && !revision.undone && (plan.revisionId ?? plan.id) === revision.revisionId);
}
