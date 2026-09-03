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
  buildBoundedFallbackLesson,
  buildStreamedLessonPrompt,
  lessonWordBudgetForMinutes,
  StreamedLessonGenerationError,
  streamGeneratedLesson,
  streamGeneratedLessonWithRetry,
  type StreamedLessonInput,
} from "@/lib/openai/streamed-lesson-generator";

const lessonInput: StreamedLessonInput = {
  lessonTitle: "Cell transport",
  plannedMinutes: 4,
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
    expect(prompt).toContain("This teaching block has 4 minutes");
    expect(prompt).toContain("at least 120 substantive words");
    expect(prompt).toContain("never exceed 360 words");
    expect(prompt).toContain("Do not turn a broad title into a survey of the whole subject");
  });

  it("turns planned teaching time into a bounded provider request", async () => {
    openAIMocks.create.mockResolvedValue(streamEvents([{ type: "error" }]));

    await captureStreamFailure();

    expect(lessonWordBudgetForMinutes(4)).toEqual({
      minutes: 4,
      minimumWords: 120,
      targetWords: 260,
      maximumWords: 360,
      maximumOutputTokens: 3_800,
    });
    expect(openAIMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        text: { verbosity: "medium" },
        max_output_tokens: 3_800,
      }),
      { signal: undefined },
    );
  });

  it("trims a lesson that overruns its reading-time ceiling instead of failing it", async () => {
    const sentence = "Concentration gradients guide particles while water movement balances conditions across the membrane.";
    const boundedPart = Array.from({ length: 25 }, () => sentence).join(" ");
    const overshootPart = Array.from({ length: 40 }, () => sentence).join(" ");
    openAIMocks.create.mockResolvedValue(streamEvents([
      { type: "response.output_text.delta", delta: boundedPart },
      { type: "response.output_text.delta", delta: ` ${overshootPart}` },
      {
        type: "response.completed",
        response: {
          id: "resp_oversized",
          model: "provider-lesson-model",
          status: "completed",
          usage: { input_tokens: 100, output_tokens: 500 },
        },
      },
    ]));

    let visibleLesson = "";
    const result = await streamGeneratedLesson(lessonInput, (delta) => { visibleLesson += delta; });

    expect(result.truncatedToBudget).toBe(true);
    expect(result.wordCount).toBeLessThanOrEqual(360);
    expect(result.content.endsWith(".")).toBe(true);
    expect(result.qualityNote).toBeNull();
    // The overshoot delta is never rendered mid-stream; the route swaps in the trimmed text.
    expect(visibleLesson.trim().split(/\s+/)).toHaveLength(300);
  });

  it("enforces the hard ceiling for a slight one-to-fifteen-percent overrun", async () => {
    const sentence = "Concentration gradients guide particles while water movement balances conditions across the membrane.";
    const streamedPrefix = Array.from({ length: 29 }, () => sentence).join(" ");
    const crossingDelta = Array.from({ length: 2 }, () => sentence).join(" ");
    openAIMocks.create.mockResolvedValue(streamEvents([
      { type: "response.output_text.delta", delta: streamedPrefix },
      { type: "response.output_text.delta", delta: ` ${crossingDelta}` },
      {
        type: "response.completed",
        response: {
          id: "resp_slight_overrun",
          model: "provider-lesson-model",
          status: "completed",
          usage: {
            input_tokens: 111,
            output_tokens: 222,
            input_tokens_details: { cached_tokens: 33 },
          },
        },
      },
    ]));

    let visibleLesson = "";
    const result = await streamGeneratedLesson(lessonInput, (delta) => { visibleLesson += delta; });

    expect(result.truncatedToBudget).toBe(true);
    expect(result.wordCount).toBe(360);
    expect(result.inputTokens).toBe(111);
    expect(result.cachedInputTokens).toBe(33);
    expect(result.outputTokens).toBe(222);
    expect(visibleLesson.trim().split(/\s+/)).toHaveLength(348);
  });

  it("does not treat a bounded overrun prefix as success without a completion event", async () => {
    const overrun = Array.from(
      { length: 31 },
      () => "Concentration gradients guide particles while water movement balances conditions across the membrane.",
    ).join(" ");
    openAIMocks.create.mockResolvedValue(streamEvents([
      { type: "response.output_text.delta", delta: overrun },
    ]));

    const error = await captureStreamFailure();

    expect(error.stats.failureKind).toBe("stream_ended_without_completion");
  });

  it("revalidates a trimmed prefix and rejects it when an essential idea only appears after the ceiling", async () => {
    const firstIdeaOnly = "Concentration gradients direct particles across membranes because concentration differences create directional pressure.";
    const boundedPrefix = Array.from({ length: 33 }, () => firstIdeaOnly).join(" ");
    const lateIdea = "Water movement balances dissolved-particle conditions across a selectively permeable membrane.";
    openAIMocks.create.mockResolvedValue(streamEvents([
      { type: "response.output_text.delta", delta: boundedPrefix },
      { type: "response.output_text.delta", delta: ` ${Array.from({ length: 8 }, () => lateIdea).join(" ")}` },
      {
        type: "response.completed",
        response: {
          id: "resp_trimmed_missing_idea",
          model: "provider-lesson-model",
          status: "completed",
          usage: { input_tokens: 130, output_tokens: 410 },
        },
      },
    ]));

    const error = await captureStreamFailure();

    expect(error.stats.failureKind).toBe("content_below_substance_threshold");
    expect(error.message).toBe("The lesson did not cover every assigned essential idea.");
    expect(error.stats.inputTokens).toBe(130);
    expect(error.stats.outputTokens).toBe(410);
  });

  it("rejects a completed lesson that is too thin for its planned teaching time", async () => {
    const thinLesson = "Concentration gradients and water movement are the lesson topics. This does not explain either process in enough depth.";
    openAIMocks.create.mockResolvedValue(streamEvents([
      { type: "response.output_text.delta", delta: thinLesson },
      {
        type: "response.completed",
        response: {
          id: "resp_thin",
          model: "provider-lesson-model",
          status: "completed",
          usage: { input_tokens: 100, output_tokens: 30 },
        },
      },
    ]));

    const error = await captureStreamFailure();

    expect(error.stats.failureKind).toBe("content_below_substance_threshold");
    expect(error.stats.responseId).toBe("resp_thin");
    expect(error.message).toMatch(/too short/i);
  });

  it("keeps omitted-essential-idea coverage as a hard failure above the word floor", async () => {
    const oneIdeaLesson = Array.from(
      { length: 14 },
      (_, index) => `Concentration gradients direct particle movement across membranes in worked situation ${index + 1}, making unequal concentrations progressively more even.`,
    ).join(" ");
    openAIMocks.create.mockResolvedValue(streamEvents([
      { type: "response.output_text.delta", delta: oneIdeaLesson },
      {
        type: "response.completed",
        response: {
          id: "resp_missing_idea",
          model: "provider-lesson-model",
          status: "completed",
          usage: { input_tokens: 100, output_tokens: 260 },
        },
      },
    ]));

    const error = await captureStreamFailure();

    expect(error.stats.wordCount).toBeGreaterThanOrEqual(120);
    expect(error.stats.failureKind).toBe("content_below_substance_threshold");
    expect(error.message).not.toContain("Water movement");
  });

  it("keeps complete explanatory prose as a hard failure", async () => {
    const unfinishedLesson = Array.from(
      { length: 12 },
      () => "Concentration gradients shape particle movement while water movement balances membrane conditions without completing explanatory prose",
    ).join(" ");
    openAIMocks.create.mockResolvedValue(streamEvents([
      { type: "response.output_text.delta", delta: unfinishedLesson },
      {
        type: "response.completed",
        response: {
          id: "resp_no_complete_prose",
          model: "provider-lesson-model",
          status: "completed",
          usage: { input_tokens: 100, output_tokens: 240 },
        },
      },
    ]));

    const error = await captureStreamFailure();

    expect(error.stats.failureKind).toBe("content_below_substance_threshold");
    expect(error.message).toMatch(/complete explanatory prose/i);
  });

  it("accepts only a slight word-floor miss after the hard prose and idea gates pass", async () => {
    const sentence = "Concentration gradients guide particles while water movement balances conditions across the membrane.";
    const lesson = Array.from({ length: 9 }, () => sentence).join(" ");
    openAIMocks.create.mockResolvedValue(streamEvents([
      { type: "response.output_text.delta", delta: lesson },
      {
        type: "response.completed",
        response: {
          id: "resp_slight_floor",
          model: "provider-lesson-model",
          status: "completed",
          usage: { input_tokens: 90, output_tokens: 130 },
        },
      },
    ]));

    const result = await streamGeneratedLesson(lessonInput, () => undefined);

    expect(result.wordCount).toBe(108);
    expect(result.qualityNote).toBe("slightly_below_word_floor");
  });

  it("accepts a bounded lesson that substantively covers every assigned idea", async () => {
    const lesson = Array.from({ length: 8 }, (_, index) => (
      `Concentration gradients create a directional difference across a membrane in example ${index + 1}. `
      + "Particles tend to move toward the side with lower concentration, which makes the distribution more even. "
      + "Water movement follows the same pressure to balance conditions, but the membrane determines which particles can cross."
    )).join(" ");
    openAIMocks.create.mockResolvedValue(streamEvents([
      { type: "response.output_text.delta", delta: lesson },
      {
        type: "response.completed",
        response: {
          id: "resp_substantive",
          model: "provider-lesson-model",
          status: "completed",
          usage: { input_tokens: 100, output_tokens: 300 },
        },
      },
    ]));

    const result = await streamGeneratedLesson(lessonInput, () => undefined);

    expect(result.responseId).toBe("resp_substantive");
    expect(result.wordCount).toBeGreaterThanOrEqual(120);
    expect(result.wordCount).toBeLessThanOrEqual(360);
  });

  it("builds a bounded last-resort lesson from the validated brief", () => {
    const fallback = buildBoundedFallbackLesson({
      ...lessonInput,
      essentialIdeas: [
        "Particles move down a concentration gradient until their distribution becomes more even.",
        "Water movement across a membrane depends on the relative concentration of dissolved particles.",
      ],
    });

    expect(fallback).toContain("# Cell transport");
    expect(fallback).toContain("Particles move down a concentration gradient");
    expect(fallback).toContain("Water movement across a membrane");
    expect(fallback.trim().split(/\s+/).length).toBeLessThanOrEqual(
      lessonWordBudgetForMinutes(lessonInput.plannedMinutes).maximumWords,
    );
  });

  it("recovers a complete bounded partial lesson instead of echoing topic labels", () => {
    const partialLesson = `# Why the crisis widened\n\n${Array.from(
      { length: 12 },
      (_, index) => `Prewar alliance commitments connected July Crisis decision ${index + 1} to another state's mobilization and narrowed the room for de-escalation.`,
    ).join(" ")} An unfinished final`;
    const fallback = buildBoundedFallbackLesson({
      ...lessonInput,
      lessonTitle: "Build the World War I map",
      essentialIdeas: ["Prewar alliances", "The July Crisis"],
    }, partialLesson);

    expect(fallback).toMatch(/alliance commitments connected/i);
    expect(fallback).not.toContain("An unfinished final");
    expect(fallback.trim().split(/\s+/).length).toBeLessThanOrEqual(360);
  });

  it("rejects a long partial that leaves the assigned idea for later WWI topics", () => {
    const relevant = Array.from({ length: 5 }, (_, index) => (
      `Alliance obligations connected the local July Crisis to mobilization decision ${index + 1}, making escalation harder to contain.`
    )).join(" ");
    const outOfScope = [
      "Trench warfare on the Western Front then shaped years of fighting between fortified armies.",
      "United States entry later added troops and resources to the Allied war effort.",
      "The Treaty of Versailles finally imposed postwar terms and redrew political boundaries.",
      "Those later developments belong to a broad survey of the conflict rather than the opening crisis.",
    ].join(" ");
    const fallback = buildBoundedFallbackLesson({
      ...lessonInput,
      lessonTitle: "Build the World War I cause map",
      essentialIdeas: [
        "Alliance obligations connected a local crisis to wider mobilization and declarations of war.",
      ],
    }, `${relevant} ${outOfScope}`);

    expect(fallback).toContain("Alliance obligations connected a local crisis");
    expect(fallback).not.toMatch(/Western Front|United States entry|Treaty of Versailles/i);
  });

  it("uses substantive content-source context when essential ideas are labels", () => {
    const fallback = buildBoundedFallbackLesson({
      ...lessonInput,
      lessonTitle: "Build the World War I map",
      essentialIdeas: ["Prewar alliances", "The July Crisis"],
      sourceChunks: [{
        chunkId: crypto.randomUUID(),
        sourceName: "Course notes",
        locationLabel: "Page 2",
        sectionRole: "content_source",
        text: "Alliance commitments connected the decisions of several European powers, so mobilization by one state increased pressure on others to mobilize quickly.",
      }],
    });

    expect(fallback).toContain("Alliance commitments connected the decisions");
    expect(fallback).not.toContain("1. Prewar alliances.");
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

  it("classifies a graceful iterator EOF after an abort as a timeout", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Runtime deadline reached", "TimeoutError"));
    openAIMocks.create.mockResolvedValue(streamEvents([]));

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

describe("streamGeneratedLessonWithRetry", () => {
  it("retries once after a retryable failure and returns the second attempt", async () => {
    const sentence = "Concentration gradients guide particles while water movement balances conditions across the membrane.";
    const goodLesson = Array.from({ length: 20 }, () => sentence).join(" ");
    openAIMocks.create
      .mockResolvedValueOnce(streamEvents([{ type: "error" }]))
      .mockResolvedValueOnce(streamEvents([
        { type: "response.output_text.delta", delta: goodLesson },
        {
          type: "response.completed",
          response: {
            id: "resp_retry",
            model: "provider-lesson-model",
            status: "completed",
            usage: { input_tokens: 100, output_tokens: 200 },
          },
        },
      ]));

    let visible = "";
    const { attempts, result } = await streamGeneratedLessonWithRetry(lessonInput, (delta) => { visible += delta; });

    expect(attempts).toBe(2);
    expect(result.wordCount).toBe(240);
    expect(result.content).toContain("Concentration gradients");
    // The retry is buffered; the route replaces content atomically instead of double-streaming.
    expect(visible).toBe("");
  });

  it("aggregates tokens, elapsed time, and first-token latency across retry success", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      const value = now;
      now += 10;
      return value;
    });
    const goodLesson = Array.from(
      { length: 12 },
      () => "Concentration gradients guide particles while water movement balances conditions across the membrane.",
    ).join(" ");
    openAIMocks.create
      .mockResolvedValueOnce(streamEvents([
        { type: "response.output_text.delta", delta: "A partial lesson reached the learner." },
        {
          type: "response.incomplete",
          response: {
            id: "resp_first_incomplete",
            model: "provider-lesson-model",
            status: "incomplete",
            usage: {
              input_tokens: 70,
              output_tokens: 20,
              input_tokens_details: { cached_tokens: 10 },
            },
          },
        },
      ]))
      .mockResolvedValueOnce(streamEvents([
        { type: "response.output_text.delta", delta: goodLesson },
        {
          type: "response.completed",
          response: {
            id: "resp_retry_success",
            model: "provider-lesson-model",
            status: "completed",
            usage: {
              input_tokens: 100,
              output_tokens: 180,
              input_tokens_details: { cached_tokens: 25 },
            },
          },
        },
      ]));

    const generated = await streamGeneratedLessonWithRetry(lessonInput, () => undefined);

    expect(generated.attempts).toBe(2);
    expect(generated.firstFailureKind).toBe("provider_incomplete");
    expect(generated.result).toMatchObject({
      inputTokens: 170,
      cachedInputTokens: 35,
      outputTokens: 200,
      latencyToFirstTokenMs: 10,
      elapsedMs: 40,
    });
    expect(openAIMocks.create).toHaveBeenCalledTimes(2);
  });

  it("aggregates both failures and never makes a third provider call", async () => {
    let now = 2_000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      const value = now;
      now += 10;
      return value;
    });
    openAIMocks.create
      .mockResolvedValueOnce(streamEvents([
        { type: "response.output_text.delta", delta: "First partial lesson." },
        {
          type: "response.incomplete",
          response: {
            id: "resp_first_failure",
            model: "provider-lesson-model",
            status: "incomplete",
            usage: {
              input_tokens: 60,
              output_tokens: 15,
              input_tokens_details: { cached_tokens: 5 },
            },
          },
        },
      ]))
      .mockResolvedValueOnce(streamEvents([
        { type: "response.output_text.delta", delta: "Second partial lesson." },
        {
          type: "response.failed",
          response: {
            id: "resp_second_failure",
            model: "provider-lesson-model",
            status: "failed",
            usage: {
              input_tokens: 80,
              output_tokens: 25,
              input_tokens_details: { cached_tokens: 7 },
            },
          },
        },
      ]));

    let failure: StreamedLessonGenerationError | null = null;
    try {
      await streamGeneratedLessonWithRetry(lessonInput, () => undefined);
    } catch (error) {
      if (error instanceof StreamedLessonGenerationError) failure = error;
      else throw error;
    }

    expect(failure).not.toBeNull();
    expect(failure?.attemptsMade).toBe(2);
    expect(failure?.initialFailureKind).toBe("provider_incomplete");
    expect(failure?.stats).toMatchObject({
      failureKind: "provider_failed",
      inputTokens: 140,
      cachedInputTokens: 12,
      outputTokens: 40,
      latencyToFirstTokenMs: 10,
      elapsedMs: 40,
    });
    expect(openAIMocks.create).toHaveBeenCalledTimes(2);
  });

  it("honors an abort racing with overrun completion instead of reporting success", async () => {
    const controller = new AbortController();
    const overrun = Array.from(
      { length: 31 },
      () => "Concentration gradients guide particles while water movement balances conditions across the membrane.",
    ).join(" ");
    openAIMocks.create.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "response.output_text.delta", delta: overrun };
        controller.abort();
        yield {
          type: "response.completed",
          response: {
            id: "resp_abort_race",
            model: "provider-lesson-model",
            status: "completed",
            usage: { input_tokens: 100, output_tokens: 300 },
          },
        };
      },
    });

    await expect(streamGeneratedLessonWithRetry(
      lessonInput,
      () => undefined,
      controller.signal,
    )).rejects.toMatchObject({
      attemptsMade: 1,
      stats: { failureKind: "request_aborted" },
    });
    expect(openAIMocks.create).toHaveBeenCalledTimes(1);
  });

  it("does not retry a learner disconnect", async () => {
    const controller = new AbortController();
    openAIMocks.create.mockImplementation(async () => {
      controller.abort();
      return streamEvents([{ type: "error" }]);
    });

    await expect(streamGeneratedLessonWithRetry(lessonInput, () => {}, controller.signal)).rejects.toMatchObject({
      stats: { failureKind: "request_aborted" },
    });
    expect(openAIMocks.create).toHaveBeenCalledTimes(1);
  });
});

describe("token budget regression guard", () => {
  it("gives the reasoning model headroom beyond the word budget", () => {
    // This exact regression shipped twice and silently killed every Learn
    // lesson both times. Reasoning tokens share this cap with the lesson.
    const budget = lessonWordBudgetForMinutes(4);
    expect(budget.maximumOutputTokens).toBeGreaterThanOrEqual(3_800);
  });
});
