import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";

export const SESSION_ARCHITECTURE_VERSIONS = [
  "filled_teaching_v1",
  "streamed_teaching_v1",
] as const;

export type SessionArchitectureVersion = (typeof SESSION_ARCHITECTURE_VERSIONS)[number];

export const LEGACY_SESSION_ARCHITECTURE: SessionArchitectureVersion = "filled_teaching_v1";
export const STREAMED_SESSION_ARCHITECTURE: SessionArchitectureVersion = "streamed_teaching_v1";

export function readSessionArchitectureVersion(value: unknown): SessionArchitectureVersion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return LEGACY_SESSION_ARCHITECTURE;
  return (value as Record<string, unknown>).sessionArchitectureVersion === STREAMED_SESSION_ARCHITECTURE
    ? STREAMED_SESSION_ARCHITECTURE
    : LEGACY_SESSION_ARCHITECTURE;
}

/**
 * Plans created during the knowledge-map rollout can have the complete modern
 * topic map without the architecture stamp that newer plans persist. Treat
 * only that missing-stamp case as streamed teaching. A stored architecture
 * value, including an invalid value, remains authoritative so compatibility
 * recovery never silently changes an explicitly versioned plan.
 */
export function resolveSessionArchitectureVersion(
  value: unknown,
  knowledgeMap: unknown,
): SessionArchitectureVersion {
  if (hasStoredArchitectureVersion(value)) return readSessionArchitectureVersion(value);
  return PlanKnowledgeMapSchema.safeParse(knowledgeMap).success
    ? STREAMED_SESSION_ARCHITECTURE
    : LEGACY_SESSION_ARCHITECTURE;
}

export function usesStreamedTeaching(value: unknown) {
  return readSessionArchitectureVersion(value) === STREAMED_SESSION_ARCHITECTURE;
}

/**
 * Unscoped subject-specific browser lessons predate streamed teaching and are
 * safe only for legacy plans. Modern emergency recovery must instead use the
 * exact-session allowlist, full-coverage gate, and conservative topic-evidence
 * binding in built-in-fallback.ts.
 */
export function allowsLegacySessionFallback(value: unknown) {
  return !usesStreamedTeaching(value);
}

function hasStoredArchitectureVersion(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!Object.prototype.hasOwnProperty.call(value, "sessionArchitectureVersion")) return false;
  // Plain TypeScript objects can carry an optional key whose runtime value is
  // undefined. That is still an unstamped plan, not an explicit legacy choice.
  return (value as Record<string, unknown>).sessionArchitectureVersion !== undefined;
}
