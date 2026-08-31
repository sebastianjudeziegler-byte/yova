import { describe, expect, it } from "vitest";
import {
  STUDY_PROFILE_QUESTION_IDS,
  buildStudyProfileFreeInsight,
  buildStudyProfileWhySection,
  resolveStudyProfileNamedPattern,
  scoreStudyProfile,
  type StudyProfileAnswerId,
  type StudyProfileAnswers,
} from "@/lib/study-profile";

describe("Study Profile named patterns", () => {
  it("maps each primary dimension to a memorable learner-facing pattern", () => {
    const answers = answerEveryQuestion("a");
    answers.q1 = "d";
    answers.q2 = "d";

    expect(resolveStudyProfileNamedPattern(scoreStudyProfile(answers))).toMatchObject({
      id: "stalled_starter",
      name: "The Stalled Starter",
      dimension: "starting_friction",
    });
  });

  it("uses a warm non-familiarity name for underconfidence", () => {
    const answers = answerEveryQuestion("a");
    answers.q8 = "d";

    expect(resolveStudyProfileNamedPattern(scoreStudyProfile(answers))).toMatchObject({
      id: "evidence_doubter",
      name: "The Evidence Doubter",
      dimension: "calibration_risk",
    });
  });

  it("uses the All-Rounder only when every dimension stays below raw score 3", () => {
    const profile = scoreStudyProfile(answerEveryQuestion("b"));

    expect(profile.isBalanced).toBe(true);
    expect(resolveStudyProfileNamedPattern(profile)).toMatchObject({
      id: "all_rounder",
      name: "The All-Rounder",
      dimension: null,
      modifier: null,
    });
  });

  it("adds one secondary modifier only when it reaches the opportunity threshold", () => {
    const answers = answerEveryQuestion("a");
    answers.q1 = "d";
    answers.q2 = "d";
    answers.q5 = "d";
    answers.q6 = "d";

    expect(resolveStudyProfileNamedPattern(scoreStudyProfile(answers)).modifier)
      .toBe("Also showing: The Drifter");
  });

  it("grounds the free insight and why section in the learner's answers and goal", () => {
    const answers = answerEveryQuestion("a");
    answers.q1 = "d";
    answers.q2 = "c";
    const profile = scoreStudyProfile(answers);

    const insight = buildStudyProfileFreeInsight(profile, answers);
    const why = buildStudyProfileWhySection(profile, answers, "upcoming_exams");

    expect(insight.body).toContain("pressure forces me");
    expect(insight.body).toContain("feel more prepared");
    expect(why.body).toContain("exams coming up");
    expect(`${insight.heading} ${insight.body} ${why.heading} ${why.body}`)
      .not.toMatch(/[—–]/);
  });
});

function answerEveryQuestion(answer: StudyProfileAnswerId): StudyProfileAnswers {
  return Object.fromEntries(STUDY_PROFILE_QUESTION_IDS.map((questionId) => [
    questionId,
    answer,
  ])) as StudyProfileAnswers;
}
