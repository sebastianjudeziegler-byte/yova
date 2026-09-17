import { z } from "zod";

export const SegmentCompletionsSchema = z.array(z.object({
  segmentId: z.string().trim().min(1).max(80),
  correctAnswers: z.number().int().min(0).max(192),
  totalAnswers: z.number().int().min(0).max(192),
  elapsedSeconds: z.number().int().min(0).max(21_600),
}).strict().refine(segment => segment.correctAnswers <= segment.totalAnswers, "Correct answers exceed attempts")).length(2)
  .refine(segments => segments.length === 2 && segments[0].segmentId !== segments[1].segmentId, "Segment identities must be distinct");

export function readSegmentCompletions(value: unknown) {
  const parsed = SegmentCompletionsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
