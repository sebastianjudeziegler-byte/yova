import { describe, expect, it } from "vitest";
import {
  readConceptEvidenceProperty,
  summarizeConceptEvidence,
} from "@/lib/learning/concept-evidence";

describe("readConceptEvidenceProperty", () => {
  it("accepts well-formed concept evidence", () => {
    expect(readConceptEvidenceProperty({
      conceptEvidence: [
        {
          concept: "Electron transport chain",
          outcome: "needs_review",
          activityType: "free_response",
          methodPhase: "independent_practice",
        },
      ],
    })).toEqual([
      {
        concept: "Electron transport chain",
        outcome: "needs_review",
        activityType: "free_response",
        methodPhase: "independent_practice",
      },
    ]);
  });

  it("rejects malformed stored data instead of trusting it", () => {
    expect(readConceptEvidenceProperty(null)).toEqual([]);
    expect(readConceptEvidenceProperty({
      conceptEvidence: [
        {
          concept: "ATP",
          outcome: "maybe",
          activityType: "multiple_choice",
        },
      ],
    })).toEqual([]);
  });

  it("drops restored pretest entries before they reach learning-state consumers", () => {
    expect(readConceptEvidenceProperty({
      conceptEvidence: [
        {
          concept: "Electron transport chain",
          outcome: "secure",
          activityType: "multiple_choice",
          methodPhase: "pretest",
        },
        {
          concept: "ATP synthesis",
          outcome: "secure",
          activityType: "free_response",
          methodPhase: "retrieve",
        },
      ],
    })).toEqual([
      expect.objectContaining({ concept: "ATP synthesis", methodPhase: "retrieve" }),
    ]);
  });
});

describe("summarizeConceptEvidence", () => {
  it("preserves the exact route behind the latest concept observation", () => {
    const firstRoute = "11111111-1111-4111-8111-111111111111";
    const latestRoute = "22222222-2222-4222-8222-222222222222";
    const [signal] = summarizeConceptEvidence([
      {
        completedAt: "2026-08-04T16:00:00.000Z",
        conceptEvidence: [{
          routeRevisionId: firstRoute,
          concept: "ATP coupling",
          outcome: "needs_review",
          activityType: "free_response",
        }],
      },
      {
        completedAt: "2026-08-05T16:00:00.000Z",
        conceptEvidence: [{
          routeRevisionId: latestRoute,
          concept: "ATP coupling",
          outcome: "secure",
          activityType: "free_response",
        }],
      },
    ]);

    expect(signal?.lastRouteRevisionId).toBe(latestRoute);
  });

  it("merges capitalization and spacing variants of the same concept", () => {
    const result = summarizeConceptEvidence([
      {
        completedAt: "2026-08-04T16:00:00.000Z",
        conceptEvidence: [
          {
            concept: "Cellular   Respiration",
            outcome: "needs_review",
            activityType: "free_response",
          },
        ],
      },
      {
        completedAt: "2026-08-05T16:00:00.000Z",
        conceptEvidence: [
          {
            concept: "cellular respiration",
            outcome: "secure",
            activityType: "multiple_choice",
          },
        ],
      },
    ]);

    expect(result).toEqual([
      {
        concept: "cellular respiration",
        attempts: 2,
        secureAttempts: 1,
        needsReviewAttempts: 1,
        lastOutcome: "secure",
        lastObservedAt: "2026-08-05T16:00:00.000Z",
        status: "early_signal",
      },
    ]);
  });

  it("requires repeated secure evidence before calling something a strength", () => {
    const result = summarizeConceptEvidence([
      {
        completedAt: "2026-08-04T16:00:00.000Z",
        conceptEvidence: [
          {
            concept: "Glycolysis",
            outcome: "secure",
            activityType: "multiple_choice",
          },
        ],
      },
      {
        completedAt: "2026-08-05T16:00:00.000Z",
        conceptEvidence: [
          {
            concept: "Glycolysis",
            outcome: "secure",
            activityType: "free_response",
          },
        ],
      },
    ]);

    expect(result[0]).toMatchObject({
      concept: "Glycolysis",
      attempts: 2,
      secureAttempts: 2,
      status: "showing_strength",
    });
  });

  it("treats a recent miss as a review need even after earlier success", () => {
    const result = summarizeConceptEvidence([
      {
        completedAt: "2026-08-04T16:00:00.000Z",
        conceptEvidence: [
          {
            concept: "Krebs cycle",
            outcome: "secure",
            activityType: "multiple_choice",
          },
        ],
      },
      {
        completedAt: "2026-08-05T16:00:00.000Z",
        conceptEvidence: [
          {
            concept: "Krebs cycle",
            outcome: "needs_review",
            activityType: "free_response",
          },
        ],
      },
    ]);

    expect(result[0]).toMatchObject({
      lastOutcome: "needs_review",
      status: "needs_review",
    });
  });

  it("puts review needs before early signals and demonstrated strengths", () => {
    const result = summarizeConceptEvidence([
      {
        completedAt: "2026-08-03T16:00:00.000Z",
        conceptEvidence: [
          {
            concept: "ATP",
            outcome: "secure",
            activityType: "multiple_choice",
          },
          {
            concept: "Fermentation",
            outcome: "secure",
            activityType: "multiple_choice",
          },
        ],
      },
      {
        completedAt: "2026-08-04T16:00:00.000Z",
        conceptEvidence: [
          {
            concept: "Fermentation",
            outcome: "secure",
            activityType: "free_response",
          },
        ],
      },
      {
        completedAt: "2026-08-05T16:00:00.000Z",
        conceptEvidence: [
          {
            concept: "Electron transport chain",
            outcome: "needs_review",
            activityType: "free_response",
          },
        ],
      },
    ]);

    expect(result.map(({ concept, status }) => ({ concept, status }))).toEqual([
      { concept: "Electron transport chain", status: "needs_review" },
      { concept: "ATP", status: "early_signal" },
      { concept: "Fermentation", status: "showing_strength" },
    ]);
  });

  it("does not reorder the completion history supplied by the caller", () => {
    const completions = [
      { completedAt: "2026-08-05T16:00:00.000Z", conceptEvidence: [] },
      { completedAt: "2026-08-04T16:00:00.000Z", conceptEvidence: [] },
    ];

    summarizeConceptEvidence(completions);

    expect(completions.map((completion) => completion.completedAt)).toEqual([
      "2026-08-05T16:00:00.000Z",
      "2026-08-04T16:00:00.000Z",
    ]);
  });

  it("ignores pretest history while retaining later evidence for the same concept", () => {
    const result = summarizeConceptEvidence([
      {
        completedAt: "2026-08-04T16:00:00.000Z",
        conceptEvidence: [{
          concept: "Glycolysis",
          outcome: "secure",
          activityType: "multiple_choice",
          methodPhase: "pretest",
        }],
      },
      {
        completedAt: "2026-08-05T16:00:00.000Z",
        conceptEvidence: [{
          concept: "Glycolysis",
          outcome: "needs_review",
          activityType: "free_response",
          methodPhase: "retrieve",
        }],
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        concept: "Glycolysis",
        attempts: 1,
        secureAttempts: 0,
        needsReviewAttempts: 1,
        lastOutcome: "needs_review",
      }),
    ]);
  });
});
