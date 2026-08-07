import { describe, expect, it } from "vitest";
import { buildSessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";
import { buildFallbackRuntimeRepair } from "@/lib/session-repair/fallback";
import { RuntimeRepairSupportSchema, type RuntimeRepairRequest } from "@/lib/session-repair/schema";

const baseRequest = {
  planId: "10000000-1000-4000-8000-100000000001",
  planSessionId: "10000000-1000-4000-8000-100000000002",
  confidence: "somewhat_sure",
  learnerAnswer: "Only differentiate the first factor.",
  evaluation: {
    feedback: "The answer omits the second product-rule term.",
    matchedIdeas: ["The first factor is differentiated."],
    missingIdeas: ["Both factors contribute one derivative term."],
  },
  activity: {
    title: "Apply the product rule",
    prompt: "Differentiate a product of two functions.",
    concept: "Product rule",
    referenceAnswer: "Differentiate each factor in turn, keep the other unchanged, and add both terms.",
    rubric: "A complete answer contains both derivative terms.",
  },
} satisfies Omit<RuntimeRepairRequest, "deliveryPolicy">;

function policy(supportPreference: string | null) {
  return buildSessionDeliveryPolicy({
    learnerProfile: supportPreference ? { supportPreference } : null,
    recentResults: [],
    recentInterruptions: [],
    learningMode: "study",
    estimatedMinutes: 25,
  });
}

describe("runtime repair fallback", () => {
  it("gives a bounded hint when that is the learner's requested support", () => {
    const repair = buildFallbackRuntimeRepair({
      ...baseRequest,
      deliveryPolicy: policy("Give me a small hint first"),
    });

    expect(repair.mode).toBe("hint_first");
    expect(repair.modeLabel).toBe("One clue first");
    expect(repair.explanation).toContain("Both factors");
    expect(repair.explanation).not.toContain(baseRequest.activity.referenceAnswer);
  });

  it("changes the repair to another example for the same missed concept", () => {
    const repair = buildFallbackRuntimeRepair({
      ...baseRequest,
      deliveryPolicy: policy("Show me a different example"),
    });

    expect(repair.mode).toBe("alternate_example");
    expect(repair.steps.length).toBeGreaterThan(0);
    expect(repair.targetReminder).toContain("underlying Product rule relationship");
  });

  it("treats a confident miss as a possible misconception when no repair preference exists", () => {
    const repair = buildFallbackRuntimeRepair({
      ...baseRequest,
      confidence: "very_sure",
      deliveryPolicy: policy(null),
    });

    expect(repair.mode).toBe("direct_correction");
    expect(repair.personalizationReason).toContain("very sure");
    expect(repair.explanation).toContain(baseRequest.activity.referenceAnswer);
  });

  it("restores smaller steps when the learner says they do not know", () => {
    const repair = buildFallbackRuntimeRepair({
      ...baseRequest,
      confidence: "guessing",
      learnerAnswer: "I do not know this yet.",
      evaluation: null,
      deliveryPolicy: policy(null),
    });

    expect(repair.mode).toBe("smaller_steps");
    expect(repair.steps.length).toBeGreaterThan(0);
    expect(repair.personalizationReason).toContain("uncertain");
  });

  it("keeps fallback support safe for the longest accepted activity fields", () => {
    const repair = buildFallbackRuntimeRepair({
      ...baseRequest,
      confidence: "very_sure",
      activity: {
        ...baseRequest.activity,
        concept: "A detailed concept label ".repeat(8).slice(0, 120),
        referenceAnswer: "A compact answer",
        rubric: "This longer rubric explains the accurate relationship and the evidence required. ".repeat(10).slice(0, 700),
      },
      deliveryPolicy: policy(null),
    });

    expect(RuntimeRepairSupportSchema.safeParse(repair).success).toBe(true);
  });
});
