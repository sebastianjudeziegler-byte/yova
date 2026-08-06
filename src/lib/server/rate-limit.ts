import "server-only";

type RateRecord = { count: number; resetsAt: number };

const WINDOW_MS = 60_000;
const records = new Map<string, RateRecord>();

export function checkPlanGenerationRateLimit(key: string) {
  return checkRateLimit(`plan:${key}`, 6);
}

export function checkTutorRateLimit(key: string) {
  return checkRateLimit(`tutor:${key}`, 20);
}

export function checkSessionGenerationRateLimit(key: string) {
  return checkRateLimit(`session:${key}`, 10);
}

export function checkAnswerEvaluationRateLimit(key: string) {
  return checkRateLimit(`answer:${key}`, 24);
}

export function checkMaterialUploadRateLimit(key: string) {
  return checkRateLimit(`material:${key}`, 12);
}

export function checkProductEventRateLimit(key: string) {
  return checkRateLimit(`event:${key}`, 60);
}

export function checkSupportRequestRateLimit(key: string) {
  return checkRateLimit(`support:${key}`, 5);
}

export function checkErrorReportRateLimit(key: string) {
  return checkRateLimit(`error:${key}`, 10);
}

function checkRateLimit(key: string, maxRequests: number) {
  const now = Date.now();
  const existing = records.get(key);

  if (!existing || existing.resetsAt <= now) {
    records.set(key, { count: 1, resetsAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= maxRequests) {
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
