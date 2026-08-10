import { z } from "zod";

const LessonStreamMetaEventSchema = z.object({
  type: z.literal("lesson.meta"),
  requestId: z.string().uuid(),
  model: z.string().trim().min(1).max(80),
}).strict();

const LessonStreamDeltaEventSchema = z.object({
  type: z.literal("lesson.delta"),
  delta: z.string().min(1),
}).strict();

const LessonStreamCompleteEventSchema = z.object({
  type: z.literal("lesson.complete"),
  elapsedMs: z.number().int().min(0).max(300_000),
  latencyToFirstTokenMs: z.number().int().min(0).max(300_000).nullable(),
  inputTokens: z.number().int().min(0),
  cachedInputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  wordCount: z.number().int().min(0),
  model: z.string().trim().min(1).max(80),
}).strict();

const LessonStreamErrorEventSchema = z.object({
  type: z.literal("lesson.error"),
  message: z.string().trim().min(1).max(240),
  retryable: z.boolean(),
}).strict();

export const LessonStreamEventSchema = z.discriminatedUnion("type", [
  LessonStreamMetaEventSchema,
  LessonStreamDeltaEventSchema,
  LessonStreamCompleteEventSchema,
  LessonStreamErrorEventSchema,
]);

export type LessonStreamEvent = z.infer<typeof LessonStreamEventSchema>;

const encoder = new TextEncoder();

export function encodeLessonStreamEvent(event: LessonStreamEvent) {
  const parsed = LessonStreamEventSchema.parse(event);
  return encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`);
}

/**
 * Consumes the small SSE protocol used by YOVA lessons. The parser keeps an
 * incomplete trailing frame between reads, so JSON may arrive split across
 * arbitrary network chunks without losing text.
 */
export async function consumeLessonEventStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: LessonStreamEvent) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = done ? "" : frames.pop() ?? "";
      for (const frame of frames) emitFrame(frame, onEvent);

      if (done) {
        if (buffer.trim()) emitFrame(buffer, onEvent);
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function emitFrame(frame: string, onEvent: (event: LessonStreamEvent) => void) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return;
  onEvent(LessonStreamEventSchema.parse(JSON.parse(data)));
}
