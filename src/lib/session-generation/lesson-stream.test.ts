import { describe, expect, it } from "vitest";
import {
  consumeLessonEventStream,
  encodeLessonStreamEvent,
  LessonStreamProtocolError,
  type LessonStreamEvent,
} from "@/lib/session-generation/lesson-stream";

describe("lesson stream protocol", () => {
  it("parses frames even when JSON is split across network chunks", async () => {
    const events: LessonStreamEvent[] = [
      { type: "lesson.meta", requestId: crypto.randomUUID(), model: "gpt-5.6-sol" },
      { type: "lesson.delta", delta: "A causal " },
      { type: "lesson.delta", delta: "explanation." },
      {
        type: "lesson.complete",
        elapsedMs: 1200,
        latencyToFirstTokenMs: 180,
        inputTokens: 210,
        cachedInputTokens: 80,
        outputTokens: 52,
        wordCount: 8,
        model: "gpt-5.6-sol",
      },
    ];
    const bytes = events.map(encodeLessonStreamEvent);
    const all = new Uint8Array(bytes.reduce((sum, value) => sum + value.length, 0));
    let offset = 0;
    for (const value of bytes) {
      all.set(value, offset);
      offset += value.length;
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < all.length; index += 7) {
          controller.enqueue(all.slice(index, index + 7));
        }
        controller.close();
      },
    });
    const received: LessonStreamEvent[] = [];
    await consumeLessonEventStream(stream, (event) => received.push(event));
    expect(received).toEqual(events);
  });

  it("rejects content-bearing fields from completion telemetry", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({
            type: "lesson.complete",
            elapsedMs: 100,
            latencyToFirstTokenMs: 20,
            inputTokens: 30,
            cachedInputTokens: 0,
            outputTokens: 10,
            wordCount: 7,
            model: "gpt-5.6-sol",
            lessonText: "private learner content",
          })}\n\n`,
        ));
        controller.close();
      },
    });
    await expect(consumeLessonEventStream(stream, () => undefined)).rejects.toThrow();
  });

  it("accepts a terminal frame when the connection omits the final blank line", async () => {
    const events: LessonStreamEvent[] = [
      { type: "lesson.meta", requestId: crypto.randomUUID(), model: "gpt-5.6-sol" },
      { type: "lesson.delta", delta: "A bounded lesson." },
      completeEvent(),
    ];
    const encoded = events
      .map((event) => new TextDecoder().decode(encodeLessonStreamEvent(event)))
      .join("")
      .replace(/\n\n$/, "");
    const received: LessonStreamEvent[] = [];

    await consumeLessonEventStream(streamFromText(encoded), (event) => received.push(event));

    expect(received).toEqual(events);
  });

  it("rejects a premature EOF instead of leaving the client streaming forever", async () => {
    const encoded = [
      { type: "lesson.meta", requestId: crypto.randomUUID(), model: "gpt-5.6-sol" },
      { type: "lesson.delta", delta: "Only a partial lesson" },
    ].map((event) => new TextDecoder().decode(encodeLessonStreamEvent(event as LessonStreamEvent))).join("");

    await expect(consumeLessonEventStream(streamFromText(encoded), () => undefined))
      .rejects.toBeInstanceOf(LessonStreamProtocolError);
  });

  it("parses a bounded replacement and completion after a partial provider response", async () => {
    const events: LessonStreamEvent[] = [
      { type: "lesson.meta", requestId: crypto.randomUUID(), model: "gpt-5.6-sol" },
      { type: "lesson.delta", delta: "Partial provider output" },
      { type: "lesson.replace", content: "# Safe lesson\n\nA complete bounded explanation." },
      completeEvent(),
    ];
    const encoded = events
      .map((event) => new TextDecoder().decode(encodeLessonStreamEvent(event)))
      .join("");
    const received: LessonStreamEvent[] = [];

    await consumeLessonEventStream(streamFromText(encoded), (event) => received.push(event));

    expect(received).toEqual(events);
  });
});

function completeEvent(): LessonStreamEvent {
  return {
    type: "lesson.complete",
    elapsedMs: 1_200,
    latencyToFirstTokenMs: 180,
    inputTokens: 210,
    cachedInputTokens: 80,
    outputTokens: 52,
    wordCount: 8,
    model: "gpt-5.6-sol",
  };
}

function streamFromText(value: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}
