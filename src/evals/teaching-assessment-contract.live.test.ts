import { describe, expect, test, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { includeCoreRecallKnowledge } from "@/lib/session-generation/lesson-assessment-contract";
vi.mock("server-only", () => ({}));

// Exact lesson claim/reference mismatch captured in the production tester account.
describe.skipIf(process.env.YOVA_RUN_LIVE_TEACHING_CONTRACT !== "1")("live teaching and assessment alignment", () => {
  test("explains every glycolysis product before accepting a learner's paraphrase", async () => {
    const { streamGeneratedLessonWithRetry, lessonWordBudgetForMinutes } = await import("@/lib/openai/streamed-lesson-generator");
    const { evaluateAnswerWithOpenAI } = await import("@/lib/openai/answer-evaluator");
    const reference = "Glycolysis produces two pyruvate molecules, two NADH, and a net gain of 2 ATP per glucose.";
    const { result } = await streamGeneratedLessonWithRetry({
      lessonTitle: "Glycolysis: From Glucose to Pyruvate", plannedMinutes: 3, topicTitles: ["Glycolysis"],
      essentialIdeas: ["Glycolysis splits glucose into two pyruvate molecules and yields a net 2 ATP."],
      coreRecallKnowledge: [reference], knowledgeSource: "model", sourceChunks: [],
      evidenceContext: { confirmedGaps: [], secureTopics: [], pastMisconceptions: [] },
      contentRequirements: { coverAllEssentialIdeas: true, concreteWorkedExample: false, commonMixup: true },
      deliveryInstructions: {
        schemaVersion: 1, explanationDensity: "balanced", tone: "calm", analogyUse: "only_when_helpful", workedExamples: "task_required", structure: "one_step_at_a_time",
        pacing: { firstActionMinutes: 3, maximumActivities: 5, instruction: "Build one clear model before asking the learner to explain it." },
        learnerContext: ["The learner prefers a concrete example and one step at a time."],
        contentRequirements: { coverAllEssentialIdeas: true, includeConcreteWorkedExample: false, includeCommonMixup: true, preservePrerequisiteOrder: true },
      },
    }, () => {}, AbortSignal.timeout(70_000));
    // Check the generated explanation itself, before the deterministic core statement.
    expect(result.content).toMatch(/NADH/i);
    expect(result.content).toMatch(/electron|carrier|reducing/i);
    const content = includeCoreRecallKnowledge(result.content, [reference]);
    expect(content.trim().split(/\s+/).length).toBeLessThanOrEqual(lessonWordBudgetForMinutes(3).maximumWords);
    const answer = "Each glucose becomes two three-carbon pyruvates. Two NADH carry electrons away, and after subtracting the two ATP invested from the four made, the ATP profit is two.";
    const evaluation = await evaluateAnswerWithOpenAI({
      planId: "11111111-1111-4111-8111-111111111111", planSessionId: "22222222-2222-4222-8222-222222222222", learnerAnswer: answer,
      activity: { title: "Explain the main products", prompt: "What are the main products and net energy gain of glycolysis?", concept: "Glycolysis products", referenceAnswer: reference, rubric: "Check the main carbon products, NADH production, and net ATP yield. Accept accurate paraphrases." },
    });
    writeFileSync("/tmp/yova-teaching-contract-live-result.json", JSON.stringify({ lesson: content, generatedLesson: result.content, answer, evaluation, model: result.model, elapsedMs: result.elapsedMs }, null, 2));
    expect(evaluation.verdict).toBe("secure");
    expect(evaluation.missingIdeas).toEqual([]);
  }, 100_000);
});
