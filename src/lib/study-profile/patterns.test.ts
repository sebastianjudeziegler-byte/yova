import { describe, expect, it } from "vitest";
import {
  STUDY_PROFILE_QUESTION_IDS,
  STUDY_PROFILE_DIMENSIONS,
  buildStudyProfileFreeInsight,
  buildStudyProfileWhySection,
  resolveStudyProfileNamedPattern,
  resolveStudyProfileSubtype,
  scoreStudyProfile,
  type StudyProfileAnswerId,
  type StudyProfileAnswers,
  type StudyProfileDimension,
  type StudyProfileSnapshot,
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
      .toBe("Paired with The Drifter");
  });

  it("turns an eligible secondary pattern into a practical subtype", () => {
    const profile = profileWithPair("starting_friction", "structure_need");

    expect(resolveStudyProfileSubtype(profile)).toEqual({
      pairedPattern: {
        id: "scattershot",
        name: "The Scattershot",
        dimension: "structure_need",
      },
      heading: "A clear first move makes starting easier.",
      body: expect.stringContaining("short sequence"),
      highestLeverageMove: "Write the first three actions before you sit down.",
    });
  });

  it("does not create a subtype for a balanced profile or a low secondary classification", () => {
    const balanced = scoreStudyProfile(answerEveryQuestion("b"));
    const lowSecondary = profileWithPair("starting_friction", "structure_need", 2);

    expect(resolveStudyProfileSubtype(balanced)).toBeNull();
    expect(resolveStudyProfileSubtype(lowSecondary)).toBeNull();
  });

  it("uses the scored classification rather than a hard-coded raw threshold", () => {
    const profile = profileWithPair("starting_friction", "structure_need", 2);
    profile.secondaryPattern.classification = "moderate";

    expect(resolveStudyProfileSubtype(profile)).not.toBeNull();
    expect(resolveStudyProfileNamedPattern(profile).modifier)
      .toBe("Paired with The Scattershot");
  });

  it("resolves all 15 dimension pairs with the same interaction copy in either order", () => {
    const pairs = STUDY_PROFILE_DIMENSIONS.flatMap((first, firstIndex) =>
      STUDY_PROFILE_DIMENSIONS.slice(firstIndex + 1).map((second) => [first, second] as const));

    expect(pairs).toHaveLength(15);
    for (const [first, second] of pairs) {
      const forward = resolveStudyProfileSubtype(profileWithPair(first, second));
      const reverse = resolveStudyProfileSubtype(profileWithPair(second, first));

      expect(forward).not.toBeNull();
      expect(reverse).not.toBeNull();
      expect({
        heading: forward?.heading,
        body: forward?.body,
        highestLeverageMove: forward?.highestLeverageMove,
      }).toEqual({
        heading: reverse?.heading,
        body: reverse?.body,
        highestLeverageMove: reverse?.highestLeverageMove,
      });
    }
  });

  it("uses the confidence-building calibration subtype for underconfidence", () => {
    const profile = profileWithPair("starting_friction", "calibration_risk");
    profile.calibrationDirection = "underconfidence_risk";

    expect(resolveStudyProfileSubtype(profile)).toMatchObject({
      pairedPattern: { id: "evidence_doubter" },
      heading: "Let a quick start build confidence.",
      highestLeverageMove: expect.stringMatching(/record what you answered correctly/i),
    });
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

function profileWithPair(
  primary: StudyProfileDimension,
  secondary: StudyProfileDimension,
  secondaryRawScore = 6,
): StudyProfileSnapshot {
  const base = scoreStudyProfile(answerEveryQuestion("d"));
  return {
    ...base,
    isBalanced: false,
    primaryPattern: {
      ...base.scores[primary],
      dimension: primary,
      rawScore: 6,
      classification: "high",
    },
    secondaryPattern: {
      ...base.scores[secondary],
      dimension: secondary,
      rawScore: secondaryRawScore,
      classification: secondaryRawScore >= 3 ? "moderate" : "low",
    },
  };
}
