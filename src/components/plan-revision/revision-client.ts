import type { LearningPlan } from "@/lib/domain";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import type { MapDelta } from "@/lib/plan-revision/map-delta";
import { PlanRevisionProposalSchema, type RevisionControls } from "@/lib/plan-revision/revision-schema";
import type { RevisionClient } from "./living-plan-revision";
import type { SignedPreview } from "./plan-revision-preview";
import { loadCalendarPrototypeState } from "@/lib/calendar/persistence";
import { expandRecurringEvent } from "@/lib/calendar/recurrence";

export async function sendPlanRevisionRequest(body: unknown) {
  const response = await fetch("/api/plans/adjust", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The plan change could not be saved. Your current plan is unchanged.");
  return result;
}
export function savedPlanAvailability(plan: LearningPlan) {
  if (plan.schedulePreferences?.availability.length) return plan.schedulePreferences.availability;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const time = (date: Date) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  return plan.sessions.slice(0, 14).map(session => {
    const start = new Date(session.scheduledFor);
    const end = new Date(start.getTime() + session.estimatedMinutes * 60_000);
    return { day: start.toLocaleDateString("en-US", { weekday: "long", timeZone }), window: `${time(start)}–${time(end)}`, minutes: session.estimatedMinutes };
  });
}
export async function previewClientPlanRevision({ plan, client, delta, controls, draft }: {
  plan: LearningPlan; client: RevisionClient; delta: MapDelta; controls: RevisionControls;
  draft?: { generationRequest: PlanGenerationRequest; draftReceipt: string | null };
}): Promise<SignedPreview> {
  function fixedEvents() {
    const from = new Date();
    const to = new Date(plan.deadline ?? from.getTime() + 366 * 86400000);
    return loadCalendarPrototypeState(window.localStorage, client.accountId, from).manualEvents
      .filter(event => !event.done && !event.deadlineOnly)
      .flatMap(event => expandRecurringEvent(event, from, to))
      .map(event => ({ id: event.id, startsAt: event.startsAt, endsAt: event.endsAt }));
  }
    const context = draft ? { kind: "draft", plan, ...draft } : client.developmentPreview ? {
      kind: "development", plan, plans: client.plans, expectedRevisionId: plan.revisionId ?? plan.id,
      generationRequest: {
        intent: "plan", learningIntent: plan.learningIntent, goal: plan.title.length >= 10 ? plan.title : `Study ${plan.title} in this plan`,
        materialMode: plan.sourceMode === "user_materials" ? "upload" : "none", materials: plan.materials ?? [],
        studyMode: plan.studyMode === "outside_yova" ? "outside" : "inside", deadline: plan.deadline,
        timeZone: plan.schedulePreferences?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        availability: savedPlanAvailability(plan), profileSummary: client.profileSummary,
        previewCanonicalProfile: client.previewCanonicalProfile, knowledgeMap: plan.knowledgeMap, diagnosticResponses: [],
      },
    } : { kind: "active", planId: plan.id, expectedRevisionId: plan.revisionId ?? plan.id };
    const result = await sendPlanRevisionRequest({ action: "preview", context, delta, controls, fixedEvents: fixedEvents() });
    return { proposal: PlanRevisionProposalSchema.parse(result.proposal), proposalReceipt: result.proposalReceipt };
}
