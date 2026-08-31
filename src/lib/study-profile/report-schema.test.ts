import { describe, expect, it } from "vitest";
import {
  STUDY_PROFILE_QUESTION_IDS,
  StudyProfileReportSchema,
  buildStudyProfileReport,
  scoreStudyProfile,
  type StudyProfileAnswerId,
  type StudyProfileAnswers,
  type StudyProfileReport,
} from "@/lib/study-profile";

describe("StudyProfileReportSchema", () => {
  it("parses a generated current report without changing its shape", () => {
    const report = generatedReport();
    const parsed: StudyProfileReport = StudyProfileReportSchema.parse(report);

    expect(parsed).toEqual(report);
    expect(parsed.contentVersion).toBe("study_profile_report_v3");
    expect(parsed.overview).toHaveLength(6);
    expect(parsed.methodCatalog).toHaveLength(15);
    expect(parsed.playbook.methods).toHaveLength(3);
  });

  it("rejects a malformed or incomplete overview", () => {
    const report = generatedReport();
    const duplicateDimension = {
      ...report,
      overview: report.overview.map((entry, index) => index === 1
        ? { ...entry, dimension: report.overview[0].dimension }
        : entry),
    };
    const extraOverviewField = {
      ...report,
      overview: report.overview.map((entry, index) => index === 0
        ? { ...entry, privateNote: "must not persist" }
        : entry),
    };

    expect(StudyProfileReportSchema.safeParse(duplicateDimension).success).toBe(false);
    expect(StudyProfileReportSchema.safeParse(extraOverviewField).success).toBe(false);
  });

  it("rejects malformed method catalog entries and duplicate catalog IDs", () => {
    const report = generatedReport();
    const missingSteps = {
      ...report,
      methodCatalog: report.methodCatalog.map((entry, index) => index === 0
        ? { ...entry, steps: [] }
        : entry),
    };
    const duplicateId = {
      ...report,
      methodCatalog: report.methodCatalog.map((entry, index) => index === 1
        ? { ...entry, id: report.methodCatalog[0].id }
        : entry),
    };

    expect(StudyProfileReportSchema.safeParse(missingSteps).success).toBe(false);
    expect(StudyProfileReportSchema.safeParse(duplicateId).success).toBe(false);
  });

  it("rejects malformed and repeated playbook method entries", () => {
    const report = generatedReport();
    const missingMethodSteps = {
      ...report,
      playbook: {
        ...report.playbook,
        methods: report.playbook.methods.map((method, index) => index === 0
          ? { ...method, steps: [] }
          : method),
      },
    };
    const repeatedMethod = {
      ...report,
      playbook: {
        ...report.playbook,
        methods: report.playbook.methods.map((method, index) => index === 1
          ? { ...method, id: report.playbook.methods[0].id }
          : method),
      },
    };

    expect(StudyProfileReportSchema.safeParse(missingMethodSteps).success).toBe(false);
    expect(StudyProfileReportSchema.safeParse(repeatedMethod).success).toBe(false);
  });
});

function generatedReport() {
  const answers = answerEveryQuestion("d");
  return buildStudyProfileReport(scoreStudyProfile(answers), {
    energyWindow: "morning",
    schoolLevel: "college",
    studyGoal: "upcoming_exams",
  }, answers);
}

function answerEveryQuestion(answer: StudyProfileAnswerId): StudyProfileAnswers {
  return Object.fromEntries(STUDY_PROFILE_QUESTION_IDS.map((questionId) => [
    questionId,
    answer,
  ])) as StudyProfileAnswers;
}
