import { z } from "zod";
import { makeUuid, type LearningPlan, type LearningPlanSession } from "@/lib/domain";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import { applyMapDelta, type MapDelta } from "@/lib/plan-revision/map-delta";
import { selectRevisionSessionScope, type RevisionSessionProtection } from "@/lib/plan-revision/revision-session-scope";
import type { RevisionCapacity, RevisionControls, RevisionLine, PlanRevisionProposal } from "@/lib/plan-revision/revision-schema";
import { normalPlanAvailability, type NormalPlanRevisionContext } from "@/lib/plan-generation/normal-plan-revision-context";
import type { ReservedTime } from "@/lib/plan-generation/reserved-availability";
import { composeNormalPlanEnvelopes, NormalPlanEnvelopeComposerError, type NormalPlanDurationContext } from "@/lib/plan-generation/normal-plan-envelopes";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
import type { NormalPlanProviderFillInputOptions } from "@/lib/plan-generation/normal-plan-provider-prompt";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import type { InitialPlanMethodRoutingContext } from "@/lib/study-route/initial-plan-method-routing";
import { StudyRouteSchema } from "@/lib/study-route/schema";
import { createSuccessorStudyRoute, materialStudyRouteChanges } from "@/lib/study-route/revisions";
import { studyRouteToLegacySessionProjection } from "@/lib/study-route/adapters";

const RESET_MS = 5 * 60_000;
const finish = (session: LearningPlanSession) => Date.parse(session.scheduledFor) + session.estimatedMinutes * 60_000;
const pending = (session: LearningPlanSession) => session.status === "ready" || session.status === "upcoming";
const capacityChoices = [
  { action: "move_block" as const, label: "Move a block" },
  { action: "shorten_scope" as const, label: "Shorten scope" },
  { action: "add_time" as const, label: "Add time" },
];
const capacityFailure = (explanation: string): RevisionCapacity => ({ status: "insufficient", explanation, choices: capacityChoices });

type Unit = { topicId: string; original: LearningPlanSession | null; keepOriginalId: boolean; maximumSessions: 1 | 2; operationIndex: number; order: number };

/** Code owns the affected set, topic map, sequence, modes, timing and methods.
 * The provider receives only bounded fixed slots for the selected future work. */
export async function buildPlanRevision({ plan, request, delta, controls, protections, otherReservations, durationContext, methodContext, now, fill, contextKind, draftReceiptWindow }: {
  plan: LearningPlan & { revisionId?: string };
  request: PlanGenerationRequest;
  delta: MapDelta;
  controls: RevisionControls;
  protections: readonly RevisionSessionProtection[];
  otherReservations: readonly ReservedTime[];
  durationContext: NormalPlanDurationContext;
  methodContext: InitialPlanMethodRoutingContext;
  now: Date;
  fill: (input: NormalPlanProviderFillInputOptions) => Promise<unknown>;
  contextKind: "active" | "draft" | "development";
  draftReceiptWindow?: { issuedAt: string; expiresAt: string };
}): Promise<PlanRevisionProposal> {
  const applied = applyMapDelta({ request, delta, now, excluded: controls.excludedOperationIndexes });
  const nextMap = applied.request.knowledgeMap!;
  const slots = normalPlanAvailability({ request: applied.request, now, searchDays: 366, revisionContext: { reservations: otherReservations, priorSessions: [] } });
  const fitsSchedule = (session: LearningPlanSession) => slots.some(slot => Date.parse(session.scheduledFor) >= Date.parse(slot.startsAt) && finish(session) <= Date.parse(slot.endsAt));
  const scope = selectRevisionSessionScope({ plan, applied, operations: delta.operations, protections: protections.map(protection => controls.sessionEdits.some(edit => edit.sessionId === protection.sessionId && edit.scheduledFor) ? { ...protection, pinnedTime: false } : protection), now, fitsSchedule });
  const affected = new Set(scope.affectedSessionIds);
  const removed = new Set(scope.removedTopicIds);
  const protectedIds = new Set(scope.protectedSessionIds);
  const originalById = new Map(plan.sessions.map(session => [session.id, session]));
  const protectionById = new Map(protections.map(item => [item.sessionId, item]));
  const edits = new Map(controls.sessionEdits.filter(edit => applied.lines.some(line => line.topicId === null || originalById.get(edit.sessionId)?.topicIds?.includes(line.topicId))).map(item => [item.sessionId, item]));
  if (new Set(controls.sessionEdits.map(edit => edit.sessionId)).size !== controls.sessionEdits.length || controls.sessionEdits.some(edit => !originalById.has(edit.sessionId))) throw new Error("Choose an existing session from this preview before editing its method or time.");
  for (const edit of edits.values()) {
    if (protectedIds.has(edit.sessionId)) throw new Error("That session has saved work and cannot be changed.");
    affected.add(edit.sessionId);
  }
  const units: Unit[] = [];
  const replacements = new Map<string, LearningPlanSession>();
  const operationFor = (topicId: string) => applied.lines.find(line => line.topicId === topicId)?.operationIndex ?? applied.lines.find(line => line.topicId === null)?.operationIndex ?? 0;
  for (const original of plan.sessions.filter(session => affected.has(session.id))) {
    const retained = (original.topicIds ?? []).filter(id => !removed.has(id));
    if (!retained.length) {
      replacements.set(original.id, { ...original, status: "skipped" });
      continue;
    }
    for (const [index, topicId] of retained.entries()) units.push({ topicId, original, keepOriginalId: index === 0, maximumSessions: 1, operationIndex: operationFor(topicId), order: original.sequence });
  }
  for (const topicId of scope.newTopicIds) {
    if (units.some(unit => unit.topicId === topicId) || removed.has(topicId)) continue;
    units.push({ topicId, original: null, keepOriginalId: false, maximumSessions: 2, operationIndex: operationFor(topicId), order: plan.sessions.length + nextMap.topics.findIndex(topic => topic.id === topicId) + 1 });
  }
  const mapById = new Map(nextMap.topics.map(topic => [topic.id, topic]));
  const addedSessions: LearningPlanSession[] = [];
  const reservations: ReservedTime[] = [...otherReservations, ...plan.sessions.filter(session => pending(session) && !affected.has(session.id)).map(reservationFor)];
  const rebuiltEnd = new Map<string, number>();
  // Prepare and validate every fixed placement before making provider calls.
  const prepared: Array<{ unit: Unit; fixed: NormalPlanProviderFillInputOptions; protection?: RevisionSessionProtection }> = [];
  let capacity: RevisionCapacity = { status: "fits", explanation: "These changes fit alongside your other active plans and fixed events.", choices: [] };
  const blockers = [...scope.blockers];
  const remaining = [...units].sort((a, b) => a.order - b.order);

  while (remaining.length && blockers.length === 0) {
    const availableIndex = remaining.findIndex(unit => !scope.dependencies.some(dependency => dependency.topicId === unit.topicId && remaining.some(candidate => candidate.topicId === dependency.predecessorTopicId)));
    if (availableIndex < 0) {
      blockers.push({ topicId: remaining[0]!.topicId, message: "These topic changes conflict with the prerequisite order. Adjust the order or shorten the scope." });
      break;
    }
    const [unit] = remaining.splice(availableIndex, 1);
    const topic = mapById.get(unit!.topicId)!;
    if (topic.removed || topic.deferred) continue;
    const edit = unit!.original ? edits.get(unit!.original.id) : undefined;
    const protection = unit!.original ? protectionById.get(unit!.original.id) : undefined;
    const explicitReorder = delta.operations.some(operation => operation.op === "reorder" && operation.topic_id === unit!.topicId);
    const existingStart = unit!.original && !edit?.scheduledFor && !applied.scheduleChanged && !explicitReorder ? Date.parse(unit!.original.scheduledFor) : now.getTime();
    const prerequisiteEnd = Math.max(now.getTime(), ...scope.dependencies.filter(dependency => dependency.topicId === unit!.topicId).map(dependency => rebuiltEnd.get(dependency.predecessorTopicId) ?? now.getTime()));
    const earliest = Math.max(now.getTime(), existingStart, prerequisiteEnd, Date.parse(scope.notBeforeByTopic[unit!.topicId] ?? now.toISOString()));
    const selectedTime = edit?.scheduledFor ?? (protection?.pinnedTime ? unit!.original!.scheduledFor : undefined);
    if (selectedTime && Date.parse(selectedTime) < earliest) {
      blockers.push({ topicId: topic.id, message: `The chosen time for ${topic.title} is before its earlier work can finish.` });
      break;
    }
    const subRequest = scopedRequest(applied.request, [topic.id], unit!.maximumSessions);
    const priorSessions = plan.sessions.filter(session => session.status !== "skipped" && unit!.original && session.sequence < unit!.original.sequence && session.topicIds?.includes(topic.id)).map(session => ({ key: `existing:${session.id}`, topicIds: [topic.id] }));
    const revisionContext: NormalPlanRevisionContext = { reservations: [...reservations], earliestStart: selectedTime ?? new Date(earliest).toISOString(), priorSessions };
    const chosenMethod = edit?.methodId ?? (unit!.original?.studyRoute?.agency.selectedBy === "learner" ? unit!.original.studyRoute.approach.primaryMethodId : undefined);
    const scopedMethodContext = { ...methodContext, ...(chosenMethod ? { methodChoicesBySequence: { 1: { methodId: chosenMethod, evidenceRef: `learner-choice:plan-revision:${plan.id}:${unit!.original!.id}:${chosenMethod}` } } } : {}) };
    const sourceAdded = delta.operations.some((operation, index) => !controls.excludedOperationIndexes.includes(index) && operation.op === "attach_source" && operation.topic_id === topic.id);
    const sourceBudget = sourceAdded && unit!.original
      ? [10, 15, 25, 45, 60].find(minutes => minutes >= unit!.original!.estimatedMinutes + 5) ?? 60
      : undefined;
    const requestedDuration = edit?.durationMinutes ?? (protection?.editedFields.includes("estimatedMinutes") ? unit!.original!.estimatedMinutes : sourceBudget);
    const selectedDuration = requestedDuration === undefined ? undefined : z.union([z.literal(10), z.literal(15), z.literal(25), z.literal(45), z.literal(60)]).parse(requestedDuration);
    try {
      const composition = composeNormalPlanEnvelopes({
        request: subRequest, now, revisionContext,
        durationContext: { ...durationContext, ...(selectedDuration ? { learnerOverrideMinutes: selectedDuration } : {}) },
        learningIntentRecommendation: { intent: subRequest.learningIntent, basis: "Apply the accepted topic change while keeping all other work unchanged." },
      });
      if (selectedTime && composition.envelopes[0]?.scheduledFor !== selectedTime) {
        blockers.push({ topicId: topic.id, message: `The chosen time for ${topic.title} does not fit its availability and other reserved work.` });
        break;
      }
      if (!composition.envelopes.some(envelope => envelope.topicIds.includes(topic.id))) {
        blockers.push({ topicId: topic.id, message: `${topic.title} does not fit before the deadline with your other plans and events.` });
        break;
      }
      if (sourceBudget && composition.envelopes[0]!.timing.activeMinutes < sourceBudget) capacity = {
        status: "reduced", explanation: `Only ${composition.envelopes[0]!.timing.activeMinutes} minutes fit here for studying this source and practicing. Move a block, shorten the source section or add time for the full ${sourceBudget}-minute budget.`, choices: capacityChoices,
      };
      if (composition.capacityRecovery) capacity = { status: "reduced", explanation: composition.capacityRecovery.explanation, choices: capacityChoices };
      const fixed = { request: subRequest, composition, now, methodContext: scopedMethodContext, revisionContext };
      prepared.push({ unit: unit!, fixed, protection });
      for (const envelope of composition.envelopes) {
        const startsAt = Date.parse(envelope.scheduledFor);
        const endsAt = startsAt + envelope.timing.activeMinutes * 60_000;
        reservations.push({ startsAt: new Date(startsAt - RESET_MS).toISOString(), endsAt: new Date(endsAt + RESET_MS).toISOString() });
        if (!rebuiltEnd.has(topic.id)) rebuiltEnd.set(topic.id, endsAt + RESET_MS);
      }
    } catch (error) {
      if (error instanceof NormalPlanEnvelopeComposerError && ["no_normal_session_capacity", "scope_minimum_unreachable", "minimum_teaching_unreachable"].includes(error.code)) {
        blockers.push({ topicId: topic.id, message: `${topic.title} does not fit before the deadline. Move a block, shorten scope or add time.` });
        break;
      }
      throw error;
    }
  }
  const addedCount = prepared.reduce((sum, item) => sum + item.fixed.composition.envelopes.length - (item.unit.keepOriginalId ? 1 : 0), 0);
  if (plan.sessions.length + addedCount > (contextKind === "draft" ? 14 : 28)) blockers.push({ topicId: "", message: "This change needs more session space. Shorten scope or finish existing work before adding it." });
  if (blockers.length === 0) {
    for (const { unit, fixed, protection } of prepared) {
      const generated = buildNormalPlanFromFixedEnvelope({ ...fixed, methodContext: fixed.methodContext!, fill: await fill(fixed) });
      for (const [index, session] of generated.sessions.entries()) {
        const original = unit.keepOriginalId && index === 0 ? unit.original : null;
        const id = original?.id ?? makeUuid();
        const rebound = bindRevisionSession({ plan, session, original, id, now, protection });
        if (original) replacements.set(id, rebound);
        else addedSessions.push(rebound);
      }
    }
  }
  let sessions = [...plan.sessions.map(session => replacements.get(session.id) ?? session), ...addedSessions];
  if (blockers.length) {
    sessions = plan.sessions;
    capacity = capacityFailure(blockers.map(blocker => blocker.message).join(" "));
  } else if (addedSessions.length || delta.operations.some(operation => operation.op === "reorder")) {
    sessions = assignFutureSequence(sessions, protectedIds);
  }
  const revisionId = makeUuid();
  const after = { ...plan, materials: applied.request.materials.map(material => ({ ...material, textContent: null })), revisionId, deadline: applied.request.deadline, knowledgeMap: nextMap, schedulePreferences: { timeZone: applied.request.timeZone, availability: applied.request.availability }, sessions };
  const lines: RevisionLine[] = applied.lines.map(line => {
    const beforeSessions = plan.sessions.filter(session => line.topicId ? session.topicIds?.includes(line.topicId) && affected.has(session.id) : affected.has(session.id));
    const afterSessions = sessions.filter(session => line.topicId ? session.topicIds?.includes(line.topicId) && (affected.has(session.id) || addedSessions.some(added => added.id === session.id)) : affected.has(session.id));
    return { ...line, before: beforeSessions.map(sessionDescription), after: afterSessions.filter(session => session.status !== "skipped").map(session => {
      const operation = delta.operations[line.operationIndex];
      const source = operation?.op === "attach_source" ? operation.url ?? applied.request.materials.find(material => material.id === operation.material_id)?.name ?? "Attached file" : null;
      return `${sessionDescription(session)}${source ? ` · Study this source, then practice: ${source}` : ""}`;
    }), sessionIds: afterSessions.map(session => session.id), blockedReason: blockers.find(blocker => blocker.topicId === line.topicId)?.message ?? null };
  });
  return {
    id: revisionId, planId: plan.id, baseRevisionId: plan.revisionId ?? plan.id, revisionId, contextKind,
    before: plan, after, generationRequest: applied.request, delta, controls, lines, capacity,
    canApply: blockers.length === 0 && applied.lines.length > 0, issuedAt: now.toISOString(),
    ...(draftReceiptWindow ? { draftReceiptIssuedAt: draftReceiptWindow.issuedAt, draftReceiptExpiresAt: draftReceiptWindow.expiresAt } : {}),
  } as PlanRevisionProposal;
}

function reservationFor(session: LearningPlanSession): ReservedTime {
  return { startsAt: new Date(Date.parse(session.scheduledFor) - RESET_MS).toISOString(), endsAt: new Date(finish(session) + RESET_MS).toISOString() };
}
function scopedRequest(request: PlanGenerationRequest, ids: string[], maximumSessions: 1 | 2): PlanGenerationRequest {
  const selected = new Set(ids);
  const full = request.knowledgeMap!;
  const topics = full.topics.filter(topic => selected.has(topic.id)).map(topic => ({ ...topic, prerequisiteTopicIds: topic.prerequisiteTopicIds.filter(id => selected.has(id)) }));
  const knowledgeMap: PlanKnowledgeMap = {
    ...full, topics,
    scopeJudgment: { ...full.scopeJudgment, minimumSessions: 1, recommendedSessions: maximumSessions, maximumSessions, minimumTeachingSessions: 1 },
    placementCheck: { ...full.placementCheck, demonstratedTopicIds: full.placementCheck.demonstratedTopicIds.filter(id => selected.has(id)), gapTopicIds: full.placementCheck.gapTopicIds.filter(id => selected.has(id)) },
  };
  return { ...request, knowledgeMap, diagnosticResponses: request.diagnosticResponses.filter(response => response.topicId && selected.has(response.topicId)) };
}
function bindRevisionSession({ plan, session, original, id, now, protection }: {
  plan: LearningPlan; session: LearningPlanSession; original: LearningPlanSession | null; id: string; now: Date; protection?: RevisionSessionProtection;
}): LearningPlanSession {
  const candidate = { ...session, id, sequence: original?.sequence ?? session.sequence, status: original?.status ?? "upcoming" as const };
  for (const field of protection?.editedFields ?? []) {
    if (field === "scheduledFor" || field === "estimatedMinutes" || field === "method") continue;
    if (original) Object.assign(candidate, { [field]: original[field] });
  }
  let route = StudyRouteSchema.parse({ ...candidate.studyRoute!, target: { ...candidate.studyRoute!.target, desiredOutcome: candidate.objective.slice(0, 500) }, identity: { ...candidate.studyRoute!.identity, planId: plan.id, sessionId: id } });
  if (original?.studyRoute?.identity.lifecycleStatus === "committed") {
    if (!materialStudyRouteChanges(original.studyRoute, route).length) return { ...candidate, ...studyRouteToLegacySessionProjection(original.studyRoute), studyRoute: original.studyRoute };
    const changedAt = new Date(Math.max(now.getTime(), Date.parse(original.studyRoute.identity.committedAt ?? original.studyRoute.identity.createdAt))).toISOString();
    route = StudyRouteSchema.parse(createSuccessorStudyRoute({ previous: original.studyRoute, routeRevisionId: makeUuid(), createdAt: changedAt, changeReason: "The learner revised this topic through the structured plan preview.", changes: { target: route.target, approach: route.approach, timing: route.timing, execution: route.execution, agency: route.agency, explanation: route.explanation, provenance: { ...route.provenance, ruleTrace: [{ ruleId: "plan_revision_v1", result: "affected_future_session", reason: "Rebuilt only the affected future session from its accepted topic-map change.", evidenceRefs: [] }] } } }));
  } else {
    route = StudyRouteSchema.parse({ ...route, identity: { ...route.identity, routeLineageId: original?.studyRoute?.identity.routeLineageId ?? route.identity.routeLineageId } });
  }
  return { ...candidate, ...studyRouteToLegacySessionProjection(route), studyRoute: route };
}
function sessionDescription(session: LearningPlanSession) {
  return `${session.learningMode === "study" ? "Practice" : "Learn"}: ${session.title} · ${session.method} · ${session.estimatedMinutes} min · ${session.scheduledFor}`;
}
function assignFutureSequence(sessions: LearningPlanSession[], protectedIds: ReadonlySet<string>) {
  const fixed = new Set(sessions.filter(session => protectedIds.has(session.id) && session.status !== "skipped").map(session => session.sequence));
  let sequence = 1;
  const numbers = new Map<string, number>();
  for (const session of [...sessions].filter(session => session.status !== "skipped").sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor) || a.sequence - b.sequence)) {
    if (protectedIds.has(session.id)) { sequence = Math.max(sequence, session.sequence + 1); continue; }
    while (fixed.has(sequence)) sequence += 1;
    numbers.set(session.id, sequence++);
  }
  return sessions.map(session => numbers.has(session.id) ? { ...session, sequence: numbers.get(session.id)! } : session).sort((a, b) => a.sequence - b.sequence);
}
