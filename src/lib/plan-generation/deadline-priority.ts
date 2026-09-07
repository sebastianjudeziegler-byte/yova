import { z } from "zod";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { canonicalizePlanAvailabilitySlots, enumeratePlanAvailabilitySlots } from "@/lib/plan-generation/availability-slots";

export const DeadlinePriorityResponseSchema = z.object({
  kind: z.literal("deadline_priority"),
  priority: z.object({
    topicId: z.string().uuid(),
    title: z.string().min(1),
    minutes: z.number().int().min(1).max(9),
    startsAt: z.string().datetime(),
    action: z.string().min(1),
    explanation: z.string().min(1),
    remainingTopics: z.array(z.string()),
    progressCredit: z.literal(false),
  }).strict(),
}).strict();

export type DeadlinePriorityResponse = z.infer<typeof DeadlinePriorityResponseSchema>;

/** A useful next action when none of the remaining windows can hold a lesson. */
export function buildDeadlinePriority(request: PlanGenerationRequest, now: Date): DeadlinePriorityResponse | null {
  if (request.intent !== "plan" || !request.deadline || !request.knowledgeMap) return null;
  const slots = canonicalizePlanAvailabilitySlots(enumeratePlanAvailabilitySlots(
    request, now, Math.max(42, request.knowledgeMap.scopeJudgment.maximumSessions * 10),
  ), now);
  if (!slots.length || slots.some(slot => slot.minutes >= 10)) return null;
  const topic = request.knowledgeMap.topics.find(candidate => !candidate.deferred);
  if (!topic) return null;
  const slot = slots[0]!;
  return DeadlinePriorityResponseSchema.parse({
    kind: "deadline_priority",
    priority: {
      topicId: topic.id,
      title: `Focus on ${topic.title}`,
      minutes: slot.minutes,
      startsAt: slot.startsAt,
      action: `Find one worked example of ${topic.title} in your notes or a trusted source. Read the key step, then write the one question you most need answered. Stop when this window ends.`,
      explanation: "Your remaining windows before the deadline are too short for a ten-minute lesson. Use this quick priority now; the full topic and the rest of your goal still need learning and practice.",
      remainingTopics: request.knowledgeMap.topics.filter(candidate => candidate.id !== topic.id).map(candidate => candidate.title),
      progressCredit: false,
    },
  });
}
