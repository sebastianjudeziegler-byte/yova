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

describe("ordinary mixed-provenance generation route contract", () => {
  it("passes every selected topic and only its mapped chunks into generation", () => {
    const selection = route.indexOf("const selectedTopics = explicitlySelectedTopics.length > 0");
    const orderedChunks = route.indexOf("const orderedChunkIds = Array.from(new Set(", selection);
    const generationContext = route.indexOf("const generationContext: SessionGenerationContext = {", orderedChunks);
    const provider = route.indexOf("generateProductionSessionWithOpenAI(", generationContext);

    expect(selection).toBeGreaterThan(-1);
    expect(orderedChunks).toBeGreaterThan(selection);
    expect(generationContext).toBeGreaterThan(orderedChunks);
    expect(route.slice(orderedChunks, generationContext)).toContain(
      "selectedTopics.flatMap((topic) => topic.sourceReferences.map",
    );
    expect(route.slice(generationContext, provider)).toContain("materials: materialExcerpts");
    expect(route.slice(generationContext, provider)).toContain("knowledgeTopics: selectedTopics");
    expect(route.slice(generationContext, provider)).toContain("topicIds: routeGeneration.topicIds");
  });

  it("invalidates a pre-contract mixed cache using ordered topic provenance and active targets", () => {
    const cacheContext = route.indexOf("const requestedCacheContext = buildSessionCacheContext({");
    const cacheRead = route.indexOf("const cached = readCachedSession", cacheContext);
    const helperSource = cacheContract;

    expect(route.slice(cacheContext, cacheRead)).toContain("knowledgeTopics: selectedTopics");
    expect(route).toContain('sessionCacheContractKey,\n} from "@/lib/session-generation/cache-contract"');
    expect(helperSource).toContain('contract: "mixed_provenance_v1"');
    expect(helperSource).toContain('"mapped_material" as const');
    expect(helperSource).toContain('"model_knowledge" as const');
    expect(helperSource).toContain("allowedChunkIds:");
    expect(helperSource).toContain("contentTargets,");
    expect(helperSource).toContain("completionEvidence,");
  });

  it("invalidates every legacy continuation cache and composes its exact scope with source provenance", () => {
    const cacheContext = route.indexOf("const requestedCacheContext = buildSessionCacheContext({");
    const cacheRead = route.indexOf("const cached = readCachedSession", cacheContext);
    const helperSource = cacheContract;

    expect(route.slice(cacheContext, cacheRead)).toContain(
      "title: normalPlanGenerationCopy?.sessionTitle ?? planSession.title",
    );
    expect(route.slice(cacheContext, cacheRead)).toContain("methodReason: routeGeneration.methodReason");
    expect(helperSource).toContain("isDeferredSessionContinuation({ title, methodReason })");
    expect(helperSource).toContain('contract: "deferred_continuation_v1"');
    expect(helperSource).toContain("topicIds,");
    expect(helperSource).toContain("contentTargets,");
    expect(helperSource).toContain("completionEvidence,");
    expect(helperSource).toContain("topicProvenance,");
  });
});
