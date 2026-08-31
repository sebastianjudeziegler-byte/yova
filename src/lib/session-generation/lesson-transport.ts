export const CLIENT_STREAMED_LESSON_DEADLINE_MS = 110_000;

export class StreamedLessonDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`YOVA could not open this lesson within ${Math.ceil(timeoutMs / 1_000)} seconds. Try the lesson again.`);
    this.name = "StreamedLessonDeadlineError";
  }
}

export type StreamedLessonAttempt = Readonly<{
  operationId: string;
}>;

export function createStreamedLessonAttempt({
  create,
}: {
  create: () => string;
}): StreamedLessonAttempt {
  return { operationId: create() };
}

export function streamedLessonAttemptHeaders(attempt: StreamedLessonAttempt) {
  return { "X-Yova-Request-Id": attempt.operationId } as const;
}

/**
 * Applies one wall-clock deadline to the whole browser transport, including
 * request setup, authentication/preflight work, the response headers, and the
 * streamed body. The rejection boundary keeps the deadline absolute even if a
 * transport implementation is slow to observe its aborted signal.
 */
export async function withinStreamedLessonDeadline<T>({
  signal,
  run,
  timeoutMs = CLIENT_STREAMED_LESSON_DEADLINE_MS,
}: {
  signal?: AbortSignal;
  run: (signal: AbortSignal) => Promise<T>;
  timeoutMs?: number;
}): Promise<T> {
  if (signal?.aborted) throw externalAbortReason(signal);

  const transportController = new AbortController();
  let rejectBoundary: (reason: Error) => void = () => undefined;
  let boundarySettled = false;
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
  });
  const stop = (reason: Error) => {
    if (boundarySettled) return;
    boundarySettled = true;
    transportController.abort(reason);
    rejectBoundary(reason);
  };
  const onExternalAbort = () => {
    if (signal) stop(externalAbortReason(signal));
  };
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  const boundedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
  const timeoutId = setTimeout(() => {
    stop(new StreamedLessonDeadlineError(boundedTimeoutMs));
  }, boundedTimeoutMs);

  try {
    return await Promise.race([
      Promise.resolve().then(() => run(transportController.signal)),
      boundary,
    ]);
  } finally {
    boundarySettled = true;
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

function externalAbortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The lesson request was stopped.", "AbortError");
}
