import "server-only";
import type { z } from "zod";
import type { LearningPlan } from "@/lib/domain";
import { PlanRevisionApplyRequestSchema, type PlanRevisionProposal } from "@/lib/plan-revision/revision-schema";
import { PlanRevisionRequestError } from "@/lib/plan-revision/preview-service";
import { verifyPlanRevisionProposalReceipt } from "@/lib/plan-revision/proposal-receipt";
import { issuePlanDraftReceipt } from "@/lib/server/plan-draft-receipt";
import { normalizePlanDraftGenerationContract } from "@/lib/plan-generation/draft-contract";
import { loadActiveRevisionContext } from "@/lib/plan-revision/active-context";
import { applySessionRevisionPatches, mergeRevisionMapChanges, sessionRevisionPatches } from "@/lib/plan-revision/revision-patch";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export async function applyPlanRevision({ input, supabase, userId, developmentPreview, now }: {
  input: z.infer<typeof PlanRevisionApplyRequestSchema>;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null;
  userId: string | null; developmentPreview: boolean; now: Date;
}) {
  const proposal = input.proposal;
  if (proposal.contextKind === "development" && !developmentPreview) throw new PlanRevisionRequestError("Local snapshots cannot authorize saved plan changes.", 409);
  const verified = verifyPlanRevisionProposalReceipt({ proposal, receipt: input.proposalReceipt, userId, developmentPreview, now });
  if (!verified.ok || !proposal.canApply) throw new PlanRevisionRequestError("This preview expired or changed. Review a new preview before applying it.", 409);
  const receipt = { revisionId: proposal.revisionId, previousRevisionId: proposal.baseRevisionId,
    message: `${proposal.lines.map(line => line.description).join("; ")}; everything else unchanged.` };
  if (proposal.contextKind === "draft") {
    const draftReceipt = developmentPreview ? null : issuePlanDraftReceipt({
      parsedPlan: proposal.after,
      normalizedGenerationContract: normalizePlanDraftGenerationContract(proposal.generationRequest, proposal.after),
      authenticatedUserId: userId!, issuedAt: proposal.draftReceiptIssuedAt!, expiresAt: proposal.draftReceiptExpiresAt!,
    }).receipt;
    return { status: "applied", plan: proposal.after, generationRequest: proposal.generationRequest, draftReceipt, receipt };
  }
  if (proposal.contextKind === "development") return { status: "applied", plan: commitPlanStudyRoutes(proposal.after as LearningPlan, now.toISOString()), generationRequest: proposal.generationRequest, receipt };
  if (!supabase || !userId) throw new PlanRevisionRequestError("Sign in before saving the plan.", 401);
  const current = await loadActiveRevisionContext(supabase, proposal.planId);
  // The database acknowledges exact retries even if a response was lost and
  // unrelated work has since completed. The returned plan is always current.
  const prior = await supabase.from("plan_revisions").select("receipt").eq("id", proposal.id).eq("user_id", userId).maybeSingle();
  if (prior.error) throw new PlanRevisionRequestError("The saved revision could not be verified. Try again.", 503);
  if (prior.data) return { status: "applied", plan: current.plan, receipt: prior.data.receipt, changedSessionIds: sessionRevisionPatches(proposal.before as LearningPlan, proposal.after as LearningPlan).map(patch => patch.id) };
  if ((current.plan.revisionId ?? current.plan.id) !== proposal.baseRevisionId) throw new PlanRevisionRequestError("The plan changed after this preview. Review its latest revision.", 409);
  return persistAcceptedPlanRevision({ proposal, current, supabase, userId, now, receipt });
}

/** Shared atomic writer for an accepted delta and its authenticated inverse. */
export async function persistAcceptedPlanRevision({ proposal, current, supabase, userId, now, receipt, undo = false }: {
  proposal: PlanRevisionProposal; current: Awaited<ReturnType<typeof loadActiveRevisionContext>>;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; userId: string; now: Date;
  receipt: { revisionId: string; previousRevisionId: string; message: string }; undo?: boolean;
}) {
  const patches = sessionRevisionPatches(proposal.before as LearningPlan, proposal.after as LearningPlan);
  const sessions = applySessionRevisionPatches({ current: current.plan.sessions as LearningPlan["sessions"], patches,
    protectedSessionIds: new Set(current.protections.filter(item => item.savedWork && !(undo && current.plan.sessions.find(session => session.id === item.sessionId)?.status === "skipped")).map(item => item.sessionId)) });
  const knowledgeMap = mergeRevisionMapChanges({ before: proposal.before.knowledgeMap!, after: proposal.after.knowledgeMap!, current: current.plan.knowledgeMap!, undoAddedTopics: undo });
  if (proposal.before.deadline !== proposal.after.deadline && current.plan.deadline !== proposal.before.deadline) throw new PlanRevisionRequestError("The deadline changed after this preview. Review it again.", 409);
  const next = commitPlanStudyRoutes({ ...current.plan, revisionId: proposal.revisionId, knowledgeMap, sessions,
    deadline: proposal.after.deadline, schedulePreferences: proposal.after.schedulePreferences } as LearningPlan, now.toISOString());
  const result = await createSupabaseAdminClient().rpc("apply_plan_revision", { actor_user_id: userId, payload: {
    operationId: proposal.id, planId: proposal.planId, expectedRevisionId: proposal.baseRevisionId,
    revisionId: proposal.revisionId, expectedMap: current.plan.knowledgeMap,
    knowledgeMap, deadline: next.deadline, generationRequest: proposal.generationRequest,
    sessions: patches.map(patch => ({ id: patch.id, beforeFingerprint: proposal.sessionFingerprints[patch.id] ?? null,
      after: next.sessions.find(session => session.id === patch.id) ?? null })),
    fixedEvents: proposal.fixedEvents, proposal, receipt,
  } });
  if (result.error) throw new PlanRevisionRequestError("The change could not be saved. Your saved work has been kept; refresh the preview or retry.", result.error.code === "40001" ? 409 : 503);
  const saved = await loadActiveRevisionContext(supabase, proposal.planId);
  return { status: "applied", plan: saved.plan, receipt, changedSessionIds: patches.map(patch => patch.id) };
}
