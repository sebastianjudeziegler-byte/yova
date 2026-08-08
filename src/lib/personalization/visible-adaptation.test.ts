import { describe, expect, it } from "vitest";
import { buildSessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";
import { validateVisibleAdaptation } from "@/lib/personalization/visible-adaptation";

describe("visible session adaptation", () => {
  const policy = buildSessionDeliveryPolicy({
    learnerProfile: {
      processingPreference: "Start with the big picture",
      memoryChallenge: "I forget it after a few days",
      supportPreference: "Give me a small hint first",
      workspacePreference: "Show one step at a time",
    },
    recentResults: [],
    recentInterruptions: [],
    learningMode: "learn",
    estimatedMinutes: 25,
  });

  it("accepts explanations grounded in policy reasons", () => {
    expect(validateVisibleAdaptation([
      "You asked for the big picture first, so YOVA will establish the overall model before the details.",
      "You report forgetting after a few days, so YOVA will schedule a delayed retrieval instead of more rereading.",
    ], policy)).toBeNull();
  });

  it("rejects unsupported personality theater", () => {
    expect(validateVisibleAdaptation([
      "Your unique brain thrives on colorful diagrams and intense challenges.",
    ], policy)).toContain("not traceable");
  });
});
