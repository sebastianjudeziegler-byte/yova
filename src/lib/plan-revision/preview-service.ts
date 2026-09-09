import "server-only";
import type { z } from "zod";
import type { LearningPlan } from "@/lib/domain";
import { PlanActivationRequestSchema, PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { normalizePlanDraftGenerationContract } from "@/lib/plan-generation/draft-contract";
import { verifyPlanDraftReceipt } from "@/lib/server/plan-draft-receipt";
import { issuePlanRevisionProposalReceipt } from "@/lib/plan-revision/proposal-receipt";
import { PlanRevisionPreviewRequestSchema } from "@/lib/plan-revision/revision-schema";
import { buildPlanRevision } from "@/lib/plan-revision/build-plan-revision";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { generateNormalPlanFillWithOpenAI } from "@/lib/openai/normal-plan-fill-generator";
import { isOpenAIPlanConfigured } from "@/lib/openai/config";
import { loadAuthorizedNormalDurationContext } from "@/lib/study-route/duration-context-server";
import { buildAuthorizedNormalDurationProfile } from "@/lib/study-route/duration-signals";
import { resolveServerPersonalizationRollout } from "@/lib/server/personalization-rollout";
import { GenerationPersonalizationContextSchema } from "@/lib/personalization/personalization-generation";
import { reserveAIRequest, settleAIRequestClaim } from "@/lib/server/ai-usage";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
export class PlanRevisionRequestError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}

export async function previewPlanRevision({ input, supabase, userId, developmentPreview, now }: {
  input: z.infer<typeof PlanRevisionPreviewRequestSchema>;
  supabase: Client | null; userId: string | null; developmentPreview: boolean; now: Date;
}) {
  const context = input.context;
  if (context.kind === "development" && !developmentPreview) throw new PlanRevisionRequestError("A local snapshot cannot authorize a saved plan change.");
  if (context.kind === "active") throw new PlanRevisionRequestError("The saved revision boundary is not yet available.", 503);
  let draftReceiptWindow: { issuedAt: string; expiresAt: string } | undefined;
  if (context.kind === "draft" && !developmentPreview) {
    const draft = PlanActivationRequestSchema.parse({ plan: context.plan, generationRequest: context.generationRequest, draftReceipt: context.draftReceipt });
    const verification = verifyPlanDraftReceipt({ parsedPlan: draft.plan,
      normalizedGenerationContract: normalizePlanDraftGenerationContract(draft.generationRequest, draft.plan),
      authenticatedUserId: userId!, receipt: context.draftReceipt ?? "", now });
    if (!verification.ok) throw new PlanRevisionRequestError("This draft no longer matches the signed version. Review a fresh draft.");
    draftReceiptWindow = verification.metadata;
  }
  const plan = context.plan as LearningPlan;
  if (context.kind === "development" && (plan.revisionId ?? plan.id) !== context.expectedRevisionId) throw new PlanRevisionRequestError("Review the latest plan revision before changing it.", 409);
  const request = PlanGenerationRequestSchema.parse(context.generationRequest ?? {
    intent: "plan", learningIntent: plan.learningIntent, goal: plan.title.length >= 10 ? plan.title : `Study ${plan.title} in this plan`,
    materialMode: plan.sourceMode === "user_materials" ? "upload" : "none", materials: plan.materials ?? [],
    studyMode: plan.studyMode === "outside_yova" ? "outside" : "inside", deadline: plan.deadline,
    timeZone: plan.schedulePreferences?.timeZone ?? "UTC", availability: plan.schedulePreferences?.availability ?? [],
    profileSummary: "No established behavioral preferences yet.", diagnosticResponses: [], knowledgeMap: plan.knowledgeMap,
  });
  const authorized = await loadAuthorizedNormalDurationContext(developmentPreview ? { developmentPreview, now } : { supabase: supabase!, authenticatedUserId: userId!, now });
  const rolloutDecision = resolveServerPersonalizationRollout({ subjectKey: userId ?? (developmentPreview ? "development_preview" : null) });
  const personalization = GenerationPersonalizationContextSchema.parse({ ...authorized.methodEvidence.personalization,
    ...(developmentPreview && request.previewCanonicalProfile ? { canonicalProfile: request.previewCanonicalProfile } : {}) });
  const otherPlans = context.kind === "development" ? context.plans.filter(item => item.id !== plan.id && item.status === "active") : [];
  // Saved plans are loaded independently for draft capacity too; a posted draft
  // never establishes the account's occupied time.
  const rows = supabase && !developmentPreview ? await supabase.from("plans").select("id").eq("user_id", userId!).eq("status", "active") : null;
  if (rows?.error) throw new PlanRevisionRequestError("Your other plans could not be checked. Nothing was changed.", 503);
  const reserved = rows?.data?.length ? await supabase!.from("plan_sessions").select("scheduled_for,estimated_minutes,status").eq("user_id", userId!).in("plan_id", rows.data.map(row => row.id)).in("status", ["ready", "upcoming"]) : null;
  if (reserved?.error) throw new PlanRevisionRequestError("Your other study blocks could not be checked. Nothing was changed.", 503);
  const otherReservations = [
    ...input.fixedEvents,
    ...otherPlans.flatMap(item => item.sessions.filter(session => ["ready", "upcoming"].includes(session.status)).map(session => ({ startsAt: session.scheduledFor, endsAt: new Date(Date.parse(session.scheduledFor) + session.estimatedMinutes * 60_000).toISOString() }))),
    ...(reserved?.data ?? []).map(row => ({ startsAt: row.scheduled_for, endsAt: new Date(Date.parse(row.scheduled_for) + row.estimated_minutes * 60_000).toISOString() })),
  ];
  let claimed = false;
  const proposal = await buildPlanRevision({ plan,
    request: { ...request, knowledgeMap: plan.knowledgeMap, profileSummary: authorized.profileSummary ?? request.profileSummary },
    delta: input.delta, controls: input.controls, now, contextKind: context.kind, draftReceiptWindow,
    protections: [], otherReservations,
    durationContext: { profileVersion: authorized.profileVersion, profile: rolloutDecision.personalizationEnabled ? authorized.profile : buildAuthorizedNormalDurationProfile([]), recentOutcomes: rolloutDecision.personalizationEnabled ? authorized.recentOutcomes : [] },
    methodContext: { profileVersion: authorized.methodProfileVersion, personalization, observedEvidence: authorized.methodEvidence.observedEvidence, rolloutDecision },
    fill: async fixed => {
      if (!isOpenAIPlanConfigured()) return buildNormalPlanFallbackFill(fixed);
      if (!claimed && supabase && !developmentPreview) {
        const claim = await reserveAIRequest(supabase, "plan_generation", crypto.randomUUID(), crypto.randomUUID());
        if (!claim.allowed) throw new PlanRevisionRequestError("Your planning allowance is unavailable right now. Nothing was changed.", 429);
        if (!await settleAIRequestClaim(supabase, claim.claimId)) throw new PlanRevisionRequestError("The planning request could not be reserved. Nothing was changed.", 503);
        claimed = true;
      }
      return (await generateNormalPlanFillWithOpenAI(fixed)).fill;
    },
  });
  const signed = proposal.canApply ? issuePlanRevisionProposalReceipt({ proposal, userId, developmentPreview, now, originalDraftExpiresAt: draftReceiptWindow?.expiresAt }) : null;
  return { status: "preview", proposal, proposalReceipt: signed?.receipt ?? null };
}
