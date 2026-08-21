import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/sessions/generate/route.ts"),
  "utf8",
);

describe("guided-session allowance settlement contract", () => {
  it("captures the allowed claim and returns it before every failed response", () => {
    expect(routeSource).toContain("aiUsageClaimId = durableLimit.claimId ?? null");
    expect(routeSource.match(/await releaseFailedGenerationClaim\(/g)).toHaveLength(3);

    const helperBoundary = routeSource.indexOf("async function releaseFailedGenerationClaim");
    const catchBoundary = routeSource.lastIndexOf("  } catch (error) {", helperBoundary);
    const failureResponse = routeSource.indexOf("guidedSessionFailureResponse(", catchBoundary);
    const release = routeSource.indexOf("await releaseFailedGenerationClaim(", catchBoundary);
    expect(catchBoundary).toBeGreaterThan(0);
    expect(release).toBeGreaterThan(catchBoundary);
    expect(release).toBeLessThan(failureResponse);
  });

  it("does not release the claim on the successful generated-session response", () => {
    const successStart = routeSource.indexOf("logSuccessfulGeneration(");
    const successEnd = routeSource.indexOf("} catch (error) {", successStart);
    expect(routeSource.slice(successStart, successEnd)).not.toContain("releaseFailedGenerationClaim");
  });
});
