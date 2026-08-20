import { describe, expect, it } from "vitest";
import {
  boundedMethodWorkProgress,
  methodWorkCheckpointCounts,
} from "@/lib/learning/method-work-progress";

describe("method-work recovery progress", () => {
  it("keeps only checked targets that still belong to the resumed session", () => {
    expect(boundedMethodWorkProgress({
      checkedTopics: ["Redox carriers", "Stale target", "Redox carriers"],
      sourceReviewed: true,
    }, ["Redox carriers", "ATP synthesis"])).toEqual({
      checkedTopics: ["Redox carriers"],
      sourceReviewed: true,
    });
  });

  it("counts checkboxes while reserving an unsaved workpad step", () => {
    expect(methodWorkCheckpointCounts({
      progress: {
        checkedTopics: ["Redox carriers"],
        sourceReviewed: true,
      },
      topics: ["Redox carriers", "ATP synthesis"],
      sourceFirstRequired: true,
    })).toEqual({
      completedSteps: 2,
      totalSteps: 4,
      resumeStep: 2,
    });

    expect(methodWorkCheckpointCounts({
      progress: {
        checkedTopics: ["Redox carriers", "ATP synthesis"],
        sourceReviewed: true,
      },
      topics: ["Redox carriers", "ATP synthesis"],
      sourceFirstRequired: true,
      awaitingFinish: true,
    })).toEqual({
      completedSteps: 4,
      totalSteps: 4,
      resumeStep: 4,
    });
  });
});
