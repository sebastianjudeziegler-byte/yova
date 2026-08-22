import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(resolve(
  process.cwd(),
  "src/app/api/sessions/generate/route.ts",
), "utf8");
const cacheContract = readFileSync(resolve(
  process.cwd(),
  "src/lib/session-generation/cache-contract.ts",
), "utf8");

describe("scheduled-review generation route contract", () => {
  it("rejects a stale production adjustment before cache, claim, or provider work", () => {
    const sessionLookup = route.indexOf("if (!planSession || planSession.plan_id !== parsed.data.planId)");
    const rejection = route.indexOf("const scheduledAdjustmentIssue = scheduledRetrievalAdjustmentIssue(", sessionLookup);
    const planQueries = route.indexOf("const [{ data: plan, error: planError }", rejection);
    const cache = route.indexOf("const requestedCacheContext = buildSessionCacheContext({", rejection);
    const claim = route.indexOf('reserveAIRequest(supabase, "session_generation"', rejection);
    const provider = route.indexOf("generateProductionSessionWithOpenAI(", rejection);

    expect(rejection).toBeGreaterThan(sessionLookup);
    expect(route.slice(rejection, planQueries)).toContain('code: "scheduled_review_adjustment_not_supported"');
    expect(route.slice(rejection, planQueries)).toContain("status: 409");
    expect(rejection).toBeLessThan(planQueries);
    expect(rejection).toBeLessThan(cache);
    expect(rejection).toBeLessThan(claim);
    expect(rejection).toBeLessThan(provider);
  });

  it("forces an unchanged production review to study mode before cache identity is resolved", () => {
    const mode = route.indexOf("const effectiveLearningMode = learningModeForScheduledRetrieval(");
    const cache = route.indexOf("const requestedCacheContext = buildSessionCacheContext({");
    const generationContext = route.indexOf("const generationContext: SessionGenerationContext = {");

    expect(mode).toBeGreaterThan(-1);
    expect(cache).toBeGreaterThan(mode);
    expect(generationContext).toBeGreaterThan(cache);
    expect(route.slice(cache, generationContext)).toContain("adjustment: effectiveSessionAdjustment");
    expect(route.slice(generationContext)).toContain("sessionAdjustment: effectiveSessionAdjustment");
  });

  it("invalidates pre-contract scheduled caches by hashing exact stored scope into cache identity", () => {
    const cacheContext = route.indexOf("const requestedCacheContext = buildSessionCacheContext({");
    const cacheRead = route.indexOf("const cached = readCachedSession", cacheContext);
    const contractHelper = route.indexOf("function cacheGeneratedSession");

    expect(cacheContext).toBeGreaterThan(-1);
    expect(cacheRead).toBeGreaterThan(cacheContext);
    expect(route.slice(cacheContext, cacheRead)).toContain("contractKey: sessionCacheContractKey({");
    expect(route.slice(cacheContext, cacheRead)).toContain("topicIds: selectedTopics.map");
    expect(route.slice(cacheContext, cacheRead)).toContain("contentTargets: plannedContentTargets");
    expect(route.slice(cacheContext, cacheRead)).toContain("completionEvidence: plannedCompletionEvidence");
    expect(cacheContract).toContain('contract: "scheduled_review_v1"');
    expect(route).toContain('sessionCacheContractKey,\n} from "@/lib/session-generation/cache-contract"');
    expect(route.slice(cacheRead, contractHelper)).toContain(
      "(!cached.cacheContext && requestedCacheContext.contractFingerprint === undefined)",
    );
  });

  it("rejects a stale browser-preview adjustment before config, rate limit, or provider work", () => {
    const previewStart = route.indexOf("async function generateBrowserPreviewSession");
    const previewRoute = route.slice(previewStart);
    const rejection = previewRoute.indexOf("const scheduledAdjustmentIssue = scheduledRetrievalAdjustmentIssue(");
    const config = previewRoute.indexOf("if (!isOpenAISessionConfigured())");
    const rate = previewRoute.indexOf("checkSessionGenerationRateLimit(");
    const provider = previewRoute.indexOf("generateProductionSessionWithOpenAI(");

    expect(previewStart).toBeGreaterThan(-1);
    expect(rejection).toBeGreaterThan(-1);
    expect(rejection).toBeLessThan(config);
    expect(rejection).toBeLessThan(rate);
    expect(rejection).toBeLessThan(provider);
    expect(previewRoute.slice(rejection, config)).toContain('code: "scheduled_review_adjustment_not_supported"');
    expect(previewRoute.slice(rejection, config)).toContain("status: 409");
  });

  it("resolves a legacy reviewConcept-only row before rejecting an unlinked ordinary session", () => {
    const plannedTopics = route.indexOf('const plannedTopicIds = readStringArrayProperty(planSession.step_data, "topicIds")');
    const legacyResolution = route.indexOf("legacyScheduledRetrievalTopic({", plannedTopics);
    const emptyTopicGuard = route.indexOf("if (selectedTopics.length === 0)", plannedTopics);

    expect(plannedTopics).toBeGreaterThan(-1);
    expect(legacyResolution).toBeGreaterThan(plannedTopics);
    expect(legacyResolution).toBeLessThan(emptyTopicGuard);
    expect(route.slice(plannedTopics, emptyTopicGuard)).toContain("plannedTopicIds.length === 0");
    expect(route.slice(plannedTopics, emptyTopicGuard)).toContain("session: { reviewType, reviewConcept }");
  });

  it("rejects missing or duplicate explicit topic links instead of silently shrinking the session", () => {
    const plannedTopics = route.indexOf('const plannedTopicIds = readStringArrayProperty(planSession.step_data, "topicIds")');
    const exactResolution = route.indexOf("const exactExplicitTopicResolution", plannedTopics);
    const legacyResolution = route.indexOf("legacyScheduledRetrievalTopic({", plannedTopics);
    const selection = route.slice(exactResolution, legacyResolution);

    expect(exactResolution).toBeGreaterThan(plannedTopics);
    expect(exactResolution).toBeLessThan(legacyResolution);
    expect(selection).toContain("new Set(plannedTopicIds).size === plannedTopicIds.length");
    expect(selection).toContain("explicitlySelectedTopics.length === plannedTopicIds.length");
    expect(selection).toContain("topic.id === plannedTopicIds[index]");
    expect(selection).toContain("if (!exactExplicitTopicResolution)");
    expect(selection).toContain("status: 409");
  });
});
