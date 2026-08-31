import type { LessonStreamEvent } from "@/lib/session-generation/lesson-stream";

export type LessonRuntimeState = {
  status: "idle" | "streaming" | "complete" | "error";
  content: string;
  error: string | null;
  deliveryMode: "generated" | "bounded_fallback" | null;
  model: string | null;
  requestId: string | null;
  elapsedMs: number | null;
  latencyToFirstTokenMs: number | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  wordCount: number;
};

export function createLessonRuntimeState(): LessonRuntimeState {
  return {
    status: "idle",
    content: "",
    error: null,
    deliveryMode: null,
    model: null,
    requestId: null,
    elapsedMs: null,
    latencyToFirstTokenMs: null,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    wordCount: 0,
  };
}

export function applyLessonStreamEvent(
  state: LessonRuntimeState,
  event: LessonStreamEvent,
): LessonRuntimeState {
  switch (event.type) {
    case "lesson.meta":
      return {
        ...state,
        status: "streaming",
        error: null,
        model: event.model,
        requestId: event.requestId,
      };
    case "lesson.delta":
      return {
        ...state,
        status: "streaming",
        content: state.content + event.delta,
      };
    case "lesson.replace":
      return {
        ...state,
        status: "streaming",
        content: event.content,
        error: null,
      };
    case "lesson.complete":
      return {
        ...state,
        status: "complete",
        error: null,
        deliveryMode: event.deliveryMode,
        model: event.model,
        elapsedMs: event.elapsedMs,
        latencyToFirstTokenMs: event.latencyToFirstTokenMs,
        inputTokens: event.inputTokens,
        cachedInputTokens: event.cachedInputTokens,
        outputTokens: event.outputTokens,
        wordCount: event.wordCount,
      };
    case "lesson.error":
      return {
        ...state,
        status: "error",
        error: event.message,
      };
  }
}
