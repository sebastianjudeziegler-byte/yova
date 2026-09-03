import { describe, expect, it } from "vitest";
import { topicDisplayLabel } from "./topic-display-label";

describe("topicDisplayLabel", () => {
  it("repairs the exact mid-sentence fragment that shipped to production", () => {
    // Seen live on the session-preparation screen, 2026-09-03.
    const raw = "in opposite directions in the two hemispheres, so I can explain the mechanism in plain language.";
    expect(topicDisplayLabel(raw)).toBe("Opposite directions in the two hemispheres");
  });

  it("strips first-person goal scaffolding", () => {
    expect(topicDisplayLabel("I want to explain why sunsets look red.")).toBe("Why sunsets look red");
  });

  it("keeps question topics readable", () => {
    expect(topicDisplayLabel("Why does the sky look blue?")).toBe("Why does the sky look blue?");
  });

  it("caps very long goals at a word boundary", () => {
    const raw = "the complete history of the ottoman empire from its founding through its dissolution after the first world war";
    const label = topicDisplayLabel(raw);
    expect(label.split(/\s+/).length).toBeLessThanOrEqual(10);
    expect(label.endsWith("…")).toBe(true);
  });

  it("falls back when there is nothing usable", () => {
    expect(topicDisplayLabel("   ")).toBe("your goal");
    expect(topicDisplayLabel(null)).toBe("your goal");
    expect(topicDisplayLabel("of.", "this topic")).toBe("this topic");
  });

  it("never returns stray terminal punctuation", () => {
    expect(topicDisplayLabel("Understand the July Crisis!")).toBe("July Crisis");
  });
});
