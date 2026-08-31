import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import { DEFERRED_CONTINUATION_METHOD_REASON_PREFIX } from "@/lib/learning/session-continuation";
import type {
  SessionGenerationContext,
  SessionGenerationRuntime,
} from "@/lib/openai/session-generator";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";
import { generatedSessionStudyRouteIssue } from "@/lib/study-route/generation-contract";

const generateStreamed = vi.hoisted(() => vi.fn(async (
  context: SessionGenerationContext,
  runtime: SessionGenerationRuntime,
) => {
  void runtime;
  return {
    kind: "streamed",
    ...(context.studyRoute ? {
      draft: {
        topicIds: context.session.topicIds.slice(0, 1),
        coverage: {
          deferredContent: [context.session.contentTargets?.[1] ?? "Deferred connected target"],
        },
        methodBriefing: {
          learningMode: context.session.learningMode,
          methodId: context.studyRoute.approach.primaryMethodId,
          name: context.studyRoute.approach.visibleMethodName,
        },
        activities: ["model", "explain", "repair", "reexplain"].map((methodPhase) => ({
          methodPhase,
        })),
      },
    } : {}),
    generationStats: {
      elapsedMs: 12,
      attempts: 1,
      firstAttemptPassed: true,
      failedValidator: null,
      repairAttempted: false,
      repairSucceeded: null,
      repairReason: "none" as const,
      repairDetail: null,
      inputTokens: 80,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 120,
    },
  };
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/streamed-teaching-generator", () => ({
  generateStreamedTeachingSkeletonWithOpenAI: generateStreamed,
}));

describe("production session context preparation", () => {
  beforeEach(() => {
    generateStreamed.mockClear();
  });

  it("scopes a shortened teaching session before selecting and calling the streamed generator", async () => {
    const original = structuredClone(
      buildSessionEvaluationCases().find((entry) => entry.id === "biology_initial_teaching")!.context,
    );
    const targets = [
      "How a CRISPR guide RNA identifies a complementary DNA sequence",
      "Why an adjacent PAM sequence is required for Cas binding",
      "How mismatches and PAM placement change targeting specificity",
    ];
    original.session = {
      ...original.session,
      estimatedMinutes: 25,
      contentTargets: targets,
      completionEvidence: targets.map((target) => `Explain ${target}`),
    };
    original.sessionAdjustment = {
      availableMinutes: 15,
      familiarity: "need_teaching",
      knownTargets: [],
      note: "",
    };
    const runtime = { deadlineAt: Date.now() + 90_000 };

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    await generateProductionSessionWithOpenAI(original, runtime);

    expect(generateStreamed).toHaveBeenCalledTimes(1);
    const [prepared, forwardedRuntime] = generateStreamed.mock.calls[0]!;
    expect(prepared.session.estimatedMinutes).toBe(15);
    expect(prepared.session.contentTargets).toEqual(targets.slice(0, 2));
    expect(prepared.session.completionEvidence).toEqual([
      `Explain ${targets[0]}`,
      `Explain ${targets[1]}`,
    ]);
    expect(prepared.session.deferredContentTargets).toEqual([targets[2]]);
    expect(prepared.session.objective).toContain(targets[0]);
    expect(prepared.session.objective).not.toContain(targets[2]);
    expect(forwardedRuntime).toBe(runtime);
  });

  it.each([
    { label: "source-free", sourceBacked: false },
    { label: "source-backed", sourceBacked: true },
  ])("keeps only the taught target when $label generation safely defers connected work", async ({ sourceBacked }) => {
    const original = structuredClone(
      buildSessionEvaluationCases().find((entry) => (
        entry.id === "chemistry_temperature_reaction_rate_15_min"
      ))!.context,
    );
    if (sourceBacked) attachMappedChemistrySources(original);
    const targetIds = [...original.session.topicIds];
    original.studyRoute = {
      approach: {
        mode: "learn",
        executionEnvironment: "inside_yova",
        primaryMethodId: "self_explanation",
        visibleMethodName: "Feynman Technique",
      },
      target: {
        targetStates: targetIds.map((targetId) => ({ targetId })),
      },
      execution: {
        deferredTargets: [],
        orderedPhases: ["model", "explain", "repair", "reexplain"].map((methodPhase) => ({
          methodPhase,
        })),
      },
    } as unknown as NonNullable<SessionGenerationContext["studyRoute"]>;

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const generated = await generateProductionSessionWithOpenAI(original);

    expect(generateStreamed).toHaveBeenCalledTimes(1);
    expect(generated.draft.topicIds).toEqual([targetIds[0]]);
    expect(generated.draft.coverage.deferredContent).toEqual([
      original.session.contentTargets![1],
    ]);
    expect(generatedSessionStudyRouteIssue(
      generated.draft as unknown as GeneratedSessionDraft,
      original.studyRoute,
      {
        plannedTopicIds: targetIds,
        plannedContentTargets: original.session.contentTargets!,
        knowledgeTopics: original.knowledgeTopics,
      },
    )).toBeNull();
  });

  it("scopes a durable continuation topic superset to its mapped remaining target", async () => {
    const original = structuredClone(
      buildSessionEvaluationCases().find((entry) => (
        entry.id === "chemistry_temperature_reaction_rate_15_min"
      ))!.context,
    );
    const targetIds = [...original.session.topicIds];
    const remainingTarget = original.session.contentTargets![1]!;
    original.session = {
      ...original.session,
      title: "Continue the temperature and reaction-rate explanation",
      methodReason: `${DEFERRED_CONTINUATION_METHOD_REASON_PREFIX} Complete only this remaining target: ${remainingTarget}.`,
      contentTargets: [remainingTarget],
      completionEvidence: [`Explain ${remainingTarget} without reopening the model.`],
    };
    original.studyRoute = {
      approach: {
        mode: "learn",
        executionEnvironment: "inside_yova",
        primaryMethodId: "self_explanation",
        visibleMethodName: "Feynman Technique",
      },
      target: {
        targetStates: targetIds.map((targetId) => ({ targetId })),
      },
      execution: {
        deferredTargets: [],
        orderedPhases: ["model", "explain", "repair", "reexplain"].map((methodPhase) => ({
          methodPhase,
        })),
      },
    } as unknown as NonNullable<SessionGenerationContext["studyRoute"]>;

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const generated = await generateProductionSessionWithOpenAI(original);

    expect(generateStreamed).toHaveBeenCalledTimes(1);
    const prepared = generateStreamed.mock.calls[0]![0];
    expect(prepared.session.topicIds).toEqual([targetIds[1]]);
    expect(prepared.session.contentTargets).toEqual([remainingTarget]);
    expect(prepared.knowledgeTopics.map((topic) => topic.id)).toEqual([targetIds[1]]);
    expect(generated.draft.topicIds).toEqual([targetIds[1]]);
    expect(generatedSessionStudyRouteIssue(
      generated.draft as unknown as GeneratedSessionDraft,
      original.studyRoute,
      {
        plannedTopicIds: targetIds,
        plannedContentTargets: [remainingTarget],
        knowledgeTopics: original.knowledgeTopics,
        isDeferredContinuation: true,
      },
    )).toBeNull();
  });
});

function attachMappedChemistrySources(context: SessionGenerationContext) {
  const materialIds = [
    "77777777-7777-4777-8777-777777777771",
    "77777777-7777-4777-8777-777777777772",
  ];
  const chunkIds = [
    "88888888-8888-4888-8888-888888888881",
    "88888888-8888-4888-8888-888888888882",
  ];
  context.learningGoal.sourceMode = "user_materials";
  context.materials = context.knowledgeTopics.map((topic, index) => ({
    materialId: materialIds[index],
    chunkId: chunkIds[index],
    chunkIndex: 0,
    name: `Reaction-rate notes ${index + 1}.txt`,
    locationLabel: `Section ${index + 1}`,
    text: topic.description,
    truncated: false,
    role: "content_source" as const,
  }));
  context.knowledgeTopics = context.knowledgeTopics.map((topic, index) => ({
    ...topic,
    origin: "material" as const,
    sourceReferences: [{
      materialId: materialIds[index]!,
      chunkId: chunkIds[index]!,
      chunkIndex: 0,
      startCharacter: 0,
      endCharacter: topic.description.length,
      locationLabel: `Section ${index + 1}`,
      sectionRole: "content_source" as const,
    }],
  }));
}
