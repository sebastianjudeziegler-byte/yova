import "server-only";
import { conceptSignalsForSession } from "@/lib/learning/concept-review-scheduler";
import { isScheduledRetrievalSession } from "@/lib/learning/scheduled-retrieval";
import {
  canGenerateReliableSession,
  generateReliableSessionWithOpenAI,
} from "@/lib/openai/reliable-session-generator";
import {
  generateSessionWithOpenAI,
  markSessionGenerationContextPrepared,
  prepareSessionGenerationContext,
  type SessionGenerationContext,
  type SessionGenerationRuntime,
} from "@/lib/openai/session-generator";
import { generateStreamedTeachingSkeletonWithOpenAI } from "@/lib/openai/streamed-teaching-generator";
import { sessionArchitectureForGeneration, usesStreamedTeaching } from "@/lib/session-generation/architecture";

/**
 * Keeps production and live quality evaluations on the same generation path.
 * The compact generator is faster and more predictable, but only for methods
 * whose complete learning sequence fits its deterministic activity shape.
 */
export function sessionGenerationStrategy(context: SessionGenerationContext) {
  return sessionGenerationStrategyForPreparedContext(
    prepareProductionSessionGenerationContext(context),
  );
}

function sessionGenerationStrategyForPreparedContext(
  scopedContext: SessionGenerationContext,
) {
  const runtimeArchitecture = sessionArchitectureForGeneration({
    storedVersion: scopedContext.sessionArchitectureVersion,
    learningMode: scopedContext.session.learningMode,
    studyMode: scopedContext.learningGoal.studyMode,
    reviewType: scopedContext.session.reviewType ?? null,
  });
  if (
    usesStreamedTeaching({ sessionArchitectureVersion: runtimeArchitecture })
    && scopedContext.session.learningMode === "learn"
    && scopedContext.learningGoal.studyMode === "inside_yova"
    && !scopedContext.session.reviewType
  ) return "streamed" as const;
  if (isScheduledRetrievalSession(scopedContext.session)) return "full" as const;
  return canGenerateReliableSession(scopedContext) ? "reliable" as const : "full" as const;
}

export function generateProductionSessionWithOpenAI(
  context: SessionGenerationContext,
  runtime: SessionGenerationRuntime = {},
) {
  const scopedContext = prepareProductionSessionGenerationContext(context);
  const generationContext = {
    ...scopedContext,
    sessionArchitectureVersion: sessionArchitectureForGeneration({
      storedVersion: scopedContext.sessionArchitectureVersion,
      learningMode: scopedContext.session.learningMode,
      studyMode: scopedContext.learningGoal.studyMode,
      reviewType: scopedContext.session.reviewType ?? null,
    }),
  };
  markSessionGenerationContextPrepared(generationContext);
  const strategy = sessionGenerationStrategyForPreparedContext(generationContext);
  if (strategy === "streamed") return generateStreamedTeachingSkeletonWithOpenAI(generationContext, runtime);
  return strategy === "reliable"
    ? generateReliableSessionWithOpenAI(generationContext, runtime)
    : generateSessionWithOpenAI(generationContext, runtime);
}

function prepareProductionSessionGenerationContext(
  context: SessionGenerationContext,
) {
  const preparedContext = prepareSessionGenerationContext(context);
  return markSessionGenerationContextPrepared(
    withSessionConceptScope(preparedContext),
  );
}

export function withSessionConceptScope(
  context: SessionGenerationContext,
): SessionGenerationContext {
  const conceptSignals = conceptSignalsForSession({
    signals: context.conceptSignals,
    topicIds: context.session.topicIds,
    scopeText: [
      context.session.title,
      context.session.objective,
      ...(context.session.contentTargets ?? []),
    ],
  });
  return conceptSignals.length === context.conceptSignals.length
    && conceptSignals.every((signal, index) => signal === context.conceptSignals[index])
    ? context
    : { ...context, conceptSignals };
}
