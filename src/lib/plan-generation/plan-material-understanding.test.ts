import { describe, expect, it } from "vitest";
import { applyPlanMaterialUnderstanding, materialUnderstandingForPlan } from "./plan-material-understanding";
import { baselineSourceForTopic } from "@/lib/session-shapes/source-context";
import { deltaFixture } from "@/evals/personalization-delta-fixture";
import type { LearningMaterial } from "@/lib/domain";

const topic = deltaFixture(1).request.knowledgeMap!.topics[0]!;
const id = "99999999-9999-4999-8999-999999999999";
const source: LearningMaterial = { id, name: "Course scope.txt", mimeType: "text/plain", sizeBytes: 100, processingStatus: "ready", textContent: "Scope instructions that must never become teaching facts.", understanding: { version: 1, role: "scope_outline", roleReason: "The learner selected this source classification during plan setup.", mixedSections: [], topics: [topic], chunkCount: 1, mappedAt: "2026-09-17T12:00:00Z" } };

describe("plan scoped source understanding", () => {
  it("restores signed scope roles on reload and excludes those files from session excerpts", () => {
    const generationInputs = { materialUnderstandingOverrides: materialUnderstandingForPlan([source]) };
    const reloaded = applyPlanMaterialUnderstanding([{ ...source, understanding: { ...source.understanding!, role: "content_source" } }], generationInputs);
    expect(reloaded[0]!.understanding!.role).toBe("scope_outline");
    expect(baselineSourceForTopic({ materials: reloaded, sourceMode: "user_materials" }, { ...topic, origin: "material", attachedSources: [{ material_id: id }] })).toEqual({ description: null, excerpts: [] });
  });
  it("does not attach another plan's material or mutate shared metadata", () => {
    const stored = [{ ...source, understanding: undefined }];
    const reloaded = applyPlanMaterialUnderstanding(stored, { materialUnderstandingOverrides: [{ materialId: "88888888-8888-4888-8888-888888888888", understanding: source.understanding }] });
    expect(reloaded).toEqual(stored);
    expect(stored[0]!.understanding).toBeUndefined();
  });
  it("ignores malformed metadata while preserving the original material understanding", () => {
    expect(applyPlanMaterialUnderstanding([source], { materialUnderstandingOverrides: [{ materialId: id, understanding: { role: "content_source" } }] })).toEqual([source]);
  });
});
