import { describe, expect, it } from "vitest";
import {
  buildConceptReviewSchedule,
  validateConceptReviewSchedule,
} from "@/lib/learning/concept-review-scheduler";
import type { ConceptSignal } from "@/lib/learning/concept-evidence";

function signal(overrides: Partial<ConceptSignal> = {}): ConceptSignal {
  return {
    concept: "Electron transport chain",
    attempts: 1,
    secureAttempts: 0,
    needsReviewAttempts: 1,
    lastOutcome: "needs_review",
    lastObservedAt: "2026-08-05T16:00:00.000Z",
    status: "needs_review",
    ...overrides,
  };
}

describe("buildConceptReviewSchedule", () => {
  const now = new Date("2026-08-06T18:00:00.000Z");

  it("brings a missed concept back after a one-day delay", () => {
    const [review] = buildConceptReviewSchedule([signal()], now);

    expect(review).toMatchObject({
      concept: "Electron transport chain",
      reviewType: "repair_and_retrieve",
      intervalDays: 1,
      timing: "due",
      priority: "high",
    });
    expect(review.reason).toContain("durable knowledge");
  });

  it("verifies a first success before treating it as stable", () => {
    const [review] = buildConceptReviewSchedule([signal({
      concept: "ATP",
      attempts: 1,
      secureAttempts: 1,
      needsReviewAttempts: 0,
      lastOutcome: "secure",
      status: "early_signal",
    })], now);

    expect(review).toMatchObject({
      reviewType: "verify",
      intervalDays: 2,
      timing: "upcoming",
      priority: "medium",
    });
  });

  it("spaces repeated secure evidence farther apart without declaring mastery", () => {
    const [review] = buildConceptReviewSchedule([signal({
      concept: "Glycolysis",
      attempts: 4,
      secureAttempts: 4,
      needsReviewAttempts: 0,
      lastOutcome: "secure",
      status: "showing_strength",
    })], now);

    expect(review).toMatchObject({
      reviewType: "maintenance_transfer",
      intervalDays: 7,
      priority: "low",
    });
    expect(review.reason).toContain("do not prove permanent mastery");
  });

  it("orders due repair before upcoming verification and maintenance", () => {
    const reviews = buildConceptReviewSchedule([
      signal({ concept: "ATP", status: "early_signal", lastOutcome: "secure", secureAttempts: 1, needsReviewAttempts: 0 }),
      signal({ concept: "Glycolysis", status: "showing_strength", lastOutcome: "secure", attempts: 2, secureAttempts: 2, needsReviewAttempts: 0 }),
      signal(),
    ], now);

    expect(reviews.map((review) => review.concept)).toEqual([
      "Electron transport chain",
      "ATP",
      "Glycolysis",
    ]);
  });
});

describe("validateConceptReviewSchedule", () => {
  const schedule = buildConceptReviewSchedule(
    [signal()],
    new Date("2026-08-06T18:00:00.000Z"),
  );

  it("requires a due repair concept in a knowledge check", () => {
    expect(validateConceptReviewSchedule({
      schedule,
      activities: [{ type: "multiple_choice", concept: "ATP" }],
    })).toContain("Electron transport chain");
  });

  it("accepts an exact concept-preserving retrieval check", () => {
    expect(validateConceptReviewSchedule({
      schedule,
      activities: [{ type: "free_response", concept: "electron transport chain" }],
    })).toBeNull();
  });
});
