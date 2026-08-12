import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  lessonConfigured: true,
  recordObservation: vi.fn(),
  streamGeneratedLesson: vi.fn(),
}));

vi.mock("@/lib/analytics/generation-observation-server", () => ({
  recordGenerationObservation: mocks.recordObservation,
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAILessonConfig: () => ({ model: "configured-lesson-model" }),
  isOpenAILessonConfigured: () => mocks.lessonConfigured,
}));
vi.mock("@/lib/openai/streamed-lesson-generator", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/openai/streamed-lesson-generator")>(),
  streamGeneratedLesson: mocks.streamGeneratedLesson,
}));
vi.mock("@/lib/server/development-preview", () => ({
  isDevelopmentPreviewRequest: () => true,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkLessonGenerationRateLimit: () => ({ allowed: true }),
  requestRateLimitKey: () => "route-test",
}));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => false }));

import { POST } from "@/app/api/sessions/lesson/route";
import { StreamedLessonGenerationError } from "@/lib/openai/streamed-lesson-generator";
import {
  consumeLessonEventStream,
  type LessonStreamEvent,
} from "@/lib/session-generation/lesson-stream";
import {
  applyLessonStreamEvent,
  createLessonRuntimeState,
} from "@/lib/session-generation/lesson-runtime";

describe("streamed lesson route recovery", () => {
  beforeEach(() => {
    mocks.lessonConfigured = true;
    mocks.recordObservation.mockReset().mockResolvedValue(undefined);
    mocks.streamGeneratedLesson.mockReset();
  });

  it("replaces partial output and completes when the provider times out", async () => {
    mocks.streamGeneratedLesson.mockImplementation(async (_input, onDelta) => {
      onDelta("A partial provider explanation that does not finish.");
      throw new StreamedLessonGenerationError("Runtime deadline reached", {
        failureKind: "runtime_timeout",
        model: "configured-lesson-model",
        responseId: null,
        inputTokens: 120,
        cachedInputTokens: 0,
        outputTokens: 40,
        latencyToFirstTokenMs: 100,
        elapsedMs: 105_000,
        wordCount: 8,
      });
    });

    const response = await POST(lessonRequest());
    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();

    const events: LessonStreamEvent[] = [];
    await consumeLessonEventStream(response.body!, (event) => events.push(event));
    const runtime = events.reduce(applyLessonStreamEvent, createLessonRuntimeState());

    expect(events.map((event) => event.type)).toEqual([
      "lesson.meta",
      "lesson.delta",
      "lesson.replace",
      "lesson.complete",
    ]);
    expect(runtime.status).toBe("complete");
    expect(runtime.error).toBeNull();
    expect(runtime.content).toContain("Alliance obligations connected");
    expect(runtime.content).not.toContain("does not finish");
    expect(runtime.content.trim().split(/\s+/).length).toBeLessThanOrEqual(360);
  });

  it("replaces a completed but insubstantial lesson with the validated brief", async () => {
    mocks.streamGeneratedLesson.mockImplementation(async (_input, onDelta) => {
      onDelta("Alliance obligations are important. This answer is much too thin for the planned lesson.");
      throw new StreamedLessonGenerationError("Lesson below substance threshold", {
        failureKind: "content_below_substance_threshold",
        model: "configured-lesson-model",
        responseId: "response-thin",
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 22,
        latencyToFirstTokenMs: 80,
        elapsedMs: 500,
        wordCount: 13,
      });
    });

    const response = await POST(lessonRequest());
    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();

    const events: LessonStreamEvent[] = [];
    await consumeLessonEventStream(response.body!, (event) => events.push(event));
    const runtime = events.reduce(applyLessonStreamEvent, createLessonRuntimeState());

    expect(events.map((event) => event.type)).toEqual([
      "lesson.meta",
      "lesson.delta",
      "lesson.replace",
      "lesson.complete",
    ]);
    expect(runtime.status).toBe("complete");
    expect(runtime.content).toContain("Alliance obligations connected a local crisis");
    expect(runtime.content).not.toContain("much too thin");
  });

  it("caps legacy cached lesson ideas to the activity's real teaching time", async () => {
    mocks.streamGeneratedLesson.mockResolvedValue({
      model: "configured-lesson-model",
      responseId: "response-1",
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 70,
      latencyToFirstTokenMs: 100,
      elapsedMs: 800,
      wordCount: 30,
    });
    const request = lessonRequest();
    const body = await request.json();
    body.previewLesson.activity.lessonBrief.essentialIdeas = [
      "Alliance obligations connected a local crisis to wider mobilization and declarations of war.",
      "Mobilization timetables narrowed the time leaders had to negotiate before military plans took over.",
      "Germany's invasion of Belgium brought Britain into the wider conflict.",
      "Industrial resources helped sustain the conflict after the opening campaigns failed.",
    ];

    const response = await POST(new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    expect(response.status).toBe(200);
    if (response.body) await consumeLessonEventStream(response.body, () => undefined);

    expect(mocks.streamGeneratedLesson).toHaveBeenCalledWith(
      expect.objectContaining({
        plannedMinutes: 4,
        essentialIdeas: [
          "Alliance obligations connected a local crisis to wider mobilization and declarations of war.",
        ],
      }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it("completes with the validated brief when live lesson generation is unavailable", async () => {
    mocks.lessonConfigured = false;

    const response = await POST(lessonRequest());
    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();

    const events: LessonStreamEvent[] = [];
    await consumeLessonEventStream(response.body!, (event) => events.push(event));
    const runtime = events.reduce(applyLessonStreamEvent, createLessonRuntimeState());

    expect(events.map((event) => event.type)).toEqual([
      "lesson.meta",
      "lesson.replace",
      "lesson.complete",
    ]);
    expect(runtime.status).toBe("complete");
    expect(runtime.content).toContain("Alliance obligations connected");
    expect(mocks.streamGeneratedLesson).not.toHaveBeenCalled();
  });
});

function lessonRequest() {
  const topicId = "11111111-1111-4111-8111-111111111111";
  return new Request("http://localhost/api/sessions/lesson", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "generate",
      planId: "22222222-2222-4222-8222-222222222222",
      planSessionId: "33333333-3333-4333-8333-333333333333",
      activityIndex: 0,
      previewLesson: {
        activity: {
          topicId,
          methodPhase: "model",
          estimatedMinutes: 4,
          requiredForCompletion: true,
          type: "instruction",
          concept: null,
          label: "Learn",
          title: "Build the World War I cause map",
          body: "Study the bounded causal model before using it in the next guided activity.",
          teaching: null,
          lessonBrief: {
            version: 1,
            topicIds: [topicId],
            essentialIdeas: [
              "Alliance obligations connected a local crisis to wider mobilization and declarations of war.",
              "Mobilization timetables narrowed the time leaders had to negotiate before military plans took over.",
            ],
            sourceChunks: [],
            knowledgeSource: "model_knowledge",
            evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
            contentRequirements: {
              teachEveryEssentialIdea: true,
              includeConcreteExample: true,
              includeCommonMixup: true,
              preservePrerequisiteOrder: true,
            },
          },
          practiceIntent: null,
          misconceptionSummary: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        deliveryInstructions: {
          schemaVersion: 1,
          explanationDensity: "balanced",
          tone: "calm",
          analogyUse: "only_when_helpful",
          workedExamples: "task_required",
          structure: "overview_first",
          pacing: {
            firstActionMinutes: 4,
            maximumActivities: 5,
            instruction: "Build one bounded model before guided practice.",
          },
          learnerContext: ["The learner asked for the big picture before details."],
          contentRequirements: {
            coverAllEssentialIdeas: true,
            includeConcreteWorkedExample: true,
            includeCommonMixup: true,
            preservePrerequisiteOrder: true,
          },
        },
      },
    }),
  });
}
