import type { SessionAdjustment } from "@/lib/session-generation/schema";
import { AI_USAGE_OPERATION_IN_PROGRESS_CODE } from "@/lib/ai-usage/reservation-conflict";

export const SESSION_GENERATION_OPERATION_TTL_MS = 180_000;

export type PendingSessionGenerationOperation = {
  fingerprint: string;
  requestId: string;
  expiresAt: number;
};

type SessionGenerationOperationInput = {
  planId: string;
  planSessionId: string;
  adjustment: SessionAdjustment | null;
};

export function reusableSessionGenerationOperation(
  previous: PendingSessionGenerationOperation | null,
  input: SessionGenerationOperationInput,
  createRequestId: () => string,
  now = Date.now(),
): PendingSessionGenerationOperation {
  const fingerprint = sessionGenerationOperationFingerprint(input);
  if (
    previous
    && previous.fingerprint === fingerprint
    && previous.expiresAt > now
  ) return previous;

  return {
    fingerprint,
    requestId: createRequestId(),
    expiresAt: now + SESSION_GENERATION_OPERATION_TTL_MS,
  };
}

export function isSessionGenerationOperationInProgress(body: unknown) {
  return Boolean(
    body
    && typeof body === "object"
    && !Array.isArray(body)
    && "code" in body
    && body.code === AI_USAGE_OPERATION_IN_PROGRESS_CODE,
  );
}

function sessionGenerationOperationFingerprint({
  planId,
  planSessionId,
  adjustment,
}: SessionGenerationOperationInput) {
  return JSON.stringify([
    planId,
    planSessionId,
    adjustment
      ? [
        adjustment.familiarity,
        adjustment.availableMinutes,
        adjustment.knownTargets,
        adjustment.note,
      ]
      : null,
  ]);
}
