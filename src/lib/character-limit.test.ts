import { describe, expect, it } from "vitest";
import {
  formatCharacterLimit,
  getCharacterLimitState,
  LEARNER_TEXT_CHARACTER_LIMIT,
} from "@/lib/character-limit";

describe("learner text character limits", () => {
  it("accepts text at the limit", () => {
    const state = getCharacterLimitState("a".repeat(LEARNER_TEXT_CHARACTER_LIMIT));

    expect(state).toEqual({
      count: 500,
      limit: 500,
      isOverLimit: false,
      charactersOver: 0,
    });
    expect(formatCharacterLimit(state)).toBe("500/500");
  });

  it("reports programmatically supplied text over the limit", () => {
    const state = getCharacterLimitState("a".repeat(700));

    expect(state.isOverLimit).toBe(true);
    expect(state.charactersOver).toBe(200);
    expect(formatCharacterLimit(state)).toBe("700/500 · 200 characters over the limit.");
  });
});
