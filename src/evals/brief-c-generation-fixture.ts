import { blockFixture, BLOCK_TOPIC_ID } from "./brief-c-block-fixture";
import { deltaFixture } from "./personalization-delta-fixture";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";

export function generationContext(profile: 1 | 2, mode: "learn" | "study" = "learn", sourced = true): SessionGenerationContext {
  const saved = blockFixture(profile);
  const source = saved.block.sources[0]!;
  return {
    learningGoal: { title: "AP Biology", topic: "Cellular energetics", kind: "course", deadline: null, sourceMode: sourced ? "user_materials" : "yova_generated", studyMode: "inside_yova", learningIntent: mode },
    planRationale: "Learn ATP and energy transfer using the assigned lecture section.",
    session: { title: "ATP and energy transfer", objective: saved.block.objective, method: "Retrieval Practice", methodReason: saved.rationale, estimatedMinutes: 20, learningMode: mode, topicIds: [BLOCK_TOPIC_ID], contentTargets: ["ATP and energy transfer"], completionEvidence: saved.coverage.completionEvidence },
    knowledgeTopics: [{ id: BLOCK_TOPIC_ID, title: "ATP and energy transfer", description: saved.block.objective, subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, origin: sourced ? "material" : "ai_generated", deferred: null,
      attachedSources: sourced ? [{ material_id: source.materialId }] : [],
      sourceReferences: sourced ? [{ materialId: source.materialId, chunkId: "c0000000-0000-4000-8000-000000000005", chunkIndex: 0, startCharacter: 0, endCharacter: source.text.length, locationLabel: source.section, sectionRole: "content_source" }] : [],
    }],
    materials: sourced ? [{ materialId: source.materialId, chunkId: "c0000000-0000-4000-8000-000000000005", name: source.title, text: source.text, truncated: false, locationLabel: source.section, role: "content_source" }] : [],
    learnerProfile: null, personalization: deltaFixture(profile).methodContext.personalization,
    recentResults: [], recentInterruptions: [], conceptSignals: [],
  };
}

