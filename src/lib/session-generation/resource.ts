import type { SessionResource } from "@/lib/domain";
import {
  CachedGeneratedSessionSchema,
  type SessionGenerationResponse,
} from "@/lib/session-generation/schema";
import { methodRuntimeKeepIndex } from "@/lib/session-generation/method-runtime";

type CachedGeneratedSession = SessionGenerationResponse["session"];

export function toSessionResource(
  session: CachedGeneratedSession,
  origin: SessionResource["origin"] = "generated",
): SessionResource {
  // Generation sometimes attaches the method runtime to every activity. The
  // method carries the session's work once, so keep the first matching block
  // rather than discarding an otherwise good session.
  const runtimeKeepIndex = methodRuntimeKeepIndex(
    session.methodBriefing.methodId,
    session.activities.map((activity) => activity.methodRuntime),
  );

  return {
    schemaVersion: session.schemaVersion,
    routeRevisionId: session.routeRevisionId,
    topicIds: session.topicIds,
    rationale: session.rationale,
    coverage: session.coverage,
    methodBriefing: session.methodBriefing,
    routingContext: session.routingContext,
    deliveryPolicy: session.deliveryPolicy,
    deliveryInstructions: "deliveryInstructions" in session ? session.deliveryInstructions : undefined,
    supportPlan: session.supportPlan,
    sourceGrounding: session.sourceGrounding ?? undefined,
    cacheContext: "cacheContext" in session ? session.cacheContext : undefined,
    activities: session.activities.map((activity, index) => ({
      topicId: activity.topicId,
      methodPhase: activity.methodPhase,
      estimatedMinutes: activity.estimatedMinutes,
      requiredForCompletion: activity.requiredForCompletion,
      type: activity.type,
      concept: activity.concept,
      label: activity.label,
      title: activity.title,
      body: activity.body,
      teaching: activity.teaching,
      lessonBrief: "lessonBrief" in activity ? activity.lessonBrief : undefined,
      choices: activity.choices,
      correctAnswer: activity.correctAnswer,
      feedback: activity.feedback,
      practiceIntent: activity.practiceIntent,
      misconceptionSummary: activity.misconceptionSummary,
      // Without this the method runtime survives first render and disappears on
      // resume, so a resumed retrieval round would silently fall back to the
      // generic activity path.
      methodRuntime: index === runtimeKeepIndex ? activity.methodRuntime ?? null : null,
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
