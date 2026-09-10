import { describe, expect, it } from "vitest";
import { deltaFixture, deltaTopicId } from "./personalization-delta-fixture";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { composeNormalPlanEnvelopes } from "@/lib/plan-generation/normal-plan-envelopes";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { studyRouteSourceBindingIssue } from "@/lib/study-route/source-contract";

const materialId = "b0000000-0000-4000-8000-000000000001";
const chunkId = "b0000000-0000-4000-8000-000000000002";

function mixedSourcePlan() {
  const fixture = deltaFixture(2);
  fixture.request.materialMode = "upload";
  fixture.request.materials = [{
    id: materialId, name: "Cellular energetics lecture.pdf", mimeType: "application/pdf",
    sizeBytes: 1200, processingStatus: "ready", textContent: null,
  }];
  const topic = fixture.request.knowledgeMap!.topics[0]!;
  topic.origin = "material";
  topic.attachedSources = [{ material_id: materialId }];
  topic.sourceReferences = [{
    materialId, chunkId, chunkIndex: 0, startCharacter: 0, endCharacter: 180,
    locationLabel: "Page 1 — ATP and energy transfer", sectionRole: "content_source",
  }];
  const composition = composeNormalPlanEnvelopes({
    ...fixture, learningIntentRecommendation: { intent: "learn", basis: "Teach the accepted topics before checking them." },
  });
  const input = { ...fixture, composition };
  return commitPlanStudyRoutes(buildNormalPlanFromFixedEnvelope({
    ...input, fill: buildNormalPlanFallbackFill(input),
  }), "2026-09-07T08:01:00.000Z");
}

describe("Brief C source-first entry authority", () => {
  it("opens the unsourced topic in a mixed PDF plan without asking the learner to rebuild it", () => {
    const plan = mixedSourcePlan();
    const session = plan.sessions.find(item => item.learningMode === "learn" && item.topicIds?.includes(deltaTopicId(1)))!;
    expect(session.title).toMatch(/enzymes/i);
    expect(session.objective).toMatch(/enzymes/i);
    const issue = studyRouteSourceBindingIssue(session.studyRoute, {
      readyMaterialIds: [materialId], selectedChunkMaterialIds: [],
    });
    expect(issue, `${session.title}: ${issue ?? "Ready to open"}`).toBeNull();
  });

  it("allows the sourced topic to open its exact PDF section", () => {
    const plan = mixedSourcePlan();
    const session = plan.sessions.find(item => item.learningMode === "learn" && item.topicIds?.includes(deltaTopicId(0)))!;
    expect(session.objective).toMatch(/ATP/i);
    expect(studyRouteSourceBindingIssue(session.studyRoute, {
      readyMaterialIds: [materialId], selectedChunkMaterialIds: [materialId],
    })).toBeNull();
  });

  it("still refuses a sourced block when its PDF is unavailable or a different source is substituted", () => {
    const session = mixedSourcePlan().sessions.find(item => item.learningMode === "learn" && item.topicIds?.includes(deltaTopicId(0)))!;
    expect(studyRouteSourceBindingIssue(session.studyRoute, {
      readyMaterialIds: [], selectedChunkMaterialIds: [],
    })).not.toBeNull();
    expect(studyRouteSourceBindingIssue(session.studyRoute, {
      readyMaterialIds: [materialId], selectedChunkMaterialIds: ["b0000000-0000-4000-8000-000000000099"],
    })).not.toBeNull();
  });
});
