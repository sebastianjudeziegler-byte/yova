import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";
import { StreamedGeneratedSessionDraftSchema } from "@/lib/session-generation/schema";

const parseResponse = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAISessionConfig: () => ({ apiKey: "test", model: "gpt-yova-test" }),
}));

const TOPIC_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "77777777-7777-4777-8777-777777777777",
] as const;
const MATERIAL_IDS = [
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "88888888-8888-4888-8888-888888888888",
] as const;
const CHUNK_IDS = [
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
  "99999999-9999-4999-8999-999999999999",
] as const;
const TARGETS = [
  "Sodium export transport ratio",
  "ATP hydrolysis energy coupling",
  "Membrane gradient electrical consequence",
] as const;
const SOURCE_TEXTS = [
  "The sodium export transport ratio moves three sodium ions out of the cell while two potassium ions move inward. The unequal exchange helps maintain the membrane ion gradient.",
  "ATP hydrolysis energy coupling changes the pump's shape and powers ion transport against each concentration gradient. A new ATP cycle then returns the transporter to its starting state.",
  "The unequal sodium and potassium distributions contribute to the membrane's electrical gradient. This stored gradient supports electrical signalling and secondary transport across the membrane.",
] as const;

function invalidResponse(index: number) {
  return {
    id: `invalid-${index}`,
    model: "gpt-yova-test",
    status: "completed",
    output: [],
    output_parsed: {},
    usage: {
      input_tokens: 100 + index,
      input_tokens_details: { cached_tokens: index, cache_write_tokens: 0 },
      output_tokens: 20 + index,
    },
  };
}

function context({
  architecture,
  targetCount,
  learningMode = "learn",
  forceFullGeneration = false,
}: {
  architecture: "filled_teaching_v1" | "streamed_teaching_v1";
  targetCount: 1 | 2 | 3;
  learningMode?: "learn" | "study";
  forceFullGeneration?: boolean;
}): SessionGenerationContext {
  const targets = TARGETS.slice(0, targetCount);
  return {
    sessionArchitectureVersion: architecture,
    learningGoal: {
      title: "Cell membrane transport",
      topic: "How the sodium-potassium pump uses ATP to maintain ion gradients",
      kind: "topic",
      deadline: null,
      sourceMode: "user_materials",
      studyMode: "inside_yova",
      learningIntent: learningMode,
    },
    planRationale: "Build the verified mechanism before asking for a closed-source explanation.",
    journey: {
      currentSequence: 1,
      totalSessions: 1,
      previousSessions: [],
      nextSessions: [],
    },
    materials: targets.map((_, index) => ({
      materialId: MATERIAL_IDS[index],
      chunkId: CHUNK_IDS[index],
      name: `Transport source ${index + 1}.pdf`,
      locationLabel: `Page ${index + 2}`,
      text: SOURCE_TEXTS[index],
      truncated: false,
      role: "content_source" as const,
    })),
    knowledgeTopics: targets.map((target, index) => ({
      id: TOPIC_IDS[index],
      title: target,
      description: SOURCE_TEXTS[index],
      subtopics: [],
      prerequisiteTopicIds: [],
      status: "not_started" as const,
      initialEvidence: null,
      sourceReferences: [{
        materialId: MATERIAL_IDS[index],
        chunkId: CHUNK_IDS[index],
        chunkIndex: 0,
        startCharacter: 0,
        endCharacter: SOURCE_TEXTS[index].length,
        locationLabel: `Page ${index + 2}`,
        sectionRole: "content_source" as const,
      }],
      origin: "material" as const,
      deferred: null,
    })),
    session: {
      title: "Explain the sodium-potassium pump",
      objective: "Explain the transport ratio and ATP coupling that maintain membrane ion gradients.",
      method: learningMode === "study" ? "Retrieval practice" : "Feynman Technique",
      methodReason: learningMode === "study"
        ? "An attempt-first source-grounded check exposes gaps before targeted repair."
        : "A source-grounded explanation exposes gaps in the connected mechanism.",
      estimatedMinutes: forceFullGeneration
        ? 45
        : targetCount === 1 ? 15 : targetCount === 2 ? 25 : 45,
      learningMode,
      topicIds: TOPIC_IDS.slice(0, targetCount),
      contentTargets: [...targets],
      completionEvidence: targets.map((target) => `Explain ${target} without reopening the source.`),
      reviewConcept: null,
      reviewType: null,
    },
    learnerProfile: null,
    sessionAdjustment: null,
    recentResults: [],
    recentInterruptions: [],
    conceptSignals: [],
    scaffoldSignals: [],
    topicCalibrationSignals: [],
  };
}

describe("bounded production session generation", () => {
  beforeEach(() => {
    parseResponse.mockReset();
    parseResponse
      .mockResolvedValueOnce(invalidResponse(1))
      .mockResolvedValueOnce(invalidResponse(2));
  });

  it("binds mixed material and AI targets to distinct authority before any provider call", async () => {
    const mixed = context({
      architecture: "filled_teaching_v1",
      targetCount: 2,
      learningMode: "learn",
    });
    mixed.materials = mixed.materials.slice(0, 1);
    mixed.knowledgeTopics[1] = {
      ...mixed.knowledgeTopics[1]!,
      origin: "ai_generated",
      sourceReferences: [],
    };
    const { ordinarySessionProvenanceContract } = await import("@/lib/openai/session-generator");

    expect(ordinarySessionProvenanceContract(mixed)).toMatchObject({
      mixed: true,
      effectiveSourceMode: "user_materials",
      issue: null,
      targetProvenance: [{
        targetIndex: 0,
        topicId: TOPIC_IDS[0],
        provenance: "mapped_material",
        allowedChunkIds: [CHUNK_IDS[0]],
      }, {
        targetIndex: 1,
        topicId: TOPIC_IDS[1],
        provenance: "model_knowledge",
        allowedChunkIds: [],
      }],
    });
    expect(parseResponse).not.toHaveBeenCalled();
  });

  it("fails mixed authority closed when a target is ambiguous and projects an AI-only continuation to model knowledge", async () => {
    const mixed = context({
      architecture: "filled_teaching_v1",
      targetCount: 2,
      learningMode: "learn",
    });
    mixed.materials = mixed.materials.slice(0, 1);
    mixed.knowledgeTopics[1] = {
      ...mixed.knowledgeTopics[1]!,
      origin: "ai_generated",
      sourceReferences: [],
    };
    mixed.session.contentTargets = ["Explain the important process and its result"];
    const {
      generateSessionWithOpenAI,
      ordinarySessionProvenanceContract,
    } = await import("@/lib/openai/session-generator");

    expect(ordinarySessionProvenanceContract(mixed)).toMatchObject({
      issue: { failedValidator: "session_coverage_fidelity" },
    });
    expect(parseResponse).not.toHaveBeenCalled();

    const aiOnly: SessionGenerationContext = {
      ...mixed,
      materials: [],
      knowledgeTopics: [mixed.knowledgeTopics[1]!],
      session: {
        ...mixed.session,
        topicIds: [TOPIC_IDS[1]],
        contentTargets: [TARGETS[1]],
      },
    };
    expect(ordinarySessionProvenanceContract(aiOnly)).toMatchObject({
      effectiveSourceMode: "yova_generated",
      mixed: false,
      issue: null,
      promptContract: null,
    });

    parseResponse.mockReset();
    parseResponse.mockRejectedValueOnce(new Error("unclassified provider rejection"));
    await expect(generateSessionWithOpenAI(aiOnly)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 1,
        stage: "provider",
        cause: "provider_request",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(1);
    const providerInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    const prompt = JSON.parse(providerInput.slice(providerInput.indexOf("\n") + 1));
    expect(prompt.learningGoal.sourceMode).toBe("yova_generated");
    expect(prompt.materials).toEqual([]);
    expect(prompt.sourceGroundingPolicy).toBeNull();
  });

  it("uses at most one reliable retry, then returns a source-grounded filled fallback", async () => {
    const { generateReliableSessionWithOpenAI } = await import("@/lib/openai/reliable-session-generator");
    const result = await generateReliableSessionWithOpenAI(context({
      architecture: "filled_teaching_v1",
      targetCount: 1,
      learningMode: "study",
    }));

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(result.generationStats).toMatchObject({
      attempts: 2,
      stage: "fallback",
      cause: "invalid_structure",
      degradedMode: "source_grounded",
      repairAttempted: true,
      repairSucceeded: false,
    });
    expect(JSON.stringify(result.draft)).toContain("three sodium ions");
  });

  it("caps the full generator at two calls before source-grounded degradation", async () => {
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");
    const result = await generateProductionSessionWithOpenAI(context({
      architecture: "filled_teaching_v1",
      targetCount: 2,
      learningMode: "study",
    }));

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(result.generationStats).toMatchObject({
      attempts: 2,
      strategy: "full",
      stage: "fallback",
      degradedMode: "source_grounded",
    });
    expect(result.draft.coverage.essentialIdeas).toHaveLength(2);
    expect(result.draft.topicIds).toEqual(TOPIC_IDS.slice(0, 2));
    expect(result.draft.sourceGrounding?.anchors.map((anchor) => anchor.chunkId)).toEqual(CHUNK_IDS.slice(0, 2));
    expect(new Set(result.draft.activities.flatMap((activity) => (
      activity.type === "multiple_choice" || activity.type === "free_response"
        ? [activity.topicId]
        : []
    )))).toEqual(new Set(TOPIC_IDS.slice(0, 2)));
  });

  it("keeps three authoritative material targets distinct in the bounded fallback", async () => {
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");
    const result = await generateProductionSessionWithOpenAI(context({
      architecture: "filled_teaching_v1",
      targetCount: 3,
      learningMode: "study",
    }));

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(result.generationStats).toMatchObject({
      attempts: 2,
      strategy: "full",
      stage: "fallback",
      degradedMode: "source_grounded",
    });
    expect(result.draft.topicIds).toEqual([...TOPIC_IDS]);
    expect(result.draft.coverage.essentialIdeas).toHaveLength(3);
    expect(result.draft.coverage.evidenceMap).toHaveLength(3);
    expect(result.draft.sourceGrounding?.anchors.map((anchor) => anchor.chunkId)).toEqual([
      ...CHUNK_IDS,
    ]);
    const checkedTopicIds = result.draft.activities.flatMap((activity) => (
      activity.type === "multiple_choice" || activity.type === "free_response"
        ? [activity.topicId]
        : []
    ));
    expect(new Set(checkedTopicIds)).toEqual(new Set(TOPIC_IDS));
    expect(checkedTopicIds.length).toBeGreaterThanOrEqual(3);
  });

  it("uses the second and final full-generator call for a transient transport retry before safe degradation", async () => {
    parseResponse.mockReset();
    parseResponse
      .mockRejectedValueOnce(Object.assign(new Error("upstream unavailable"), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("upstream still unavailable"), { status: 503 }));
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");
    const result = await generateProductionSessionWithOpenAI(context({
      architecture: "filled_teaching_v1",
      targetCount: 1,
      learningMode: "study",
      forceFullGeneration: true,
    }));

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(result.generationStats).toMatchObject({
      attempts: 2,
      strategy: "full",
      failedValidator: "session_provider_request",
      repairAttempted: true,
      repairSucceeded: null,
      stage: "fallback",
      cause: "provider_request",
      degradedMode: "source_grounded",
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("ends two transient full-generator failures with source-specific setup guidance when degradation has no authority", async () => {
    parseResponse.mockReset();
    parseResponse
      .mockRejectedValueOnce(Object.assign(new Error("connection lost"), { code: "econnreset" }))
      .mockRejectedValueOnce(Object.assign(new Error("connection still lost"), { code: "econnreset" }));
    const missingSource = context({
      architecture: "filled_teaching_v1",
      targetCount: 1,
      learningMode: "study",
      forceFullGeneration: true,
    });
    missingSource.materials = [];
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");

    await expect(generateProductionSessionWithOpenAI(missingSource)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      message: expect.stringMatching(/attach or reprocess readable material|source-independent route/i),
      generationStats: {
        attempts: 2,
        strategy: "full",
        failedValidator: "session_provider_request",
        repairAttempted: true,
        stage: "fallback",
        cause: "source_unavailable",
        inputTokens: 0,
        outputTokens: 0,
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
  });

  it("caps streamed skeleton generation at two calls and embeds only mapped chunks", async () => {
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");
    const result = await generateProductionSessionWithOpenAI(context({
      architecture: "streamed_teaching_v1",
      targetCount: 2,
    }));

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(result.generationStats).toMatchObject({
      attempts: 2,
      strategy: "streamed",
      stage: "fallback",
      degradedMode: "source_grounded",
    });
    const streamed = StreamedGeneratedSessionDraftSchema.parse(result.draft);
    const lessonBrief = streamed.activities.find((activity) => activity.lessonBrief)?.lessonBrief;
    expect(lessonBrief?.sourceChunks.map((chunk) => chunk.chunkId)).toEqual(CHUNK_IDS.slice(0, 2));
  });

  it("never invents a degraded lesson when no trustworthy source exists", async () => {
    const ungrounded = context({
      architecture: "filled_teaching_v1",
      targetCount: 2,
      learningMode: "study",
    });
    ungrounded.learningGoal.sourceMode = "yova_generated";
    ungrounded.materials = [];
    ungrounded.knowledgeTopics = ungrounded.knowledgeTopics.map((topic) => ({
      ...topic,
      origin: "ai_generated",
      sourceReferences: [],
    }));
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");

    await expect(generateProductionSessionWithOpenAI(ungrounded)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        strategy: "full",
        stage: "validation",
        cause: "invalid_structure",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
  });

  it("reports an actionable source-unavailable terminal failure without exposing source text", async () => {
    const missingSource = context({
      architecture: "filled_teaching_v1",
      targetCount: 1,
      learningMode: "study",
      forceFullGeneration: true,
    });
    missingSource.materials = [];
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");

    const failure = await generateProductionSessionWithOpenAI(missingSource).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "SessionGenerationFailure",
      message: expect.stringMatching(/attach or reprocess readable material|source-independent route/i),
      generationStats: {
        attempts: 2,
        strategy: "full",
        stage: "fallback",
        cause: "source_unavailable",
        inputTokens: 203,
        outputTokens: 43,
      },
    });
    expect(JSON.stringify(failure)).not.toContain(SOURCE_TEXTS[0]);
    expect(parseResponse).toHaveBeenCalledTimes(2);
  });

  it("keeps the shortened material shortcut to one provider call before source fallback", async () => {
    const base = buildSessionEvaluationCases()
      .find((entry) => entry.id === "bioenergetics_multi_target_study")!.context;
    const shortened: SessionGenerationContext = {
      ...base,
      learningGoal: { ...base.learningGoal, sourceMode: "user_materials" },
      materials: [{
        materialId: "41111111-1111-4111-8111-111111111111",
        chunkId: "42222222-2222-4222-8222-222222222222",
        chunkIndex: 0,
        name: "shortened-bioenergetics-notes.txt",
        text: "Cells couple energy-releasing reactions to energy-requiring work. ATP hydrolysis releases free energy that can drive a coupled cellular reaction.",
        truncated: false,
        locationLabel: "Uploaded text",
        role: "content_source",
      }],
      session: {
        ...base.session,
        estimatedMinutes: 15,
        deferredContentTargets: ["Membrane transport applications"],
        completionEvidence: base.session.completionEvidence?.slice(0, 2),
      },
    };
    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");

    const resultOrFailure = await generateSessionWithOpenAI(shortened).catch((error: unknown) => error);

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(resultOrFailure).toMatchObject({
      generationStats: {
      attempts: 1,
      },
    });
    expect(parseResponse.mock.calls[0]?.[0]?.text?.format?.name).toBe("yova_safe_study_recovery");
  });

  it("caps scheduled retrieval at one retry and never enters another recovery generator", async () => {
    const scheduled = buildSessionEvaluationCases()
      .find((entry) => entry.id === "calculus_delayed_retrieval_self_contained")!.context;
    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");

    await expect(generateSessionWithOpenAI(scheduled)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        stage: "validation",
        cause: "invalid_structure",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_scheduled_retrieval",
      "yova_scheduled_retrieval",
    ]);
  });
});
