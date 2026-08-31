import { describe, expect, it } from "vitest";
import {
  STUDY_PROFILE_MODEL_VERSION,
  STUDY_PROFILE_LEGACY_SCORING_REVISION,
  STUDY_PROFILE_SCORING_REVISION,
  STUDY_PROFILE_DIMENSION_CONTENT,
  STUDY_PROFILE_DIMENSIONS,
  STUDY_PROFILE_QUESTION_IDS,
  StudyProfileAnswersSchema,
  StudyProfileReportTokenSchema,
  StudyProfileSnapshotSchema,
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
    }, answers);

    expect(report.overview).toHaveLength(6);
    expect(report.scoringRevision).toBe(STUDY_PROFILE_SCORING_REVISION);
    expect(report.contentVersion).toBe("study_profile_report_v3");
    expect(report.pattern).toMatchObject({
      id: "evidence_doubter",
      name: "The Evidence Doubter",
      dimension: "calibration_risk",
    });
    expect(report.profileNarrative.heading).toBe("The Evidence Doubter");
    expect(report.freeInsight.body).toMatch(/confidence|results|chose/i);
    expect(report.whyThisIsHappening.body).toMatch(/best place to start/i);
    expect(report.sectionHeadings.overview).toBe("What your answers show");
    expect(report.primaryPattern.dimension).toBe(profile.primaryPattern.dimension);
    expect(report.playbook.methods).toHaveLength(3);
    expect(new Set(report.playbook.methods.map(({ id }) => id)).size).toBe(3);
    expect(report.playbook.methods[0]).toMatchObject({
      name: "Active Recall",
      basedOn: ["calibration_risk"],
      fit: "strong_fit",
    });
    expect(report.playbook.methods[0].steps.length).toBeGreaterThanOrEqual(3);
    expect(report.playbook.methods[0].example).toMatch(/tonight version/i);
    expect(report.playbook.methods[0].timeCost).toMatch(/minute/i);
    expect(report.methodCatalog).toHaveLength(15);
    expect(report.methodCatalog.every(({ fitLabel }) => fitLabel.length > 0)).toBe(true);
    expect(report.playbook.nextSession.bestTime).toMatch(/morning/i);
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
    expect(report.firstImpression.examplesLabel).toMatch(/compare over time/i);
    expect(report.methodology.body).toMatch(/not a medical, neurological, psychological/i);
    expect(report.recommendations.at(-1)?.actions.at(-1)).toMatch(/morning window/i);
    expect(JSON.stringify(report)).not.toMatch(/[—–]/);
    expect(new TextEncoder().encode(JSON.stringify(report)).byteLength).toBeLessThan(65_536);
  });

  it("changes the plan and method explanation when the answers change", () => {
    const lowAnswers = answerEveryQuestion("a");
    const highAnswers = answerEveryQuestion("d");
    const lowReport = buildStudyProfileReport(scoreStudyProfile(lowAnswers), {
      energyWindow: "varies",
      schoolLevel: "high_school",
    }, lowAnswers);
    const highReport = buildStudyProfileReport(scoreStudyProfile(highAnswers), {
      energyWindow: "evening",
      schoolLevel: "college",
    }, highAnswers);

    expect(lowReport.playbook.nextSession.workMinutes).toBeGreaterThan(
      highReport.playbook.nextSession.workMinutes,
    );
    expect(lowReport.playbook.nextSession.setupSteps.join(" ")).toMatch(/skip a long setup/i);
    expect(highReport.playbook.nextSession.setupSteps.join(" ")).toMatch(/three steps/i);
    expect(lowReport.playbook.methods.map(({ id }) => id))
      .not.toEqual(highReport.playbook.methods.map(({ id }) => id));
    expect(lowReport.pattern.id).toBe("all_rounder");
    expect(highReport.pattern.id).toBe("evidence_doubter");
    expect(lowReport.playbook.methods[0].tonightVersion).not.toBe("");
    expect(highReport.playbook.methods[0].tonightVersion).not.toBe("");
  });

  it("uses the study goal to change method order, examples, and the first session step", () => {
    const answers = {
      ...answerEveryQuestion("a"),
      q3: "d",
      q4: "d",
    } as StudyProfileAnswers;
    const profile = scoreStudyProfile(answers);
    const examReport = buildStudyProfileReport(profile, {
      energyWindow: "evening",
      schoolLevel: "college",
      studyGoal: "upcoming_exams",
    }, answers);
    const courseworkReport = buildStudyProfileReport(profile, {
      energyWindow: "evening",
      schoolLevel: "college",
      studyGoal: "keeping_up",
    }, answers);

    expect(examReport.pattern.id).toBe("scattershot");
    expect(examReport.playbook.methods[0].id).toBe("spaced_practice");
    expect(courseworkReport.playbook.methods[0].id).toBe("weekly_review");
    expect(examReport.playbook.nextSession.setupSteps[0]).toMatch(/exam that comes first/i);
    expect(courseworkReport.playbook.nextSession.setupSteps[0]).toMatch(/lecture objective/i);
    expect(examReport.playbook.methods[0].tonightVersion).toMatch(/exam that comes first/i);
    expect(courseworkReport.playbook.methods[0].tonightVersion).toMatch(/most recent lecture/i);
  });

  it("uses different knowledge checks for overconfidence and underconfidence answers", () => {
    const overAnswers = { ...answerEveryQuestion("a"), q7: "d", q8: "c" } as StudyProfileAnswers;
    const underAnswers = { ...answerEveryQuestion("a"), q8: "d" } as StudyProfileAnswers;
    const metadata = { energyWindow: "morning", schoolLevel: "college" } as const;
    const overReport = buildStudyProfileReport(
      scoreStudyProfile(overAnswers),
      metadata,
      overAnswers,
    );
    const underReport = buildStudyProfileReport(
      scoreStudyProfile(underAnswers),
      metadata,
      underAnswers,
    );

    expect(overReport.pattern.id).toBe("familiarity_trap");
    expect(overReport.playbook.nextSession.checkingRule).toMatch(/predict your score/i);
    expect(underReport.pattern.id).toBe("evidence_doubter");
    expect(underReport.pattern.name).not.toMatch(/familiarity/i);
    expect(underReport.playbook.nextSession.checkingRule).toMatch(/record correct/i);
  });

  it("keeps profile_model_v1 snapshots readable when optional v3 fields are absent", () => {
    const current = scoreStudyProfile(answerEveryQuestion("b"));
    const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    delete legacy.lowSignal;
    delete legacy.scoringRevision;
    const scores = legacy.scores as Record<string, Record<string, unknown>>;
    for (const score of Object.values(scores)) delete score.meanSeverity;

    const parsed = StudyProfileSnapshotSchema.parse(legacy);
    const stored = StudyProfileStoredResponseSchema.parse({
      id: "086f5df6-73c5-4ea1-8531-56893d2af40d",
      reportToken: "legacy0123456789legacy0123456789",
      profileModelVersion: STUDY_PROFILE_MODEL_VERSION,
      rawAnswers: answerEveryQuestion("b"),
      snapshot: legacy,
      metadata: {
        energyWindow: "varies",
        schoolLevel: "college",
        hardestPart: null,
      },
      createdAt: "2026-08-12T08:30:00+00:00",
    });
    const report = buildStudyProfileReportFromStoredResponse(stored);

    expect(parsed.modelVersion).toBe("profile_model_v1");
    expect(stored.metadata.studyGoal).toBeUndefined();
    expect(report.contentVersion).toBe("study_profile_report_v3");
    expect(report.scoringRevision).toBe(STUDY_PROFILE_LEGACY_SCORING_REVISION);
    expect(report.pattern.id).toBe("all_rounder");
    expect(report.whyThisIsHappening.body).not.toContain("You chose");
  });

  it("rebuilds the same report from a PostgreSQL timestamp without exposing private data", () => {
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
        studyGoal: "better_habits",
        hardestPart: null,
      },
      createdAt: "2026-08-11T12:00:00.123456+00:00",
    });

    expect("email" in stored).toBe(false);
    expect(buildStudyProfileReportFromStoredResponse(stored))
      .toEqual(buildStudyProfileReport(snapshot, stored.metadata, answers));

    const publicResponse = toStudyProfilePublicStoredResponse(stored);
    expect(publicResponse).toEqual({
      id: stored.id,
      responseId: stored.responseId,
      profileModelVersion: STUDY_PROFILE_MODEL_VERSION,
      metadata: {
        energyWindow: "varies",
        schoolLevel: "high_school",
        studyGoal: "better_habits",
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
    });

    expect(parsed).toEqual({
      reportToken: "abcdef0123456789abcdef0123456789",
      waitlist: true,
    });
    expect(StudyProfileWaitlistUpdateSchema.safeParse({
      reportToken: "abcdef0123456789abcdef0123456789",
      waitlist: true,
      betaInterest: true,
    }).success).toBe(false);
    expect("email" in parsed).toBe(false);
  });
});

function answerEveryQuestion(answer: StudyProfileAnswerId): StudyProfileAnswers {
  return Object.fromEntries(STUDY_PROFILE_QUESTION_IDS.map((questionId) => [
    questionId,
    answer,
  ])) as StudyProfileAnswers;
}
