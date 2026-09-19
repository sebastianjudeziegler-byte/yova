import { describe, expect, it } from "vitest";
import { applySetupCorrections, initialSetupCorrections, SetupCorrectionsSchema } from "./setup-corrections";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import type { LearningMaterial } from "@/lib/domain";
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const map: PlanKnowledgeMap = {
 version: 1, scopeJudgment: { band: "focused_skill", label: "Cell transport", minimumSessions: 1, recommendedSessions: 2, maximumSessions: 4, minimumTeachingSessions: 1, explanation: "Learn the relationships between cell transport processes." },
 topics: ids.slice(0, 2).map((id, index) => ({ id, title: index ? "Osmosis" : "Diffusion", description: "Explain cell transport with examples.", subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null })),
 placementCheck: { status: "available", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
};
const material: LearningMaterial = { id: ids[2], name: "Biology notes.txt", mimeType: "text/plain", sizeBytes: 500, textContent: "Diffusion and osmosis", processingStatus: "ready" };
const corrections = () => ({ materials: [{ materialId: ids[2], role: "scope_outline" as const }], topics: map.topics.map(topic => ({ id: topic.id, materialId: ids[2], covered: false })) });
describe("setup corrections", () => {
 // Brief 2.5 root cause 5 (finding 14): with a study guide and a content PDF
 // uploaded, every topic pre-selected the study guide - the first reference the
 // model listed - which sends every topic down the scope-outline path.
 it("pre-selects the content source over the study guide when a topic has both", () => {
  const guideId = "55555555-5555-4555-8555-555555555555", pdfId = "66666666-6666-4666-8666-666666666666";
  const understanding = (role: "content_source" | "scope_outline") => ({ role }) as unknown as LearningMaterial["understanding"];
  const materials: LearningMaterial[] = [
   { id: guideId, name: "Unit 6 study guide.pdf", mimeType: "application/pdf", sizeBytes: 900, textContent: "Unit 6 test scope", processingStatus: "ready", understanding: understanding("scope_outline") },
   { id: pdfId, name: "Chapter 12 notes.pdf", mimeType: "application/pdf", sizeBytes: 9000, textContent: "Transcription and translation", processingStatus: "ready", understanding: understanding("content_source") },
  ];
  const reference = (materialId: string, sectionRole: "content_source" | "scope_outline") => ({ materialId, chunkId: "77777777-7777-4777-8777-777777777777", chunkIndex: 0, startCharacter: 0, endCharacter: 10, locationLabel: "page 1", sectionRole });
  const both = structuredClone(map);
  both.topics[0].sourceReferences = [reference(guideId, "scope_outline"), reference(pdfId, "content_source")];
  both.topics[1].sourceReferences = [reference(guideId, "scope_outline")];
  const initial = initialSetupCorrections(both, materials);
  expect(initial.topics[0].materialId).toBe(pdfId);
  // A topic only the study guide names keeps it (spec section 8 rule 1: it takes the no-source path).
  expect(initial.topics[1].materialId).toBe(guideId);
  // Continuing without edits keeps the content source's excerpts for teaching.
  const applied = applySetupCorrections({ knowledgeMap: both, materials, corrections: initial });
  expect(applied.knowledgeMap.topics[0].sourceReferences.map(item => item.materialId)).toEqual([pdfId]);
 });
 it("applies classification, source and covered choices atomically without inventing knowledge", () => {
  const draft = corrections(); draft.topics[0].covered = true;
  const result = applySetupCorrections({ knowledgeMap: map, materials: [material], corrections: draft });
  expect(result.materials[0].understanding?.role).toBe("scope_outline");
  expect(result.knowledgeMap.topics[0].attachedSources).toEqual([{ material_id: ids[2] }]);
  expect(result.knowledgeMap.topics[0].initialEvidence).toEqual({ source: "learner_report", outcome: "covered_elsewhere", checked: false });
  expect(result.knowledgeMap.topics[0].status).toBe("not_started"); expect(map.topics[0].initialEvidence).toBeNull();
 });
 it("allows removal, reordering and adding without mutating the original", () => {
  const result = applySetupCorrections({ knowledgeMap: map, materials: [material], corrections: { materials: [], topics: [
   { id: ids[1], materialId: null, covered: false }, { id: "44444444-4444-4444-8444-444444444444", addedTitle: "Active transport", materialId: null, covered: false },
  ] } });
  expect(result.knowledgeMap.topics.map(topic => topic.title)).toEqual(["Osmosis", "Active transport"]);
  expect(result.knowledgeMap.topics[0].attachedSources).toEqual([]);
 });
 it("rejects foreign materials, existing title edits and prerequisite-invalid ordering", () => {
  const draft = corrections(); draft.topics[0].materialId = ids[0];
  expect(() => applySetupCorrections({ knowledgeMap: map, materials: [material], corrections: draft })).toThrow(/source/i);
  expect(() => applySetupCorrections({ knowledgeMap: map, materials: [material], corrections: { ...corrections(), topics: [{ ...corrections().topics[0], addedTitle: "Edited title" }] } })).toThrow(/title/i);
  const dependentMap = structuredClone(map); dependentMap.topics[1].prerequisiteTopicIds = [ids[0]];
  expect(() => applySetupCorrections({ knowledgeMap: dependentMap, materials: [material], corrections: { ...corrections(), topics: corrections().topics.reverse() } })).toThrow(/prerequisite/i);
 });
 it("keeps server placement evidence separately from a covered declaration", () => {
  const checked = structuredClone(map); checked.topics[0].initialEvidence = { source: "placement_check", outcome: "gap", observedAt: "2026-09-17T12:00:00Z" };
  const draft = corrections(); draft.topics[0].covered = true;
  const covered = applySetupCorrections({ knowledgeMap: checked, materials: [material], corrections: draft });
  expect(covered.knowledgeMap.topics[0].placementEvidence?.outcome).toBe("gap");
  draft.topics[0].covered = false;
  expect(applySetupCorrections({ knowledgeMap: covered.knowledgeMap, materials: covered.materials, corrections: draft }).knowledgeMap.topics[0].initialEvidence).toEqual(checked.topics[0].initialEvidence);
 });
 it("refuses empty and duplicate topics", () => {
  expect(SetupCorrectionsSchema.safeParse({ materials: [], topics: [] }).success).toBe(false);
  const draft = corrections(); draft.topics[1].id = draft.topics[0].id;
  expect(() => applySetupCorrections({ knowledgeMap: map, materials: [material], corrections: draft })).toThrow(/duplicate/i);
 });
});
