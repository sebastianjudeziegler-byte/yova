import { describe, expect, it } from "vitest";
import {
  STUDY_PROFILE_MODEL_VERSION,
  STUDY_PROFILE_DIMENSION_CONTENT,
  STUDY_PROFILE_DIMENSIONS,
  STUDY_PROFILE_QUESTION_IDS,
  StudyProfileAnswersSchema,
  StudyProfileReportTokenSchema,
  StudyProfileStoredResponseSchema,
  StudyProfileSubmissionSchema,
  StudyProfileWaitlistUpdateSchema,
  buildStudyProfileReport,
  buildStudyProfileReportFromStoredResponse,
  scoreStudyProfile,
  toStudyProfilePublicStoredResponse,
  type StudyProfileAnswerId,
  type StudyProfileAnswers,
} from "@/lib/study-profile";

describe("Study Profile validation and report assembly", () => {
  it("provides a complete low, moderate, and high content module for every dimension", () => {
    for (const dimension of STUDY_PROFILE_DIMENSIONS) {
      const content = STUDY_PROFILE_DIMENSION_CONTENT[dimension];
      expect(content.name).not.toBe("");
      expect(Object.keys(content.levels)).toEqual(["low", "moderate", "high"]);
      for (const level of Object.values(content.levels)) {
        expect(level.summary.length).toBeGreaterThan(30);
        expect(level.detail.length).toBeGreaterThan(50);
      }
    }
  });

  it("builds all report sections from a deterministic profile", () => {
    const answers = answerEveryQuestion("d");
    const profile = scoreStudyProfile(answers);
    const report = buildStudyProfileReport(profile, {
      energyWindow: "morning",
      schoolLevel: "college",
    });

    expect(report.overview).toHaveLength(6);
    expect(report.sectionHeadings.overview).toBe("Your initial YOVA Study Profile");
    expect(report.primaryPattern.dimension).toBe(profile.primaryPattern.dimension);
    expect(report.recommendations.map(({ category }) => category)).toEqual([
      "starting",
      "structure",
      "focus",
      "checking_what_you_know",
      "handling_mistakes",
      "session_length_energy",
    ]);
    expect(report.warnings).toHaveLength(3);
    expect(report.protocol.steps.length).toBeGreaterThanOrEqual(3);
    expect(report.productAdaptations).toHaveLength(6);
    expect(report.firstImpression.examplesLabel).toMatch(/not claims about you/i);
    expect(report.methodology.body).toMatch(/not a medical, neurological, or psychological diagnosis/i);
    expect(report.recommendations.at(-1)?.actions.at(-1)).toMatch(/morning window/i);
  });

  it("rebuilds the same report from a validated stored response without an email", () => {
    const answers = answerEveryQuestion("b");
    const snapshot = scoreStudyProfile(answers);
    const stored = StudyProfileStoredResponseSchema.parse({
      id: "32d68d20-18a5-4a90-9d72-1f3902455e68",
      reportToken: "abcdef0123456789abcdef0123456789",
      profileModelVersion: STUDY_PROFILE_MODEL_VERSION,
      rawAnswers: answers,
      snapshot,
      metadata: {
        energyWindow: "varies",
        schoolLevel: "high_school",
        hardestPart: null,
      },
      createdAt: "2026-08-11T12:00:00.000Z",
    });

    expect("email" in stored).toBe(false);
    expect(buildStudyProfileReportFromStoredResponse(stored))
      .toEqual(buildStudyProfileReport(snapshot, stored.metadata));

    const publicResponse = toStudyProfilePublicStoredResponse(stored);
    expect(publicResponse).toEqual({
      id: stored.id,
      responseId: stored.responseId,
      profileModelVersion: STUDY_PROFILE_MODEL_VERSION,
      metadata: {
        energyWindow: "varies",
        schoolLevel: "high_school",
      },
      createdAt: stored.createdAt,
    });
    expect("rawAnswers" in publicResponse).toBe(false);
    expect("hardestPart" in publicResponse.metadata).toBe(false);
    expect("reportToken" in publicResponse).toBe(false);
  });

  it("normalizes email and sanitizes the optional free response", () => {
    const parsed = StudyProfileSubmissionSchema.parse({
      email: "  Student@Example.COM ",
      answers: answerEveryQuestion("a"),
      metadata: {
        energyWindow: "evening",
        schoolLevel: "other",
        hardestPart: "  <script>  getting   started </script> ",
      },
      marketingConsent: false,
    });

    expect(parsed.email).toBe("student@example.com");
    expect(parsed.metadata.hardestPart).toBe("getting started");
  });

  it("rejects incomplete answers and invalid report tokens", () => {
    const incomplete = Object.fromEntries(
      Object.entries(answerEveryQuestion("a")).filter(([questionId]) => questionId !== "q12"),
    );

    expect(StudyProfileAnswersSchema.safeParse(incomplete).success).toBe(false);
    expect(StudyProfileReportTokenSchema.safeParse("short").success).toBe(false);
    expect(StudyProfileReportTokenSchema.safeParse("a".repeat(32)).success).toBe(true);
  });

  it("validates a waitlist update without asking for email again", () => {
    const parsed = StudyProfileWaitlistUpdateSchema.parse({
      reportToken: "abcdef0123456789abcdef0123456789",
      waitlist: true,
      betaInterest: true,
    });

    expect(parsed).toEqual({
      reportToken: "abcdef0123456789abcdef0123456789",
      waitlist: true,
      betaInterest: true,
    });
    expect("email" in parsed).toBe(false);
  });
});

function answerEveryQuestion(answer: StudyProfileAnswerId): StudyProfileAnswers {
  return Object.fromEntries(STUDY_PROFILE_QUESTION_IDS.map((questionId) => [
    questionId,
    answer,
  ])) as StudyProfileAnswers;
}
