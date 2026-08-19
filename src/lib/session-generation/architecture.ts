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
 * Teaching-first is a runtime delivery choice, not a compatibility boundary.
 * Older saved plans can keep their stored schema stamp while ordinary
 * inside-YOVA learn sessions use the current streamed reader and cache shape.
 * Reviews retain their original architecture. Outside-YOVA teaching-first
 * work also stays filled because its concise subject model and external-method
 * handoff are generated and validated as one bounded session.
 */
export function sessionArchitectureForGeneration({
  storedVersion,
  learningMode,
  studyMode,
  reviewType,
}: {
  storedVersion?: SessionArchitectureVersion;
  learningMode: "learn" | "study";
  studyMode: string;
  reviewType: "repair_and_retrieve" | "verify" | "maintenance_transfer" | null;
}): SessionArchitectureVersion {
  if (learningMode === "learn" && studyMode === "inside_yova" && !reviewType) {
    return STREAMED_SESSION_ARCHITECTURE;
  }
  return storedVersion ?? LEGACY_SESSION_ARCHITECTURE;
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
