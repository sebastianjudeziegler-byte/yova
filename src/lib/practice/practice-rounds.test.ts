import { describe, expect, it } from "vitest";
import { CORE_METHOD_CATALOG } from "@/lib/learning/method-catalog";
import {
  PRACTICE_ROUND_KINDS,
  PRACTICE_ROUND_LABEL,
  PRACTICE_ROUND_METHOD,
  PRACTICE_ROUND_RULE_ID,
  practiceRoundKind,
} from "./practice-rounds";

// Brief 1.5 item 3: four practice methods, chosen by code.
describe("practice round kinds", () => {
  it("names each round with the brief's label and catalog method", () => {
    expect(PRACTICE_ROUND_LABEL).toEqual({ active_recall: "Active Recall", error_repair: "Error Repair", practice_test: "Practice Test", interleaved_review: "Interleaved Review" });
    expect(PRACTICE_ROUND_METHOD).toEqual({ active_recall: "retrieval_practice", error_repair: "practice_test_error_repair", practice_test: "practice_test_error_repair", interleaved_review: "interleaved_practice" });
    for (const kind of PRACTICE_ROUND_KINDS) expect(CORE_METHOD_CATALOG[PRACTICE_ROUND_METHOD[kind]]).toBeDefined();
  });

  it("round 1 is the route's first practice round; any later round follows a miss and is Error Repair", () => {
    for (const first of ["active_recall", "practice_test", "interleaved_review"] as const) {
      expect(practiceRoundKind(first, 1)).toBe(first);
      expect(practiceRoundKind(first, 2)).toBe("error_repair");
      expect(practiceRoundKind(first, 3)).toBe("error_repair");
    }
  });

  it("every kind records a rule ID", () => {
    for (const kind of PRACTICE_ROUND_KINDS) expect(PRACTICE_ROUND_RULE_ID[kind]).toMatch(/^L4\.practice\./);
  });
});
