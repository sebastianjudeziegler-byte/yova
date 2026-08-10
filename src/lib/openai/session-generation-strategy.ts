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
import { usesStreamedTeaching } from "@/lib/session-generation/architecture";

/**
 * Keeps production and live quality evaluations on the same generation path.
 * The compact generator is faster and more predictable, but only for methods
 * whose complete learning sequence fits its deterministic activity shape.
 */
export function sessionGenerationStrategy(context: SessionGenerationContext) {
  if (
    usesStreamedTeaching({ sessionArchitectureVersion: context.sessionArchitectureVersion })
    && context.session.learningMode === "learn"
    && context.learningGoal.studyMode === "inside_yova"
    && !context.session.reviewType
  ) return "streamed" as const;
  if (isScheduledRetrievalSession(context.session)) return "full" as const;
  return canGenerateReliableSession(context) ? "reliable" as const : "full" as const;
}

export function generateProductionSessionWithOpenAI(context: SessionGenerationContext) {
  const strategy = sessionGenerationStrategy(context);
  if (strategy === "streamed") return generateStreamedTeachingSkeletonWithOpenAI(context);
  return strategy === "reliable" ? generateReliableSessionWithOpenAI(context) : generateSessionWithOpenAI(context);
}
