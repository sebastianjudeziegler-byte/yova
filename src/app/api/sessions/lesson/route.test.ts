import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  lessonConfigured: true,
  developmentPreview: true,
  supabaseConfigured: false,
  cachedSession: null as unknown,
  supabase: null as unknown,
  claimAIRequest: vi.fn(),
  releaseAIRequestClaim: vi.fn(),
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
vi.mock("@/lib/session-generation/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session-generation/schema")>();
  const { z } = await import("zod");
  const cachedSessionSchema = z.unknown().transform(() => mocks.cachedSession);
  return {
    ...actual,
    CachedGeneratedSessionV16Schema: cachedSessionSchema,
    CachedGeneratedSessionV17Schema: cachedSessionSchema,
  };
});
vi.mock("@/lib/server/ai-usage", () => ({
  claimAIRequest: mocks.claimAIRequest,
  releaseAIRequestClaim: mocks.releaseAIRequestClaim,
}));
vi.mock("@/lib/server/development-preview", () => ({
  isDevelopmentPreviewRequest: () => mocks.developmentPreview,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkLessonGenerationRateLimit: () => ({ allowed: true }),
  requestRateLimitKey: () => "route-test",
}));
vi.mock("@/lib/server/session-operation-guard", () => ({
  verifyOperationalPlanSession: () => ({ allowed: true }),
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => mocks.supabaseConfigured,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => mocks.supabase,
}));

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
    mocks.developmentPreview = true;
    mocks.supabaseConfigured = false;
    mocks.cachedSession = null;
    mocks.supabase = null;
    mocks.claimAIRequest.mockReset();
    mocks.releaseAIRequestClaim.mockReset().mockResolvedValue(true);
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

  it("serves the bounded lesson fallback with the durable allowance reset interval", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({
      data: { step_data: { generatedSession: { cached: true } } },
      error: null,
    });
    mocks.developmentPreview = false;
    mocks.supabaseConfigured = true;
    mocks.cachedSession = { activities: [lessonActivity()] };
    mocks.supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "44444444-4444-4444-8444-444444444444" } },
          error: null,
        }),
      },
      from: vi.fn(() => query),
    };
    mocks.claimAIRequest.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 7_200,
      remainingToday: 0,
    });

    const response = await POST(lessonRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Retry-After")).toBe("7200");
    expect(response.headers.get("X-Yova-Fallback-Reason")).toBe(
      "guided_session_allowance_exhausted",
    );
    expect(response.body).not.toBeNull();
    const events: LessonStreamEvent[] = [];
    await consumeLessonEventStream(response.body!, (event) => events.push(event));
    expect(events.map((event) => event.type)).toEqual([
      "lesson.meta",
      "lesson.replace",
      "lesson.complete",
    ]);
    expect(mocks.streamGeneratedLesson).not.toHaveBeenCalled();
    expect(mocks.recordObservation).toHaveBeenCalledWith(
      expect.anything(),
      "44444444-4444-4444-8444-444444444444",
      expect.objectContaining({
        finalOutcome: "fallback",
        failedValidator: null,
        diagnostics: expect.objectContaining({
          lessonFailureKind: "allowance_exhausted",
        }),
      }),
    );
  });

  it("returns the durable claim when provider generation falls back", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({
      data: { step_data: { generatedSession: { cached: true } } },
      error: null,
    });
    mocks.developmentPreview = false;
    mocks.supabaseConfigured = true;
    mocks.cachedSession = { activities: [lessonActivity()] };
    mocks.supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "44444444-4444-4444-8444-444444444444" } },
          error: null,
        }),
      },
      from: vi.fn(() => query),
    };
    mocks.claimAIRequest.mockResolvedValue({
      allowed: true,
      claimId: "55555555-5555-4555-8555-555555555555",
      retryAfterSeconds: 0,
      remainingToday: 9,
    });
    mocks.streamGeneratedLesson.mockRejectedValue(new StreamedLessonGenerationError(
      "Provider failed",
      {
        failureKind: "provider_request_error",
        model: "configured-lesson-model",
        responseId: null,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        latencyToFirstTokenMs: null,
        elapsedMs: 500,
        wordCount: 0,
      },
    ));

    const response = await POST(lessonRequest());
    expect(response.body).not.toBeNull();
    await consumeLessonEventStream(response.body!, () => undefined);

    expect(mocks.releaseAIRequestClaim).toHaveBeenCalledWith(
      mocks.supabase,
      "55555555-5555-4555-8555-555555555555",
    );
  });
});

function lessonRequest() {
  return new Request("http://localhost/api/sessions/lesson", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "generate",
      planId: "22222222-2222-4222-8222-222222222222",
      planSessionId: "33333333-3333-4333-8333-333333333333",
      activityIndex: 0,
      previewLesson: {
        activity: lessonActivity(),
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

function lessonActivity() {
  const topicId = "11111111-1111-4111-8111-111111111111";
  return {
    topicId,
    methodPhase: "model" as const,
    estimatedMinutes: 4,
    requiredForCompletion: true,
    type: "instruction" as const,
    concept: null,
    label: "Learn",
    title: "Build the World War I cause map",
    body: "Study the bounded causal model before using it in the next guided activity.",
    teaching: null,
    lessonBrief: {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: [
        "Alliance obligations connected a local crisis to wider mobilization and declarations of war.",
        "Mobilization timetables narrowed the time leaders had to negotiate before military plans took over.",
      ],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    },
    practiceIntent: null,
    misconceptionSummary: null,
    choices: [],
    correctAnswer: null,
    feedback: null,
  };
}
