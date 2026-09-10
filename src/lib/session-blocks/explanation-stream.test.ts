import { describe, expect, it } from "vitest";
import { WorkBlockSchema } from "./schema";
import { blockFixture } from "@/evals/brief-c-block-fixture";
import { streamReviewedBlockExplanation } from "./explanation-stream";

describe("saved explanation delivery", () => {
  it("streams exactly the reviewed text without changing content or progress", async () => {
    const fixture = blockFixture(); fixture.block.sources = [];
    const content = "A function maps each allowed input to one output. 🧭 ".repeat(20);
    Object.assign(fixture.block.activities[0]!, { kind: "ai_explanation", sourceId: null, content });
    const block = WorkBlockSchema.parse(fixture.block); const before = JSON.stringify(block);
    const reader = streamReviewedBlockExplanation(block, block.activities[0]!.id).getReader();
    const decoder = new TextDecoder(); let received = ""; let chunks = 0;
    while (true) { const item = await reader.read(); if (item.done) break; received += decoder.decode(item.value, { stream: true }); chunks += 1; }
    received += decoder.decode();
    expect(chunks).toBeGreaterThan(1); expect(received).toBe(content.trim());
    expect(JSON.stringify(block)).toBe(before);
  });
  it("never supplies a default AI explanation for a source step, a practice block, or another activity", () => {
    const block = WorkBlockSchema.parse(blockFixture().block);
    expect(() => streamReviewedBlockExplanation(block, block.activities[0]!.id)).toThrow(/no default explanation/);
    expect(() => streamReviewedBlockExplanation(block, "foreign-step")).toThrow();
    const forged = { ...block, learningMode: "study" as const, activities: [{ ...block.activities[0]!, kind: "ai_explanation" as const, sourceId: null, content: "An unwanted lesson." }] };
    expect(() => streamReviewedBlockExplanation(forged, forged.activities[0]!.id)).toThrow();
  });
});
