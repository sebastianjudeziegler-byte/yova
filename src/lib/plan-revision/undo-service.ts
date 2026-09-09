import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import type { LearningPlan } from "@/lib/domain";
import { makeUuid } from "@/lib/domain";
import { PlanRevisionUndoRequestSchema, PlanRevisionProposalSchema, type PlanRevisionProposal } from "@/lib/plan-revision/revision-schema";
import { verifyPlanRevisionProposalReceipt } from "@/lib/plan-revision/proposal-receipt";
import { PlanRevisionRequestError } from "@/lib/plan-revision/preview-service";
import { applySessionRevisionPatches, mergeRevisionMapChanges, sessionRevisionPatches } from "@/lib/plan-revision/revision-patch";
import { loadActiveRevisionContext } from "@/lib/plan-revision/active-context";
import { persistAcceptedPlanRevision } from "@/lib/plan-revision/apply-service";
import { createSuccessorStudyRoute, hasMaterialStudyRouteChange } from "@/lib/study-route/revisions";
import { StudyRouteSchema } from "@/lib/study-route/schema";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { issuePlanDraftReceipt } from "@/lib/server/plan-draft-receipt";
import { normalizePlanDraftGenerationContract } from "@/lib/plan-generation/draft-contract";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export async function undoPlanRevision({ input, supabase, userId, developmentPreview, now }: {
  input: z.infer<typeof PlanRevisionUndoRequestSchema>;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null;
  userId: string | null; developmentPreview: boolean; now: Date;
}) {
  let original: PlanRevisionProposal;
  let current: LearningPlan;
  let active: Awaited<ReturnType<typeof loadActiveRevisionContext>> | null = null;
  if (input.proposal) {
    if (input.proposal.contextKind === "active" || (input.proposal.contextKind === "development" && !developmentPreview)
      || !verifyPlanRevisionProposalReceipt({ proposal: input.proposal, receipt: input.proposalReceipt ?? "", userId, developmentPreview, now }).ok) {
      throw new PlanRevisionRequestError("This Undo no longer matches its signed change. Reload the saved revision.", 409);
    }
    original = input.proposal;
    current = (original.contextKind === "draft" ? original.after : input.developmentPlan) as LearningPlan;
    if (!current) throw new PlanRevisionRequestError("Reload the current plan before Undo.", 409);
  } else {
    if (!supabase || !userId) throw new PlanRevisionRequestError("Sign in before restoring a saved revision.", 401);
    active = await loadActiveRevisionContext(supabase, input.planId);
    const history = await supabase.from("plan_revisions").select("proposal").eq("user_id", userId).eq("plan_id", input.planId).eq("id", input.expectedRevisionId).maybeSingle();
    if (history.error || !history.data) throw new PlanRevisionRequestError("The revision to restore could not be loaded. Nothing was changed.", 409);
    original = PlanRevisionProposalSchema.parse(history.data.proposal);
    current = active.plan as LearningPlan;
  }
  if (original.planId !== input.planId || original.revisionId !== input.expectedRevisionId || (current.revisionId ?? current.id) !== original.revisionId) throw new PlanRevisionRequestError("A newer revision is already saved. Undo will not overwrite it.", 409);
  const patches = sessionRevisionPatches(original.before as LearningPlan, original.after as LearningPlan).map(patch => {
    const live = current.sessions.find(session => session.id === patch.id);
    // Activation commits the reviewed provisional identity. Verify every
    // material field against that exact identity, then use the committed view
    // as the expected preimage; do not mistake commit metadata for an edit.
    const before = patch.after && live && live.studyRoute?.identity.routeRevisionId === patch.after.studyRoute?.identity.routeRevisionId
      ? { ...patch.after, studyRoute: live.studyRoute } as LearningPlan["sessions"][number] : patch.after;
    let after = patch.before;
    if (after?.studyRoute && live?.studyRoute?.identity.lifecycleStatus === "committed" && original.contextKind !== "draft") {
      const previous = live.studyRoute;
      const restored = after.studyRoute;
      const route = hasMaterialStudyRouteChange(previous, restored) ? StudyRouteSchema.parse(createSuccessorStudyRoute({
        previous, routeRevisionId: makeUuid(), createdAt: new Date(Math.max(now.getTime(), Date.parse(previous.identity.committedAt ?? previous.identity.createdAt))).toISOString(),
        changeReason: "The learner undid the reviewed topic or calendar change.",
        changes: { target: restored.target, approach: restored.approach, timing: restored.timing, execution: restored.execution, agency: restored.agency, explanation: restored.explanation },
      })) : previous;
      after = { ...after, studyRoute: route };
    }
    return { id: patch.id, before, after };
  });
  const sessions = applySessionRevisionPatches({ current: current.sessions, patches, protectedSessionIds: new Set(active?.protections.filter(item => item.savedWork && current.sessions.find(session => session.id === item.sessionId)?.status !== "skipped").map(item => item.sessionId) ?? []) });
  const knowledgeMap = mergeRevisionMapChanges({ before: original.after.knowledgeMap!, after: original.before.knowledgeMap!, current: current.knowledgeMap!, undoAddedTopics: true });
  const restored = { ...current, knowledgeMap, sessions, deadline: original.before.deadline, schedulePreferences: original.before.schedulePreferences, revisionId: original.baseRevisionId };
  const generationRequest = { ...original.generationRequest, knowledgeMap, deadline: restored.deadline,
    ...(restored.schedulePreferences ? restored.schedulePreferences : {}) };
  const receipt = { revisionId: original.baseRevisionId, previousRevisionId: original.revisionId, message: "Previous revision restored; everything else unchanged." };
  if (original.contextKind === "draft") {
    const draftReceipt = developmentPreview ? null : issuePlanDraftReceipt({ parsedPlan: restored,
      normalizedGenerationContract: normalizePlanDraftGenerationContract(generationRequest, restored), authenticatedUserId: userId!,
      issuedAt: original.draftReceiptIssuedAt!, expiresAt: original.draftReceiptExpiresAt! }).receipt;
    return { status: "undone", plan: restored, generationRequest, draftReceipt, receipt };
  }
  if (original.contextKind === "development") return { status: "undone", plan: commitPlanStudyRoutes(restored, now.toISOString()), receipt };
  const hex = createHash("sha256").update(`undo-plan-revision:${original.id}`).digest("hex");
  const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
  const inverse = PlanRevisionProposalSchema.parse({ ...original, id, revisionId: original.baseRevisionId, baseRevisionId: original.revisionId,
    before: current, after: restored, generationRequest, sessionFingerprints: active!.sessionFingerprints });
  return persistAcceptedPlanRevision({ proposal: inverse, current: active!, supabase: supabase!, userId: userId!, now, receipt, undo: true });
}
