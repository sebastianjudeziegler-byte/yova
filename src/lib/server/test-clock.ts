import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";

export const TEST_CLOCK_HEADER = "X-Yova-Test-Now";

/**
 * Resolves the "current time" a server route should schedule against.
 *
 * Browser tests freeze `page.clock`, but plan generation runs on the server,
 * which otherwise reads the real wall clock. Without this, the same plan
 * request yields a different session count depending on the time of day CI
 * runs (e.g. Monday's evening window is gone after ~19:00 local), which is
 * why scheduling assertions failed only in evening CI runs.
 *
 * The override is honoured ONLY for development-preview requests, which are
 * themselves gated on NODE_ENV === "development", so it can never affect a
 * production deployment. Any unparseable value falls back to the real clock.
 */
export function resolveRequestNow(
  request: Request,
  fallbackMs = Date.now(),
  nodeEnvironment = process.env.NODE_ENV,
): number {
  if (!isDevelopmentPreviewRequest(request, nodeEnvironment)) return fallbackMs;
  const raw = request.headers.get(TEST_CLOCK_HEADER);
  if (!raw) return fallbackMs;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}
