import { describe, expect, test, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import { StreamedGeneratedSessionDraftSchema } from "@/lib/session-generation/schema";
import type { StreamedLessonInput } from "@/lib/openai/streamed-lesson-generator";

vi.mock("server-only", () => ({}));

const liveEvaluationEnabled = process.env.YOVA_RUN_LIVE_WWI_LESSON_EVALS === "1";

describe.skipIf(!liveEvaluationEnabled)("live streamed World War I lesson", () => {
  test("delivers substantive teaching from the first generated lesson brief", async () => {
    const [{ generateProductionSessionWithOpenAI }, { lessonWordBudgetForMinutes, streamGeneratedLesson }] = await Promise.all([
      import("@/lib/openai/session-generation-strategy"),
      import("@/lib/openai/streamed-lesson-generator"),
    ]);
    const evaluationCase = buildSessionEvaluationCases().find(
      (candidate) => candidate.id === "world_war_one_mapped_45_min",
    );
    if (!evaluationCase) throw new Error("The exact World War I session case is missing.");

    const skeletonStartedAt = Date.now();
    const skeletonResult = await generateProductionSessionWithOpenAI(evaluationCase.context);
    const skeletonElapsedMs = Date.now() - skeletonStartedAt;
    const draft = StreamedGeneratedSessionDraftSchema.parse(skeletonResult.draft);
    if (!skeletonResult.deliveryInstructions) {
      throw new Error("The streamed World War I skeleton did not include lesson delivery instructions.");
    }
    const instruction = draft.activities.find(
      (activity) => activity.type === "instruction" && Boolean(activity.lessonBrief),
    );
    if (!instruction || instruction.type !== "instruction" || !instruction.lessonBrief) {
      throw new Error("The streamed World War I skeleton did not include a lesson brief.");
    }

    const lessonInput: StreamedLessonInput = {
      lessonTitle: instruction.title,
      plannedMinutes: instruction.estimatedMinutes,
      topicTitles: evaluationCase.context.knowledgeTopics?.map((topic) => topic.title) ?? [instruction.title],
      essentialIdeas: instruction.lessonBrief.essentialIdeas,
      knowledgeSource: instruction.lessonBrief.knowledgeSource === "material_content"
        ? "materials"
        : instruction.lessonBrief.knowledgeSource === "mixed_material_and_model"
          ? "mixed"
          : "model",
      sourceChunks: instruction.lessonBrief.sourceChunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        sourceName: chunk.sourceName,
        locationLabel: chunk.locationLabel,
        sectionRole: chunk.role,
        text: chunk.text,
      })),
      evidenceContext: {
        confirmedGaps: instruction.lessonBrief.evidenceContext.confirmedGaps.map((gap) => ({
          topicId: gap.topicId,
          concept: gap.concept,
        })),
        secureTopics: instruction.lessonBrief.evidenceContext.secureKnowledge.map((topic) => ({
          topicId: topic.topicId,
          title: topic.concept,
        })),
        pastMisconceptions: instruction.lessonBrief.evidenceContext.priorMisconceptions.map((misconception) => ({
          topicId: misconception.topicId,
          concept: misconception.concept,
          summary: misconception.misconception,
        })),
      },
      contentRequirements: {
        coverAllEssentialIdeas: true,
        concreteWorkedExample: instruction.lessonBrief.contentRequirements.includeConcreteExample,
        commonMixup: true,
      },
      deliveryInstructions: skeletonResult.deliveryInstructions,
    };

    let lessonMarkdown = "";
    const lessonResult = await streamGeneratedLesson(
      lessonInput,
      (delta) => { lessonMarkdown += delta; },
    );

    console.info("WWI streamed lesson metrics", {
      skeletonElapsedMs,
      skeletonAttempts: skeletonResult.generationStats.attempts,
      lessonElapsedMs: lessonResult.elapsedMs,
      latencyToFirstTokenMs: lessonResult.latencyToFirstTokenMs,
      wordCount: lessonResult.wordCount,
      inputTokens: lessonResult.inputTokens,
      outputTokens: lessonResult.outputTokens,
    });

    const lessonBudget = lessonWordBudgetForMinutes(instruction.estimatedMinutes);
    expect(lessonResult.wordCount).toBeGreaterThanOrEqual(120);
    expect(lessonResult.wordCount).toBeLessThanOrEqual(lessonBudget.maximumWords);
    expect(lessonMarkdown).toMatch(/alliance/i);
    expect(lessonMarkdown).toMatch(/Sarajevo|Franz Ferdinand/i);
    expect(lessonMarkdown).toMatch(/1914/);
    expect(lessonMarkdown).toMatch(/mobiliz|declaration of war/i);
    expect(lessonMarkdown).not.toMatch(/click (continue|next)|confidence rating|answer key/i);
  }, 120_000);
});
