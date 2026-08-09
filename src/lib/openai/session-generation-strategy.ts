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

/**
 * Keeps production and live quality evaluations on the same generation path.
 * The compact generator is faster and more predictable, but only for methods
 * whose complete learning sequence fits its deterministic activity shape.
 */
export function sessionGenerationStrategy(context: SessionGenerationContext) {
  if (isScheduledRetrievalSession(context.session)) return "full" as const;
  return canGenerateReliableSession(context) ? "reliable" as const : "full" as const;
}

export function generateProductionSessionWithOpenAI(context: SessionGenerationContext) {
  return sessionGenerationStrategy(context) === "reliable"
    ? generateReliableSessionWithOpenAI(context)
    : generateSessionWithOpenAI(context);
}
