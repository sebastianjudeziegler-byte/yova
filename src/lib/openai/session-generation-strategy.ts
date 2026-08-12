import "server-only";
import { isScheduledRetrievalSession } from "@/lib/learning/scheduled-retrieval";
import {
  canGenerateReliableSession,
  generateReliableSessionWithOpenAI,
} from "@/lib/openai/reliable-session-generator";
import {
  generateSessionWithOpenAI,
  type SessionGenerationContext,
} from "@/lib/openai/session-generator";
import { generateStreamedTeachingSkeletonWithOpenAI } from "@/lib/openai/streamed-teaching-generator";
import { sessionArchitectureForGeneration, usesStreamedTeaching } from "@/lib/session-generation/architecture";

/**
 * Keeps production and live quality evaluations on the same generation path.
 * The compact generator is faster and more predictable, but only for methods
 * whose complete learning sequence fits its deterministic activity shape.
 */
export function sessionGenerationStrategy(context: SessionGenerationContext) {
  const runtimeArchitecture = sessionArchitectureForGeneration({
    storedVersion: context.sessionArchitectureVersion,
    learningMode: context.session.learningMode,
    studyMode: context.learningGoal.studyMode,
    reviewType: context.session.reviewType ?? null,
  });
  if (
    usesStreamedTeaching({ sessionArchitectureVersion: runtimeArchitecture })
    && context.session.learningMode === "learn"
    && context.learningGoal.studyMode === "inside_yova"
    && !context.session.reviewType
  ) return "streamed" as const;
  if (isScheduledRetrievalSession(context.session)) return "full" as const;
  return canGenerateReliableSession(context) ? "reliable" as const : "full" as const;
}

export function generateProductionSessionWithOpenAI(context: SessionGenerationContext) {
  const generationContext = {
    ...context,
    sessionArchitectureVersion: sessionArchitectureForGeneration({
      storedVersion: context.sessionArchitectureVersion,
      learningMode: context.session.learningMode,
      studyMode: context.learningGoal.studyMode,
      reviewType: context.session.reviewType ?? null,
    }),
  };
  const strategy = sessionGenerationStrategy(generationContext);
  if (strategy === "streamed") return generateStreamedTeachingSkeletonWithOpenAI(generationContext);
  return strategy === "reliable" ? generateReliableSessionWithOpenAI(generationContext) : generateSessionWithOpenAI(generationContext);
}
