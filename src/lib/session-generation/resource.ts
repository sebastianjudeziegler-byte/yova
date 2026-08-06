import type { SessionResource } from "@/lib/domain";
import {
  CachedGeneratedSessionSchema,
  type SessionGenerationResponse,
} from "@/lib/session-generation/schema";

type CachedGeneratedSession = SessionGenerationResponse["session"];

export function toSessionResource(
  session: CachedGeneratedSession,
  origin: SessionResource["origin"] = "generated",
): SessionResource {
  return {
    rationale: session.rationale,
    coverage: session.coverage,
    methodBriefing: session.methodBriefing,
    supportPlan: session.supportPlan,
    sourceGrounding: session.sourceGrounding ?? undefined,
    activities: session.activities.map((activity) => ({
      methodPhase: activity.methodPhase,
      estimatedMinutes: activity.estimatedMinutes,
      requiredForCompletion: activity.requiredForCompletion,
      type: activity.type,
      concept: activity.concept,
      label: activity.label,
      title: activity.title,
      body: activity.body,
      teaching: activity.teaching,
      choices: activity.choices,
      correctAnswer: activity.correctAnswer,
      feedback: activity.feedback,
    })),
    generatedAt: session.generatedAt,
    origin,
  };
}

export function readSessionResourceFromStepData(stepData: unknown): SessionResource | undefined {
  if (!stepData || typeof stepData !== "object" || !("generatedSession" in stepData)) return undefined;
  const parsed = CachedGeneratedSessionSchema.safeParse(stepData.generatedSession);
  return parsed.success ? toSessionResource(parsed.data) : undefined;
}
