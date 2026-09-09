"use client";

import { useState } from "react";
import type { LearningPlan } from "@/lib/domain";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import type { MapDelta, MapDeltaOperation } from "@/lib/plan-revision/map-delta";
import { RevisionPlanSchema, PlanRevisionProposalSchema, type RevisionControls } from "@/lib/plan-revision/revision-schema";
import { PlanRevisionPreview, type SignedPreview } from "@/components/plan-revision/plan-revision-preview";
import { CORE_METHOD_CATALOG, CORE_METHOD_IDS } from "@/lib/learning/method-catalog";
import { normalPlanAvailability } from "@/lib/plan-generation/normal-plan-revision-context";
import { loadCalendarPrototypeState } from "@/lib/calendar/persistence";
import { expandRecurringEvent } from "@/lib/calendar/recurrence";
import { uploadMaterialFiles } from "@/lib/materials/intake";

export type RevisionLaunch = { key: string; planId: string; delta: MapDelta; type?: MapDeltaOperation["op"]; topicId?: string; controls?: RevisionControls };
export type RevisionClient = {
  launch?: RevisionLaunch | null;
  onReviewClosed?: () => void;
  developmentPreview: boolean;
  accountId: string;
  plans: LearningPlan[];
  profileSummary: string;
  previewCanonicalProfile?: PlanGenerationRequest["previewCanonicalProfile"];
  onSaved: (plan: LearningPlan, previous: LearningPlan, changedSessionIds?: string[]) => void | Promise<void>;
  onOpenCalendar: () => void;
};
type DraftAuthority = { generationRequest: PlanGenerationRequest; draftReceipt: string | null };
export function LivingPlanRevision({ plan, initialDelta, initialTopicId, initialType, initialControls, client, draft, onDraftSaved, onReviewed, onClose }: {
  plan: LearningPlan; initialDelta: MapDelta; initialTopicId?: string; initialType?: MapDeltaOperation["op"]; initialControls?: RevisionControls; client: RevisionClient;
  draft?: DraftAuthority;
  onDraftSaved?: (plan: LearningPlan, request: PlanGenerationRequest, receipt: string | null) => void;
  onReviewed?: () => void;
  onClose: () => void;
}) {
  const [applied, setApplied] = useState<SignedPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  async function request(body: unknown) {
    const response = await fetch("/api/plans/adjust", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "The plan change could not be saved. Your current plan is unchanged.");
    return result;
  }
  function fixedEvents() {
    const from = new Date();
    const to = new Date(plan.deadline ?? from.getTime() + 366 * 86400000);
    return loadCalendarPrototypeState(window.localStorage, client.accountId, from).manualEvents
      .filter(event => !event.done && !event.deadlineOnly)
      .flatMap(event => expandRecurringEvent(event, from, to))
      .map(event => ({ id: event.id, startsAt: event.startsAt, endsAt: event.endsAt }));
  }
  function savedAvailability() {
    if (plan.schedulePreferences?.availability.length) return plan.schedulePreferences.availability;
    // Older Study Now goals retain their actual block, but not a separate
    // schedule-preferences object. Use that existing time as the preimage.
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const time = (date: Date) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
    return plan.sessions.slice(0, 14).map(session => {
      const start = new Date(session.scheduledFor);
      const end = new Date(start.getTime() + session.estimatedMinutes * 60_000);
      return { day: start.toLocaleDateString("en-US", { weekday: "long", timeZone }), window: `${time(start)}–${time(end)}`, minutes: session.estimatedMinutes };
    });
  }
  async function preview(delta: MapDelta, controls: RevisionControls): Promise<SignedPreview> {
    const context = draft ? { kind: "draft", plan, ...draft } : client.developmentPreview ? {
      kind: "development", plan, plans: client.plans, expectedRevisionId: plan.revisionId ?? plan.id,
      generationRequest: {
        intent: "plan", learningIntent: plan.learningIntent, goal: plan.title.length >= 10 ? plan.title : `Study ${plan.title} in this plan`,
        materialMode: plan.sourceMode === "user_materials" ? "upload" : "none", materials: plan.materials ?? [],
        studyMode: plan.studyMode === "outside_yova" ? "outside" : "inside", deadline: plan.deadline,
        timeZone: plan.schedulePreferences?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        availability: savedAvailability(), profileSummary: client.profileSummary,
        previewCanonicalProfile: client.previewCanonicalProfile, knowledgeMap: plan.knowledgeMap, diagnosticResponses: [],
      },
    } : { kind: "active", planId: plan.id, expectedRevisionId: plan.revisionId ?? plan.id };
    const result = await request({ action: "preview", context, delta, controls, fixedEvents: fixedEvents() });
    return { proposal: PlanRevisionProposalSchema.parse(result.proposal), proposalReceipt: result.proposalReceipt };
  }
  async function accept(result: Awaited<ReturnType<typeof request>>, previous: LearningPlan) {
    const saved = RevisionPlanSchema.parse(result.plan) as LearningPlan;
    if (draft && onDraftSaved) onDraftSaved(saved, result.generationRequest, result.draftReceipt);
    else await client.onSaved(saved, previous, result.changedSessionIds);
    setMessage(result.receipt.message);
    onReviewed?.();
  }
  async function apply(preview: SignedPreview) {
    const result = await request({ action: "apply", ...preview });
    await accept(result, plan);
    setApplied(preview);
  }
  async function undo() {
    if (!applied || undoing) return;
    setUndoing(true); setError(null);
    try {
      const result = await request({ action: "undo", planId: plan.id, expectedRevisionId: applied.proposal.revisionId,
        ...(client.developmentPreview ? { developmentPlan: plan } : {}),
        ...(draft || client.developmentPreview ? applied : {}),
      });
      await accept(result, plan);
      setUndone(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Undo could not be saved. Your current plan is unchanged."); }
    finally { setUndoing(false); }
  }
  if (applied) return <div className="plan-revision-receipt">
    <div role="status"><p>{message}</p>{!undone && <button className="button secondary" disabled={undoing} onClick={() => void undo()}>{undoing ? "Restoring…" : "Undo"}</button>}</div>
    {error && <p role="alert">{error}</p>}
  </div>;
  return <PlanRevisionPreview plan={plan} initialDelta={initialDelta} initialControls={initialControls} initialTopicId={initialTopicId} initialType={initialType} onPreview={preview} onApply={apply} onCancel={onClose}
    onStageFile={async file => {
      const { accepted, errors } = await uploadMaterialFiles([file], plan.materials ?? []);
      if (!accepted[0]) throw new Error(errors[0] ?? "The source could not be uploaded.");
      return { materialId: accepted[0].id, name: accepted[0].name };
    }}
    choicesForSession={(proposal, sessionId) => {
      const session = proposal.after.sessions.find(candidate => candidate.id === sessionId)!;
      const reservations = [...proposal.fixedEvents, ...client.plans.filter(other => other.id !== plan.id && other.status === "active")
        .flatMap(other => other.sessions.filter(item => item.status === "ready" || item.status === "upcoming").map(item => ({ startsAt: item.scheduledFor, endsAt: new Date(Date.parse(item.scheduledFor) + item.estimatedMinutes * 60000).toISOString() })))];
      const slots = normalPlanAvailability({ request: proposal.generationRequest, now: new Date(), searchDays: 90, revisionContext: { reservations, priorSessions: [] } });
      const times = [...new Set([session.scheduledFor, ...slots.filter(slot => slot.minutes >= session.estimatedMinutes).map(slot => slot.startsAt)])];
      return { methods: CORE_METHOD_IDS.map(id => ({ value: id, label: CORE_METHOD_CATALOG[id].name })),
        times: times.map(value => ({ value, label: new Date(value).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) })) };
    }}
    onCapacityChoice={async choice => { if (choice === "move_block") client.onOpenCalendar(); return null; }}
  />;
}
