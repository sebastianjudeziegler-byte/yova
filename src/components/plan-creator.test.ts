import { describe, expect, it } from "vitest";
import {
  durationLabel,
  planCreatorPreviewPreferenceRequestInput,
} from "@/components/plan-creator";

describe("durationLabel", () => {
  it("collapses uniform plan session lengths to one per-session value", () => {
    expect(durationLabel([25, 25, 25, 25, 25], "per-session")).toBe("25 minutes each");
  });

  it("keeps ranged plan session lengths readable", () => {
    expect(durationLabel([40, 25, 30], "per-session")).toBe("25 to 40 minutes each");
  });

  it("preserves the compact schedule-preview format", () => {
    expect(durationLabel([25, 25])).toBe("25 min");
    expect(durationLabel([40, 25])).toBe("25–40 min");
  });
});

describe("PlanCreator development-preview preferences", () => {
  it("sends canonical method preferences only in browser preview mode", () => {
    expect(planCreatorPreviewPreferenceRequestInput(true, [
      "retrieval_practice",
      "self_explanation",
    ])).toEqual({
      previewPreferredMethodIds: ["retrieval_practice", "self_explanation"],
    });
    expect(planCreatorPreviewPreferenceRequestInput(false, [
      "retrieval_practice",
    ])).toEqual({});
    expect(planCreatorPreviewPreferenceRequestInput(true, [])).toEqual({});
  });
});
