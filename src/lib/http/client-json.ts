export const GENERATION_REQUEST_TIMEOUT_MS = 125_000;
export const MUTATION_REQUEST_TIMEOUT_MS = 45_000;

type ClientJsonRequestOptions = {
  timeoutMs: number;
  timeoutMessage: string;
  invalidResponseMessage: string;
};

/**
 * Runs a browser request with a finite deadline and parses JSON without
 * leaking platform HTML or an empty edge response into learner-facing copy.
 * Non-2xx responses deliberately retain a nullable body so the caller can
 * apply its operation-specific fallback message.
 */
export async function fetchClientJson(
  input: RequestInfo | URL,
  init: RequestInit,
  options: ClientJsonRequestOptions,
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(options.timeoutMessage);
      throw error;
    }

    const body: unknown = await response.json().catch(() => null);
    if (response.ok && body === null) throw new Error(options.invalidResponseMessage);
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}
