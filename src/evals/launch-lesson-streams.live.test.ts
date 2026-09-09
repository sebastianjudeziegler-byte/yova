import { describe, expect, test, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { liveFixturePath } from "@/evals/live-fixtures";
import { StreamedGeneratedSessionDraftSchema } from "@/lib/session-generation/schema";
import { LessonDeliveryInstructionsSchema } from "@/lib/personalization/session-delivery-policy";
vi.mock("server-only", () => ({}));

// Run launch-session-journeys.live.test.ts first to obtain fresh validated
// drafts. This separate opt-in verifies that their teaching actually streams.
describe.skipIf(process.env.YOVA_RUN_LIVE_LESSON_EVALS !== "1")("launch lesson delivery", () => {
  test.each(["calculus", "osmosis"])("streams the validated %s teaching", async name => {
    const saved = JSON.parse(readFileSync(liveFixturePath("launch", `${name}-result.json`), "utf8"));
    const draft = StreamedGeneratedSessionDraftSchema.parse(saved.draft);
    const deliveryInstructions = LessonDeliveryInstructionsSchema.parse(saved.deliveryInstructions);
    const { streamGeneratedLessonWithRetry } = await import("@/lib/openai/streamed-lesson-generator");
    const lessons = [];
    for (const activity of draft.activities.filter(activity => activity.lessonBrief)) {
      const brief = activity.lessonBrief!;
      let received = "";
      const result = await streamGeneratedLessonWithRetry({
        lessonTitle: activity.title, plannedMinutes: activity.estimatedMinutes, topicTitles: [activity.title], essentialIdeas: brief.essentialIdeas,
        knowledgeSource: "model", sourceChunks: [],
        evidenceContext: { confirmedGaps: [], secureTopics: [], pastMisconceptions: [] },
        contentRequirements: { coverAllEssentialIdeas: true, concreteWorkedExample: brief.contentRequirements.includeConcreteExample, commonMixup: true },
        deliveryInstructions,
      }, delta => { received += delta; }, AbortSignal.timeout(60_000));
      expect(received.length).toBeGreaterThan(100);
      expect(result.result.content.length).toBeGreaterThan(300);
      lessons.push({ title: activity.title, ...result });
    }
    expect(lessons.length).toBeGreaterThan(0);
    writeFileSync(liveFixturePath("launch", `${name}-lessons.json`), JSON.stringify(lessons, null, 2));
  }, 90_000);
});
