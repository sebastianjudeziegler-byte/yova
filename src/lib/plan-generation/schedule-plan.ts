import type {
  GeneratedPlanDraft,
  PlanGenerationRequest,
} from "@/lib/plan-generation/schema";
import {
  canonicalizePlanAvailabilitySlots,
  enumeratePlanAvailabilitySlots,
} from "@/lib/plan-generation/availability-slots";

export class PlanScheduleCapacityError extends Error {
  constructor() {
    super("The selected study windows do not have enough room for this plan before the deadline.");
    this.name = "PlanScheduleCapacityError";
  }
}

/**
 * Dates are a deterministic product concern, not a language-model judgment.
 * The model decides the instructional sequence; YOVA aligns that sequence to
 * the learner's real availability before the plan reaches the quality gate.
 */
export function alignGeneratedPlanToAvailability(
  draft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
  now = new Date(),
): GeneratedPlanDraft {
  if (request.intent === "study_now") {
    return {
      ...draft,
      sessions: draft.sessions.map((session, index) => ({
        ...session,
        scheduledFor: index === 0 ? now.toISOString() : session.scheduledFor,
      })),
    };
  }

  const candidates = canonicalizePlanAvailabilitySlots(
    enumeratePlanAvailabilitySlots(
      request,
      now,
      Math.max(42, draft.sessions.length * 10),
    ),
    now,
  );
  if (candidates.length === 0) throw new PlanScheduleCapacityError();

  let slotIndex = 0;
  let usedMinutes = 0;
  const sessions = draft.sessions.map((session) => {
    while (
      slotIndex < candidates.length
      && usedMinutes + session.estimatedMinutes > candidates[slotIndex].minutes
    ) {
      slotIndex += 1;
      usedMinutes = 0;
    }
    const slot = candidates[slotIndex];
    if (!slot) throw new PlanScheduleCapacityError();
    const scheduledFor = new Date(Date.parse(slot.startsAt) + usedMinutes * 60_000).toISOString();
    usedMinutes += session.estimatedMinutes;
    return { ...session, scheduledFor };
  });

  return {
    ...draft,
    sessions,
  };
}
