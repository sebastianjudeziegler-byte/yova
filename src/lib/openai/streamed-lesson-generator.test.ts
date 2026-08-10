import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const openAIMocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { create: openAIMocks.create } }),
}));

vi.mock("@/lib/openai/config", () => ({
  getOpenAILessonConfig: () => ({ model: "configured-lesson-model" }),
}));

import {
  buildStreamedLessonPrompt,
  StreamedLessonGenerationError,
  streamGeneratedLesson,
  type StreamedLessonInput,
} from "@/lib/openai/streamed-lesson-generator";

const lessonInput: StreamedLessonInput = {
  lessonTitle: "Cell transport",
  topicTitles: ["Diffusion", "Osmosis"],
  essentialIdeas: ["Concentration gradients", "Water movement"],
  knowledgeSource: "model",
  sourceChunks: [],
  evidenceContext: {
    confirmedGaps: [{ topicId: "topic-1", concept: "concentration gradient" }],
    secureTopics: [{ topicId: "topic-2", title: "cell membrane" }],
    pastMisconceptions: [{
      topicId: "topic-1",
      concept: "osmosis versus diffusion",
      summary: "treated osmosis and diffusion as interchangeable",
    }],
  },
  contentRequirements: {
    coverAllEssentialIdeas: true,
    concreteWorkedExample: false,
    commonMixup: true,
  },
  deliveryInstructions: {
    schemaVersion: 1,
    explanationDensity: "detailed",
    tone: "calm",
    analogyUse: "only_when_helpful",
    workedExamples: "task_required",
    structure: "overview_first",
    pacing: {
      firstActionMinutes: 4,
      maximumActivities: 5,
      instruction: "Lead with the big picture, then add detail.",
    },
    learnerContext: ["The learner asked for the overall model before details."],
    contentRequirements: {
      coverAllEssentialIdeas: true,
      includeConcreteWorkedExample: false,
      includeCommonMixup: true,
      preservePrerequisiteOrder: true,
    },
  },
};

beforeEach(() => {
  openAIMocks.create.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("streamed lesson prompt", () => {
  it("carries the full bounded brief including learner evidence", () => {
    const prompt = buildStreamedLessonPrompt(lessonInput);

    expect(prompt).toContain("Concentration gradients");
    expect(prompt).toContain("treated osmosis and diffusion as interchangeable");
    expect(prompt).toContain("Lead with the big picture");
  });

  it("preserves provider usage and partial stream measurements on an incomplete response", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_120)
      .mockReturnValueOnce(1_450);
    openAIMocks.create.mockResolvedValue(streamEvents([
      { type: "response.output_text.delta", delta: "A partial lesson reached the learner" },
      {
        type: "response.incomplete",
        response: {
          id: "resp_incomplete",
          model: "provider-lesson-model",
          status: "incomplete",
          usage: {
            input_tokens: 120,
            output_tokens: 35,
            input_tokens_details: { cached_tokens: 20 },
          },
        },
      },
    ]));

    const error = await captureStreamFailure();

    expect(error).toBeInstanceOf(StreamedLessonGenerationError);
    expect(error.stats).toEqual({
      failureKind: "provider_incomplete",
      model: "provider-lesson-model",
      responseId: "resp_incomplete",
      inputTokens: 120,
      cachedInputTokens: 20,
      outputTokens: 35,
      latencyToFirstTokenMs: 120,
      elapsedMs: 450,
      wordCount: 6,
    });
  });

  it("preserves observed partial output when the provider iterator throws", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_075)
      .mockReturnValueOnce(2_310);
    openAIMocks.create.mockResolvedValue(throwingStream([
      { type: "response.output_text.delta", delta: "Three words streamed" },
    ]));

    const error = await captureStreamFailure();

    expect(error).toBeInstanceOf(StreamedLessonGenerationError);
    expect(error.stats).toEqual({
      failureKind: "provider_request_error",
      model: "configured-lesson-model",
      responseId: null,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      latencyToFirstTokenMs: 75,
      elapsedMs: 310,
      wordCount: 3,
    });
  });

  it("distinguishes a provider error event from an incomplete response", async () => {
    openAIMocks.create.mockResolvedValue(streamEvents([{ type: "error" }]));

    const error = await captureStreamFailure();

    expect(error.stats.failureKind).toBe("provider_error_event");
  });

  it("distinguishes an empty completed stream from a connection failure", async () => {
    openAIMocks.create.mockResolvedValue(streamEvents([{
      type: "response.completed",
      response: {
        id: "resp_empty",
        model: "provider-lesson-model",
        status: "completed",
        usage: { input_tokens: 50, output_tokens: 0 },
      },
    }]));

    const error = await captureStreamFailure();

    expect(error.stats.failureKind).toBe("stream_ended_without_content");
  });

  it("records an internal runtime deadline separately from a learner disconnect", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Runtime deadline reached", "TimeoutError"));
    openAIMocks.create.mockRejectedValue(new DOMException("Runtime deadline reached", "AbortError"));

    const error = await captureStreamFailure(controller.signal);

    expect(error.stats.failureKind).toBe("runtime_timeout");
  });
});

async function captureStreamFailure(signal?: AbortSignal) {
  try {
    await streamGeneratedLesson(lessonInput, () => undefined, signal);
  } catch (error) {
    if (error instanceof StreamedLessonGenerationError) return error;
    throw error;
  }
  throw new Error("Expected streamed lesson generation to fail.");
}

function streamEvents(events: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

function throwingStream(events: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
      throw new Error("Provider connection closed.");
    },
  };
}
