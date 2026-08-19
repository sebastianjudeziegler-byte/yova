import { z } from "zod";

/**
 * Chooses the text a learner should see when a thrown value reaches the UI.
 *
 * Some thrown values carry a message written for the learner. Others do not:
 * a ZodError's `message` is a JSON dump of its issue list, and it satisfies
 * `error instanceof Error`, so the common
 * `error instanceof Error ? error.message : fallback` pattern renders raw
 * validation internals onto the screen. Schema failures are always a defect in
 * YOVA rather than something the learner can act on, so they resolve to the
 * caller's fallback instead.
 */
export function userFacingErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof z.ZodError) return fallback;
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message || looksLikeSerializedData(message)) return fallback;
  return message;
}

/**
 * Guards against thrown values that wrap a serialized payload in their message
 * without being a ZodError, such as a re-thrown validation failure or a raw
 * response body.
 */
function looksLikeSerializedData(message: string) {
  return message.startsWith("[") || message.startsWith("{");
}
