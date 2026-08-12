import { describe, expect, it } from "vitest";
import { sourceActivityIndex } from "@/lib/session-generation/activity-index";

describe("session activity source indices", () => {
  it("keeps the persisted index after a browser-only repair shifts the display step", () => {
    expect(sourceActivityIndex({ sourceActivityIndex: 2 }, 3)).toBe(2);
  });

  it("uses the visible index for a browser-created repair step", () => {
    expect(sourceActivityIndex({}, 3)).toBe(3);
  });
});
