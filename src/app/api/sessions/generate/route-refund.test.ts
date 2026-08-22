import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/sessions/generate/route.ts"),
  "utf8",
);

describe("guided-session allowance settlement contract", () => {
  it("captures the allowed claim and returns it before every failed response", () => {
    expect(routeSource).toContain(
      'reserveAIRequest(supabase, "session_generation", requestId, aiUsageRecoveryKey)',
    );
    expect(routeSource).toContain("aiUsageClaimId = durableLimit.claimId");
    expect(routeSource.match(/await releaseFailedGenerationClaim\(/g)).toHaveLength(4);

    const helperBoundary = routeSource.indexOf("async function releaseFailedGenerationClaim");
    const catchBoundary = routeSource.lastIndexOf("  } catch (error) {", helperBoundary);
    const failureResponse = routeSource.indexOf("guidedSessionFailureResponse(", catchBoundary);
    const release = routeSource.indexOf("await releaseFailedGenerationClaim(", catchBoundary);
    expect(catchBoundary).toBeGreaterThan(0);
    expect(release).toBeGreaterThan(catchBoundary);
    expect(release).toBeLessThan(failureResponse);
  });

  it("settles, rather than releases, the claim on a validated successful response", () => {
    const successStart = routeSource.indexOf("const learnerResponse = NextResponse.json(");
    const successEnd = routeSource.indexOf("} catch (error) {", successStart);
    expect(routeSource.slice(successStart, successEnd)).not.toContain("releaseFailedGenerationClaim");
    expect(routeSource.slice(successStart, successEnd)).toContain(
      "await settleSuccessfulGenerationClaim(supabase, aiUsageClaimId, requestId)",
    );

    const responseBuilt = routeSource.indexOf("const learnerResponse = NextResponse.json(", successStart);
    const settled = routeSource.indexOf("await settleSuccessfulGenerationClaim(", responseBuilt);
    const returned = routeSource.indexOf("return learnerResponse", settled);
    expect(settled).toBeGreaterThan(responseBuilt);
    expect(returned).toBeGreaterThan(settled);
  });

  it("recovers a committed claim by operation key when the reserve receipt is unknown", () => {
    const reservation = routeSource.indexOf(
      'reserveAIRequest(supabase, "session_generation", requestId, aiUsageRecoveryKey)',
    );
    const reservationCatch = routeSource.indexOf("} catch {", reservation);
    const recovery = routeSource.indexOf(
      "await recoverUnknownGenerationReservation(supabase, requestId, aiUsageRecoveryKey)",
      reservationCatch,
    );
    const gateFailure = routeSource.indexOf("YOVA paused before using OpenAI", reservationCatch);

    expect(reservationCatch).toBeGreaterThan(reservation);
    expect(recovery).toBeGreaterThan(reservationCatch);
    expect(recovery).toBeLessThan(gateFailure);
    expect(routeSource).toContain(
      'releaseAIRequestReservation(supabase, "session_generation", operationKey, recoveryKey)',
    );
  });

  it("keeps the recovery credential server-only and distinct from the public request id", () => {
    expect(routeSource).toContain("const aiUsageRecoveryKey = crypto.randomUUID()");
    expect(routeSource).not.toContain('request.headers.get("X-Yova-Recovery-Key")');
    expect(routeSource).not.toContain('"X-Yova-Recovery-Key"');

    const reservation = routeSource.indexOf(
      'reserveAIRequest(supabase, "session_generation", requestId, aiUsageRecoveryKey)',
    );
    const recovery = routeSource.indexOf(
      "recoverUnknownGenerationReservation(supabase, requestId, aiUsageRecoveryKey)",
      reservation,
    );
    expect(reservation).toBeGreaterThan(-1);
    expect(recovery).toBeGreaterThan(reservation);
  });

  it("returns a retryable non-quota conflict before provider work for a live operation replay", () => {
    const reservation = routeSource.indexOf(
      'reserveAIRequest(supabase, "session_generation", requestId, aiUsageRecoveryKey)',
    );
    const conflict = routeSource.indexOf("aiUsageReservationConflict(durableLimit)", reservation);
    const conflictResponse = routeSource.indexOf("status: 409", conflict);
    const provider = routeSource.indexOf("sessionGenerationRuntime(request, startedAt)", reservation);

    expect(conflict).toBeGreaterThan(reservation);
    expect(conflictResponse).toBeGreaterThan(conflict);
    expect(conflictResponse).toBeLessThan(provider);
    expect(routeSource.slice(conflict, provider)).toContain('"Retry-After"');
    expect(routeSource.slice(conflict, provider)).toContain("retryable: conflict.retryable");
  });

  it("preserves the quota-specific 429 response and reset headers", () => {
    expect(routeSource).toContain(
      "guidedSessionAllowanceExhaustedResponse(durableLimit.retryAfterSeconds)",
    );
    expect(routeSource).toContain(
      "...guidedSessionAllowanceExhaustedHeaders(durableLimit.retryAfterSeconds)",
    );
  });

  it("keeps a valid response usable when settlement cannot be confirmed", () => {
    const helper = routeSource.slice(
      routeSource.indexOf("async function settleSuccessfulGenerationClaim"),
      routeSource.indexOf("async function recoverUnknownGenerationReservation"),
    );
    expect(helper).toContain("try {");
    expect(helper).toContain("await settleAIRequestClaim(supabase, claimId)");
    expect(helper).toContain("} catch {");
    expect(helper).not.toContain("throw");
  });

  it("refunds a failed claim before inspecting recovery diagnostics", () => {
    const helperBoundary = routeSource.indexOf("async function releaseFailedGenerationClaim");
    const catchBoundary = routeSource.lastIndexOf("  } catch (error) {", helperBoundary);
    const failureResponse = routeSource.indexOf("guidedSessionFailureResponse(", catchBoundary);
    const failedRequestPath = routeSource.slice(catchBoundary, failureResponse);

    expect(failedRequestPath).toContain("await releaseFailedGenerationClaim(");
    expect(failedRequestPath).not.toContain("recoveryMode");
  });

  it("gives provider work one absolute deadline before the allowance-settlement path", () => {
    expect(routeSource).toContain("deadlineAt: startedAt + SESSION_GENERATION_SERVER_BUDGET_MS");
    expect(routeSource).toContain("settlementReserveMs: SESSION_GENERATION_SETTLEMENT_RESERVE_MS");
    expect(routeSource).toContain("signal: request.signal");

    const claim = routeSource.indexOf("aiUsageClaimId = durableLimit.claimId");
    const generated = routeSource.indexOf(
      "sessionGenerationRuntime(request, startedAt)",
      claim,
    );
    const helperBoundary = routeSource.indexOf("async function releaseFailedGenerationClaim");
    const catchBoundary = routeSource.lastIndexOf("  } catch (error) {", helperBoundary);
    const release = routeSource.indexOf("await releaseFailedGenerationClaim(", catchBoundary);

    expect(generated).toBeGreaterThan(claim);
    expect(catchBoundary).toBeGreaterThan(generated);
    expect(release).toBeGreaterThan(catchBoundary);
  });

  it("keeps cache, success, and failure telemetry best-effort", () => {
    expect(routeSource).not.toContain("await recordGenerationObservation(");
    expect(routeSource.match(/recordGenerationObservationBestEffort\(/g)).toHaveLength(4);
    const helper = routeSource.slice(
      routeSource.indexOf("function recordGenerationObservationBestEffort"),
      routeSource.indexOf("async function generateBrowserPreviewSession"),
    );
    expect(helper).toContain("try {");
    expect(helper).toContain("Promise.resolve(recordGenerationObservation(...args)).catch");
    expect(helper).toContain("} catch {");
  });

  it("does not expose a browser-only lesson when its deferred targets need the cloud continuation receipt", () => {
    const cacheWrite = routeSource.indexOf('supabase.rpc("cache_generated_session"');
    const deferredFailure = routeSource.indexOf("generatedSessionDefersStoredPlanTargets(cachedSession, plannedContentTargets)");
    const browserPersistence = routeSource.indexOf('persistence: cacheError ? "browser" : "supabase"');

    expect(cacheWrite).toBeGreaterThan(-1);
    expect(deferredFailure).toBeGreaterThan(cacheWrite);
    expect(deferredFailure).toBeLessThan(browserPersistence);
    expect(routeSource.slice(deferredFailure, browserPersistence)).toContain(
      'code: "deferred_session_persistence_unavailable"',
    );
    expect(routeSource.slice(deferredFailure, browserPersistence)).toContain(
      "releaseFailedGenerationClaim(supabase, aiUsageClaimId, requestId)",
    );
  });
});
