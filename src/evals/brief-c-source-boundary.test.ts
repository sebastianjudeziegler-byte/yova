import { usesTopicSourceBinding } from "@/lib/study-route/topic-source-binding";
import { describe, expect, it } from "vitest";
import { deltaFixture, deltaTopicId } from "./personalization-delta-fixture";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { composeNormalPlanEnvelopes } from "@/lib/plan-generation/normal-plan-envelopes";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { studyRouteSourceBindingIssue } from "@/lib/study-route/source-contract";
import { buildPlanRevision } from "@/lib/plan-revision/build-plan-revision";

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

  it("never inherits another topic's attached source requirement", () => {
    const plan = mixedSourcePlan();
    for (const session of plan.sessions.filter(item => !item.topicIds?.includes(deltaTopicId(0)))) {
      expect(session.studyRoute!.target.sourceRequirements.requiredSourceIds, session.title).toEqual([]);
      expect(session.studyRoute!.target.sourceRequirements.sourceType, session.title).toBe("yova_generated");
    }
  });

  it("revises one topic's source with every unrelated session byte-identical", async () => {
    const plan = mixedSourcePlan();
    const fixture = deltaFixture(2);
    const changedTopic = deltaTopicId(1);
    const unchanged = plan.sessions.filter(item => !item.topicIds?.includes(changedTopic));
    const before = new Map(unchanged.map(item => [item.id, JSON.stringify(item)]));
    const proposal = await buildPlanRevision({
      ...fixture, request: { ...fixture.request, materialMode: "upload", materials: plan.materials!.map(item => ({ ...item, textContent: null, processingStatus: "ready" as const })), knowledgeMap: plan.knowledgeMap },
      plan: { ...plan, status: "active" },
      delta: { operations: [{ op: "attach_source", topic_id: changedTopic, material_id: materialId }] },
      controls: { excludedOperationIndexes: [], sessionEdits: [] }, protections: [], otherReservations: [],
      contextKind: "active", fill: async input => buildNormalPlanFallbackFill(input),
    });
    expect(proposal.canApply, proposal.capacity.explanation).toBe(true);
    expect(proposal.lines[0]!.after.join(" ")).toContain("Study this source, then practice");
    for (const [id, bytes] of before) expect(JSON.stringify(proposal.after.sessions.find(item => item.id === id)), id).toBe(bytes);
    const revised = proposal.after.sessions.find(item => item.topicIds?.includes(changedTopic))!;
    expect(revised.studyRoute!.target.sourceRequirements.requiredSourceIds).toEqual([materialId]);
    expect(usesTopicSourceBinding(revised.studyRoute!)).toBe(true);
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

  it("does not silently adopt a changed topic attachment or give an unsourced topic a foreign section", () => {
    const plan = mixedSourcePlan();
    const sourced = plan.sessions.find(item => item.topicIds?.includes(deltaTopicId(0)))!;
    const unsourced = plan.sessions.find(item => item.topicIds?.includes(deltaTopicId(1)))!;
    expect(studyRouteSourceBindingIssue(sourced.studyRoute, {
      readyMaterialIds: [materialId], selectedChunkMaterialIds: [materialId], topicSourceIds: [],
    })).not.toBeNull();
    expect(studyRouteSourceBindingIssue(unsourced.studyRoute, {
      readyMaterialIds: [materialId], selectedChunkMaterialIds: [materialId], topicSourceIds: [],
    })).not.toBeNull();
  });
});
