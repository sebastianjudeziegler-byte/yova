import { describe, expect, it } from "vitest";
import {
  alignDueReviewConcept,
  buildConceptReviewSchedule,
  conceptSignalsForSession,
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

  it("carries the latest evidence route into the scheduled review directive", () => {
    const routeRevisionId = "11111111-1111-4111-8111-111111111111";
    const [review] = buildConceptReviewSchedule([
      signal({ lastRouteRevisionId: routeRevisionId }),
    ], now);

    expect(review.originRouteRevisionId).toBe(routeRevisionId);
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

describe("conceptSignalsForSession", () => {
  const currentTopicId = "11111111-1111-4111-8111-111111111111";
  const otherTopicId = "22222222-2222-4222-8222-222222222222";

  it("keeps mapped evidence inside the current topic boundary", () => {
    const scoped = conceptSignalsForSession({
      signals: [
        signal({ topicId: currentTopicId, concept: "Electron transport chain" }),
        signal({ topicId: otherTopicId, concept: "Managerial accounting" }),
      ],
      topicIds: [currentTopicId],
      scopeText: ["Explain the electron transport chain stages and outputs."],
    });

    expect(scoped.map((entry) => entry.concept)).toEqual(["Electron transport chain"]);
  });

  it("leaves a same-topic concept outside today's slice in the separate review queue", () => {
    const scoped = conceptSignalsForSession({
      signals: [signal({ topicId: currentTopicId, concept: "Electron transport chain" })],
      topicIds: [currentTopicId],
      scopeText: ["Compare glycolysis inputs and outputs."],
    });

    expect(scoped).toEqual([]);
  });

  it("admits legacy unscoped evidence only when the complete concept is named today", () => {
    const scoped = conceptSignalsForSession({
      signals: [
        signal({ concept: "Electron transport chain" }),
        signal({ concept: "Managerial accounting" }),
      ],
      topicIds: [currentTopicId],
      scopeText: ["Compare glycolysis with the electron transport chain."],
    });

    expect(scoped.map((entry) => entry.concept)).toEqual(["Electron transport chain"]);
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

  it("also requires due verification after an earlier secure check", () => {
    const verificationSchedule = buildConceptReviewSchedule(
      [signal({
        concept: "ATP",
        status: "early_signal",
        lastOutcome: "secure",
        secureAttempts: 1,
        needsReviewAttempts: 0,
      })],
      new Date("2026-08-08T18:00:00.000Z"),
    );

    expect(validateConceptReviewSchedule({
      schedule: verificationSchedule,
      activities: [{ type: "multiple_choice", concept: "Glycolysis" }],
    })).toContain("ATP");
  });
});

describe("alignDueReviewConcept", () => {
  const schedule = buildConceptReviewSchedule(
    [signal({ concept: "Quotient rule" })],
    new Date("2026-08-08T18:00:00.000Z"),
  );

  it("preserves the stable due concept when one check clearly uses it", () => {
    const activities = alignDueReviewConcept([
      {
        type: "free_response",
        concept: "Quotient formula",
        requiredForCompletion: true,
        title: "Apply the quotient rule",
        body: "Differentiate the quotient and keep the denominator squared.",
      },
      {
        type: "multiple_choice",
        concept: "Product rule",
        requiredForCompletion: true,
        title: "Choose the product rule setup",
        body: "Which setup is correct?",
      },
    ], schedule);

    expect(activities[0]?.concept).toBe("Quotient rule");
    expect(activities[1]?.concept).toBe("Product rule");
  });

  it("does not relabel ambiguous or unrelated checks", () => {
    const ambiguous = alignDueReviewConcept([
      {
        type: "multiple_choice",
        concept: "Formula choice one",
        requiredForCompletion: true,
        title: "Choose a quotient rule formula",
      },
      {
        type: "free_response",
        concept: "Formula choice two",
        requiredForCompletion: true,
        title: "Explain the quotient rule formula",
      },
    ], schedule);
    const unrelated = alignDueReviewConcept([
      {
        type: "free_response",
        concept: "Chain rule",
        requiredForCompletion: true,
        title: "Apply the chain rule",
      },
    ], schedule);

    expect(ambiguous.map((activity) => activity.concept)).toEqual(["Formula choice one", "Formula choice two"]);
    expect(unrelated[0]?.concept).toBe("Chain rule");
  });
});
