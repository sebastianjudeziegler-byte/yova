import { describe, expect, it } from "vitest";
import { difficultyBand, HIGH_BAND_QUESTION_COUNT, prerequisiteDepth } from "./topic-difficulty";

const topic = (id: string, prerequisiteTopicIds: string[] = [], removed = false) => ({ id, prerequisiteTopicIds, removed });

// Brief 1.5 item 4: deterministic difficulty. Not a model rating, not description length.
describe("topic difficulty", () => {
  it("prerequisite depth counts every topic that must precede this one, transitively and once", () => {
    const topics = [topic("a"), topic("b", ["a"]), topic("c", ["b"]), topic("d", ["b", "c"])];
    expect(prerequisiteDepth("a", topics)).toBe(0);
    expect(prerequisiteDepth("c", topics)).toBe(2);
    expect(prerequisiteDepth("d", topics)).toBe(3);
  });

  it("ignores removed topics and survives a prerequisite cycle", () => {
    expect(prerequisiteDepth("b", [topic("a", [], true), topic("b", ["a"])])).toBe(0);
    expect(prerequisiteDepth("x", [topic("x", ["y"]), topic("y", ["x"])])).toBe(1);
  });

  it.each([
    [0, 0, "low"], [2, 0, "low"], [1, 1, "low"],
    [3, 0, "medium"], [2, 3, "medium"],
    [4, 2, "high"], [0, 6, "high"], [12, 0, "high"],
  ] as const)("%i subtopics and depth %i → %s", (subtopicCount, depth, band) => {
    expect(difficultyBand({ subtopicCount, prerequisiteDepth: depth })).toBe(band);
  });

  it("the high band asks eight questions", () => {
    expect(HIGH_BAND_QUESTION_COUNT).toBe(8);
  });
});
