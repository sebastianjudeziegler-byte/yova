import { canonicalizePlanAvailabilitySlots, enumeratePlanAvailabilitySlots, type PlanAvailabilitySlot } from "@/lib/plan-generation/availability-slots";
import { resolveInitialPlanSessionModes, type InitialPlanModeRoutingInput, type InitialPlanModeSessionInput } from "@/lib/plan-generation/initial-session-mode";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { subtractReservedAvailability, type ReservedTime } from "@/lib/plan-generation/reserved-availability";

/** Internal composition input. Public provider/request schemas never accept
 * these values; the revision service derives them from authoritative work. */
export type NormalPlanRevisionContext = Readonly<{
  reservations: readonly ReservedTime[];
  earliestStart?: string;
  priorSessions: readonly InitialPlanModeSessionInput[];
}>;

export function normalPlanAvailability({ request, now, searchDays, revisionContext }: {
  request: PlanGenerationRequest;
  now: Date;
  searchDays: number;
  revisionContext?: NormalPlanRevisionContext;
}): readonly PlanAvailabilitySlot[] {
  const slots = canonicalizePlanAvailabilitySlots(enumeratePlanAvailabilitySlots(request, now, searchDays), now);
  if (!revisionContext) return slots;
  const earliest = revisionContext.earliestStart ? Date.parse(revisionContext.earliestStart) : now.getTime();
  if (!Number.isFinite(earliest)) throw new Error("A revision's earliest start must be a valid time.");
  return subtractReservedAvailability(slots, revisionContext.reservations).flatMap(slot => {
    const start = Math.max(Date.parse(slot.startsAt), earliest, now.getTime());
    const end = Date.parse(slot.endsAt);
    const minutes = Math.floor((end - start) / 60_000);
    return minutes >= 1 ? [Object.freeze({ ...slot, startsAt: new Date(start).toISOString(), minutes })] : [];
  });
}

export function normalPlanModeDecisions(input: InitialPlanModeRoutingInput, revisionContext?: NormalPlanRevisionContext) {
  const prior = revisionContext?.priorSessions ?? [];
  if (!prior.length) return resolveInitialPlanSessionModes(input);
  const keys = new Set(input.sessions.map(session => session.key));
  if (prior.some(session => keys.has(session.key))) throw new Error("Prior work and new slots must have distinct session identities.");
  return resolveInitialPlanSessionModes({ ...input, sessions: [...prior, ...input.sessions] }).slice(prior.length);
}
