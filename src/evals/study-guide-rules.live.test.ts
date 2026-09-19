import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { documentReferentialReason } from "@/lib/practice/document-referential";
import { isDocumentLabelTitle } from "@/lib/knowledge-map/document-label";
import { ShapeSlotResponseSchema } from "@/lib/session-shapes/slots-schema";

vi.mock("server-only", () => ({}));

/**
 * Spec docs/redesign/05-PLAN-MODEL.md section 8, permanent live test (Brief
 * 2.5 root cause 5, findings 22 and 23): upload a study guide, generate, and
 * assert no topic is named after the document and no question references the
 * unit, the guide or its goals. The guide's own sections are titled exactly as
 * in the audit, so the real map model is tempted to copy them.
 */
const MATERIAL_ID = randomUUID();
const guide = "AP Biology Unit 6 test scope: DNA replication, transcription and RNA processing, translation, regulation of gene expression. Unit 6 concept explanations: know how RNA polymerase reads the template strand, how introns are removed, and how codons are read by tRNA at the ribosome.";
const reference = (start: number, end: number) => ({ materialId: MATERIAL_ID, chunkId: randomUUID(), chunkIndex: 0, startCharacter: start, endCharacter: end, locationLabel: "page 1", sectionRole: "scope_outline" as const });

describe.skipIf(process.env.YOVA_RUN_LIVE_STUDY_GUIDE_RULES !== "1")("live study guide rules", () => {
  it("names topics after knowledge and asks no question about the unit, the guide or its goals", async () => {
    const { generatePlanKnowledgeMap } = await import("@/lib/knowledge-map/generate-plan-map");
    const { fillShapeSlot, openAIShapeSlotProvider } = await import("@/lib/openai/shape-slot-generator");
    const goal = "Prepare for my AP Biology Unit 6 test on gene expression.";
    const request = PlanGenerationRequestSchema.parse({
      intent: "plan", learningIntent: "learn", goal, materialMode: "upload", studyMode: "inside",
      deadline: new Date(Date.now() + 10 * 86_400_000).toISOString(), timeZone: "UTC", diagnosticResponses: [],
      availability: [{ day: "Every day", window: "Evening", minutes: 45 }], profileSummary: "Use my saved learner profile.",
      materials: [{ id: MATERIAL_ID, name: "AP Biology Unit 6 study guide.pdf", mimeType: "application/pdf", sizeBytes: guide.length, textContent: guide, processingStatus: "ready",
        understanding: { version: 1, role: "scope_outline", roleReason: "The guide lists what the unit test covers without teaching it.", mixedSections: [], chunkCount: 1, mappedAt: new Date().toISOString(),
          topics: [
            { id: randomUUID(), title: "Unit 6 test scope", description: "The Unit 6 test covers DNA replication, transcription and RNA processing, translation and gene regulation.", subtopics: [], prerequisiteTopicIds: [], status: "not_started", sourceReferences: [reference(0, 140)], origin: "material", deferred: null },
            { id: randomUUID(), title: "Unit 6 concept explanations", description: "How RNA polymerase reads the template strand, how introns are removed and how codons are read by tRNA.", subtopics: [], prerequisiteTopicIds: [], status: "not_started", sourceReferences: [reference(140, guide.length)], origin: "material", deferred: null },
          ] } }],
    });
    const { map } = await generatePlanKnowledgeMap(request);
    for (const topic of map.topics) expect(isDocumentLabelTitle(topic.title), `topic "${topic.title}" names a part of the guide`).toBe(false);

    expect(openAIShapeSlotProvider(), "Live study-guide checks require a configured provider").not.toBeNull();
    for (const topic of map.topics.slice(0, 2)) {
      // One provider per request, as the app makes it: each has its own
      // 50-second budget (sharing one starved the second lesson in CI run
      // 35446615227, which timed out without breaking any rule).
      const provider = openAIShapeSlotProvider()!;
      const response = ShapeSlotResponseSchema.parse(await fillShapeSlot({
        action: "learn_block", requestId: randomUUID(), recoveryKey: randomUUID(), planId: randomUUID(), planSessionId: randomUUID(), tips: [],
        topic: { id: topic.id, title: topic.title, description: topic.description, subtopics: topic.subtopics.slice(0, 6), taskType: "conceptual_learning", learningGoal: goal },
        modifiers: { instructionStyle: "standard", questionMix: { recall: 2, application: 4, compare_contrast: 0, prediction: 0, misconception: 0 }, produceStep: null, explanationFocus: "concept", questionCap: 6, questionTarget: 6 },
      }, provider));
      if (response.action !== "learn_block") throw new Error("Expected a learn block");
      for (const question of response.questions) {
        const text = [question.prompt, ...(question.choices ?? [])].join(" ");
        expect(documentReferentialReason(text), `"${question.prompt}"`).toBeNull();
        expect(text, `"${question.prompt}"`).not.toMatch(/\bunit\s*6\b|study guide|\bthe guide\b/i);
      }
    }
  }, 240_000);
});
