import { describe, expect, it } from "vitest";
import {
  hasClarificationSuggestion,
  toggleClarificationSuggestion,
} from "@/components/goal-clarification";

describe("goal clarification suggestions", () => {
  it("accumulates multiple topic chips as comma-separated detail", () => {
    const withProductRule = toggleClarificationSuggestion("", "Product rule");
    const withBothTopics = toggleClarificationSuggestion(withProductRule, "Chain rule");

    expect(withBothTopics).toBe("Product rule, Chain rule");
    expect(hasClarificationSuggestion(withBothTopics, "Product rule")).toBe(true);
    expect(hasClarificationSuggestion(withBothTopics, "Chain rule")).toBe(true);
  });

  it("removes a selected topic when its chip is clicked again", () => {
    expect(
      toggleClarificationSuggestion("Product rule, Chain rule", "Product rule"),
    ).toBe("Chain rule");
  });

  it("deduplicates selections case-insensitively while preserving typed entries", () => {
    expect(
      toggleClarificationSuggestion("Focus on worked examples, product RULE", "Product rule"),
    ).toBe("Focus on worked examples");
    expect(
      toggleClarificationSuggestion("Focus on worked examples", "Product rule"),
    ).toBe("Focus on worked examples, Product rule");
  });
});
