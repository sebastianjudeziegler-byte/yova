import type { WorkBlock } from "./schema";

/** Delivers the already reviewed text. There is no generation, semantic review,
 * attempt write, or progress reset on this read path. */
export function streamReviewedBlockExplanation(block: WorkBlock, activityId: string) {
  const activity = block.activities.find(item => item.id === activityId);
  if (block.learningMode !== "learn" || !activity || activity.kind !== "ai_explanation"
    || block.sources.some(source => source.topicId === activity.topicId)) throw new Error("This block has no default explanation for that step.");
  const characters = Array.from(activity.content);
  let cursor = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (cursor >= characters.length) { controller.close(); return; }
    controller.enqueue(new TextEncoder().encode(characters.slice(cursor, cursor + 320).join("")));
    cursor += 320;
  } });
}
