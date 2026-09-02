export type SessionTerminalMutationKind = "completion" | "interruption";

export type NonRetryableSessionTerminalRejection =
  | "invalid_payload"
  | "incompatible_cloud_state";

/**
 * A privacy-safe disposition for a terminal write that the server has proven
 * cannot succeed when replayed with the exact same payload. The original
 * database error is deliberately not retained on this browser-facing error.
 */
export class NonRetryableSessionTerminalMutationError extends Error {
  readonly disposition = "quarantine" as const;

  constructor(
    readonly terminalKind: SessionTerminalMutationKind,
    readonly rejection: NonRetryableSessionTerminalRejection,
    message = "YOVA could not safely replay this saved session event to the cloud.",
  ) {
    super(message);
    this.name = "NonRetryableSessionTerminalMutationError";
  }
}

export function isNonRetryableSessionTerminalMutationError(
  error: unknown,
): error is NonRetryableSessionTerminalMutationError {
  return error instanceof NonRetryableSessionTerminalMutationError;
}
