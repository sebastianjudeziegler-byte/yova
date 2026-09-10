import "server-only";
import { issuePlanDraftReceipt, verifyPlanDraftReceipt } from "@/lib/server/plan-draft-receipt";

const PURPOSE = "yova.structured-plan-revision.v1";
const PREVIEW_ONLY_SECRET = "yova-local-development-plan-revision-only-v1";
const PREVIEW_USER = "00000000-0000-4000-8000-000000000001";
const LIFETIME_MS = 15 * 60_000;

type RevisionIdentity = { id: string; planId: string; baseRevisionId: string };
const contract = (proposal: RevisionIdentity) => ({ purpose: PURPOSE, proposalId: proposal.id, planId: proposal.planId, baseRevisionId: proposal.baseRevisionId });

/** Reuses draft canonicalization/key rotation with a distinct signed purpose.
 * The caller may enable preview only after the existing development-request
 * gate; the public request body never chooses this flag or the user binding. */
export function issuePlanRevisionProposalReceipt({ proposal, userId, developmentPreview, now, originalDraftExpiresAt }: {
  proposal: RevisionIdentity;
  userId: string | null;
  developmentPreview: boolean;
  now: Date;
  originalDraftExpiresAt?: string;
}) {
  if (!developmentPreview && !userId) throw new Error("Sign in before changing a plan.");
  const expiresAt = Math.min(now.getTime() + LIFETIME_MS, originalDraftExpiresAt ? Date.parse(originalDraftExpiresAt) : Infinity);
  return issuePlanDraftReceipt({ parsedPlan: proposal, normalizedGenerationContract: contract(proposal), authenticatedUserId: developmentPreview ? PREVIEW_USER : userId!, issuedAt: now, expiresAt }, developmentPreview ? { secrets: { current: PREVIEW_ONLY_SECRET } } : {});
}

export function verifyPlanRevisionProposalReceipt({ proposal, receipt, userId, developmentPreview, now }: {
  proposal: RevisionIdentity;
  receipt: string;
  userId: string | null;
  developmentPreview: boolean;
  now: Date;
}) {
  if (!developmentPreview && !userId) return { ok: false as const, reason: "unauthenticated" as const };
  return verifyPlanDraftReceipt({ parsedPlan: proposal, normalizedGenerationContract: contract(proposal), authenticatedUserId: developmentPreview ? PREVIEW_USER : userId!, receipt, now }, developmentPreview ? { secrets: { current: PREVIEW_ONLY_SECRET } } : {});
}
