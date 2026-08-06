import type { SessionAdaptationNote } from "@/lib/domain";

export function createSessionAdaptationNote(
  explanation: string,
  adaptedAt: string,
): SessionAdaptationNote | undefined {
  const normalizedExplanation = explanation.trim();
  if (!normalizedExplanation || Number.isNaN(Date.parse(adaptedAt))) return undefined;
  return { explanation: normalizedExplanation, adaptedAt };
}

export function readSessionAdaptationNote(stepData: unknown): SessionAdaptationNote | undefined {
  if (!stepData || typeof stepData !== "object" || Array.isArray(stepData)) return undefined;
  const value = stepData as Record<string, unknown>;
  if (typeof value.adaptationExplanation !== "string" || typeof value.adaptedAt !== "string") return undefined;
  return createSessionAdaptationNote(value.adaptationExplanation, value.adaptedAt);
}
