import { describe, expect, it } from "vitest";
import { planQuestionSlots, type QuestionMix } from "./question-mix";
import { firstPassPartCount, PRACTICE_PART_SIZE, practicePartSizes, scaffoldedPart, scaffoldedParts } from "./practice-parts";

const conceptual: QuestionMix = { recall: 1, application: 2, compare_contrast: 1, prediction: 0, misconception: 1 };
const keyPointIds = ["k1", "k2", "k3", "k4", "k5"];
const DIFFICULTY = ["recall", "misconception", "application", "prediction", "compare_contrast"];

// Founder decision (18 Sept 2026, option B): a long practice workload is one
// sitting in rounds of at most eight, built up from recall to application and
// comparison, instead of one 32-question generation that did not fit its time
// budget (CI runs 420-428).
describe("scaffolded practice parts", () => {
  it.each([
    [32, [8, 8, 8, 8]],
    [24, [8, 8, 8]],
    [20, [7, 7, 6]],
    [10, [5, 5]],
    [9, [5, 4]],
    [8, [8]],
    [6, [6]],
    [3, [3]],
  ])("splits %i questions into near-equal parts of at most eight", (total, sizes) => {
    expect(practicePartSizes(total)).toEqual(sizes);
    expect(Math.max(...practicePartSizes(total))).toBeLessThanOrEqual(PRACTICE_PART_SIZE);
  });

  it("keeps every planned question exactly once across the parts", () => {
    const slots = planQuestionSlots({ keyPointIds, mix: conceptual, count: 32 });
    const parts = scaffoldedParts(slots);
    expect(parts.map((part) => part.length)).toEqual([8, 8, 8, 8]);
    expect(parts.flat().map((slot) => slot.slotId).sort()).toEqual(slots.map((slot) => slot.slotId).sort());
  });

  it("builds up from recall to application and comparison across the parts", () => {
    const parts = scaffoldedParts(planQuestionSlots({ keyPointIds, mix: conceptual, count: 32 }));
    const rank = (type: string) => DIFFICULTY.indexOf(type);
    const flat = parts.flat();
    for (let index = 1; index < flat.length; index += 1) expect(rank(flat[index]!.type)).toBeGreaterThanOrEqual(rank(flat[index - 1]!.type));
    expect(parts[0]!.some((slot) => slot.type === "recall")).toBe(true);
    expect(parts.at(-1)!.some((slot) => slot.type === "compare_contrast")).toBe(true);
  });

  it("gives every request the same part for the same plan, so the server can recompute it", () => {
    const first = scaffoldedPart({ keyPointIds, mix: conceptual, count: 24 }, 2);
    const again = scaffoldedPart({ keyPointIds, mix: conceptual, count: 24 }, 2);
    expect(first).toEqual(again);
    expect(first).toHaveLength(8);
    expect(() => scaffoldedPart({ keyPointIds, mix: conceptual, count: 24 }, 4)).toThrow(/part/i);
  });

  it("uses one part for anything the profile or a practice test already keeps to eight", () => {
    expect(firstPassPartCount({ roundKind: "active_recall", questionTarget: 5, workloadBounded: false })).toBe(1);
    expect(firstPassPartCount({ roundKind: "practice_test", questionTarget: 5, workloadBounded: false })).toBe(1);
    expect(firstPassPartCount({ roundKind: "active_recall", questionTarget: 32, workloadBounded: true })).toBe(4);
    expect(firstPassPartCount({ roundKind: "practice_test", questionTarget: 24, workloadBounded: true })).toBe(3);
  });
});
