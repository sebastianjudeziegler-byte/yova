import { normalPlanAvailability, type NormalPlanRevisionContext } from "./normal-plan-revision-context";
import type { PlanGenerationRequest } from "./schema";
import type { PlanAvailabilitySlot } from "./availability-slots";

// Repeated provider, projection and validation boundaries use the same immutable
// calendar occurrences. Bounded cache contains dates only, never learner text.
const cache=new Map<string,readonly PlanAvailabilitySlot[]>();
export function topicPlanAvailability(request:PlanGenerationRequest,now:Date,blockCount:number,revisionContext?:NormalPlanRevisionContext) {
  const earliestOffset=revisionContext?.earliestStart ? Math.max(0,Math.ceil((Date.parse(revisionContext.earliestStart)-now.getTime())/86_400_000)):0;
  const searchDays=Math.max(42,earliestOffset+blockCount*7+14);
  const key=JSON.stringify([request.timeZone,request.availability,request.deadline,now.toISOString(),searchDays,revisionContext?.earliestStart,revisionContext?.reservations]);
  const existing=cache.get(key);if(existing)return existing;
  const slots=normalPlanAvailability({request,now,searchDays,revisionContext});
  if(cache.size>=32)cache.delete(cache.keys().next().value!);
  cache.set(key,slots);return slots;
}
