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

export function usesStreamedTeaching(value: unknown) {
  return readSessionArchitectureVersion(value) === STREAMED_SESSION_ARCHITECTURE;
}

/**
 * The subject-specific browser lessons predate streamed teaching and do not
 * carry topic ids or lesson briefs. They are safe only for legacy plans. A
 * streamed plan must preserve its exact topic and surface a retryable error
 * instead of silently substituting unrelated demo content.
 */
export function allowsLegacySessionFallback(value: unknown) {
  return !usesStreamedTeaching(value);
}
