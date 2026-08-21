export const AI_USAGE_OPERATION_IN_PROGRESS_CODE = "ai_operation_in_progress";

export type AIUsageReservationDenial = {
  allowed: false;
  denialReason:
    | "usage_limit"
    | "operation_in_progress"
    | "operation_already_consumed"
    | "operation_already_released";
  retryAfterSeconds: number;
};

export type AIUsageReservationConflict = {
  code:
    | typeof AI_USAGE_OPERATION_IN_PROGRESS_CODE
    | "ai_operation_already_consumed"
    | "ai_operation_already_released";
  error: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
};

/** Distinguishes an idempotency conflict from actual allowance exhaustion. */
export function aiUsageReservationConflict(
  reservation: AIUsageReservationDenial,
): AIUsageReservationConflict | null {
  if (reservation.denialReason === "usage_limit") return null;
  if (reservation.denialReason === "operation_in_progress") {
    return {
      code: AI_USAGE_OPERATION_IN_PROGRESS_CODE,
      error: "This AI request is already being prepared.",
      retryable: true,
      retryAfterSeconds: Math.max(1, reservation.retryAfterSeconds),
    };
  }
  return {
    code: reservation.denialReason === "operation_already_consumed"
      ? "ai_operation_already_consumed"
      : "ai_operation_already_released",
    error: "This AI request has already finished. Start a new attempt if you still need it.",
    retryable: false,
    retryAfterSeconds: null,
  };
}
