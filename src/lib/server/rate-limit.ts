import "server-only";

type RateRecord = { count: number; resetsAt: number };

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 6;
const records = new Map<string, RateRecord>();

export function checkPlanGenerationRateLimit(key: string) {
  const now = Date.now();
  const existing = records.get(key);

  if (!existing || existing.resetsAt <= now) {
    records.set(key, { count: 1, resetsAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetsAt - now) / 1_000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function requestRateLimitKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "local-alpha";
}
