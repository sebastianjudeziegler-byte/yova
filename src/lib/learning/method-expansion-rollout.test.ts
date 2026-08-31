import { describe, expect, it } from "vitest";
import {
  expandedMethodIsEnabled,
  METHOD_EXPANSION_ROLLOUT,
  METHOD_EXPANSION_ROLLOUT_VERSION,
} from "@/lib/learning/method-expansion-rollout";

describe("method expansion rollout", () => {
  it("keeps each new recipe independently reversible", () => {
    expect(METHOD_EXPANSION_ROLLOUT_VERSION).toBe("method_expansion_v1");
    expect(Object.keys(METHOD_EXPANSION_ROLLOUT).sort()).toEqual([
      "concept_mapping",
      "practice_problems",
      "pretesting",
    ]);
    expect(Object.values(METHOD_EXPANSION_ROLLOUT)).toEqual([true, true, true]);
  });

  it("does not gate stable catalog methods", () => {
    expect(expandedMethodIsEnabled("retrieval_practice")).toBe(true);
    expect(expandedMethodIsEnabled("self_explanation")).toBe(true);
  });
});
