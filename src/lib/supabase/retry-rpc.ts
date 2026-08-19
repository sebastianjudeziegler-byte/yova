import "server-only";

type SupabaseRpcResult<T> = {
  data: T | null;
  error: unknown;
  status?: number;
};

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 100;

/**
 * Retries an idempotent or lease-based Supabase RPC once. The cleanup cron is
 * deliberately tolerant of a single transient API-gateway rejection, while a
 * second failure still fails closed so a broken credential cannot be hidden.
 */
export async function retrySupabaseRpc<T>(
  operationName: string,
  operation: () => PromiseLike<SupabaseRpcResult<T>>,
): Promise<SupabaseRpcResult<T>> {
  let lastResult: SupabaseRpcResult<T> = { data: null, error: new Error("RPC did not run") };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      lastResult = await operation();
    } catch (error) {
      lastResult = { data: null, error };
    }

    if (!lastResult.error) return lastResult;

    console.warn("Supabase maintenance RPC failed", {
      operation: operationName,
      attempt,
      status: boundedStatus(lastResult.status),
      code: boundedErrorCode(lastResult.error),
      willRetry: attempt < MAX_ATTEMPTS,
    });

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  return lastResult;
}

function boundedStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function boundedErrorCode(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : null;
}
