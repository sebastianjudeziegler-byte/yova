import { describe, expect, it } from "vitest";
import {
  applyLessonStreamEvent,
  createLessonRuntimeState,
} from "@/lib/session-generation/lesson-runtime";

describe("streamed lesson runtime state", () => {
  it("assembles lesson deltas and records completion diagnostics", () => {
    const meta = applyLessonStreamEvent(createLessonRuntimeState(), {
      type: "lesson.meta",
      requestId: "123e4567-e89b-12d3-a456-426614174000",
      model: "gpt-5.4",
    });
    const first = applyLessonStreamEvent(meta, { type: "lesson.delta", delta: "A connected " });
    const second = applyLessonStreamEvent(first, { type: "lesson.delta", delta: "mental model." });
    const complete = applyLessonStreamEvent(second, {
      type: "lesson.complete",
      elapsedMs: 1_200,
      latencyToFirstTokenMs: 180,
      inputTokens: 300,
      cachedInputTokens: 200,
      outputTokens: 80,
      wordCount: 4,
      model: "gpt-5.4",
    });

    expect(complete).toMatchObject({
      status: "complete",
      content: "A connected mental model.",
      wordCount: 4,
      latencyToFirstTokenMs: 180,
    });
  });

  it("supports a clean retry without carrying partial text", () => {
    const failed = applyLessonStreamEvent(
      applyLessonStreamEvent(createLessonRuntimeState(), { type: "lesson.delta", delta: "Partial" }),
      { type: "lesson.error", message: "Try again.", retryable: true },
    );

    expect(failed).toMatchObject({ status: "error", content: "Partial" });
    expect(createLessonRuntimeState()).toMatchObject({ status: "idle", content: "", error: null });
  });

  it("replaces partial provider output with a complete bounded recovery lesson", () => {
    const partial = applyLessonStreamEvent(
      createLessonRuntimeState(),
      { type: "lesson.delta", delta: "A long response that stopped midway" },
    );
    const replaced = applyLessonStreamEvent(partial, {
      type: "lesson.replace",
      content: "# The bounded model\n\nA short, complete explanation.",
    });
    const complete = applyLessonStreamEvent(replaced, {
      type: "lesson.complete",
      elapsedMs: 3_000,
      latencyToFirstTokenMs: 200,
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 70,
      wordCount: 7,
      model: "gpt-5.4",
    });

    expect(complete).toMatchObject({
      status: "complete",
      content: "# The bounded model\n\nA short, complete explanation.",
      error: null,
      wordCount: 7,
    });
    expect(complete.content).not.toContain("stopped midway");
  });
});
