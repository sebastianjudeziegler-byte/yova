import { describe, expect, it } from "vitest";
import {
  DEFAULT_STUDY_PROFILE_SCORING_CONFIG,
  STUDY_PROFILE_QUESTION_IDS,
  classifyStudyProfileScore,
  scoreStudyProfile,
  type StudyProfileAnswerId,
  type StudyProfileAnswers,
  type StudyProfileDimension,
} from "@/lib/study-profile";

describe("Study Profile scoring", () => {
  it("scores each of the six dimensions independently", () => {
    const pairs: Array<[StudyProfileDimension, keyof StudyProfileAnswers, keyof StudyProfileAnswers]> = [
      ["starting_friction", "q1", "q2"],
      ["structure_need", "q3", "q4"],
      ["attention_variability", "q5", "q6"],
      ["calibration_risk", "q7", "q8"],
      ["mistake_sensitivity", "q9", "q10"],
      ["cognitive_stamina", "q11", "q12"],
    ];

    for (const [dimension, first, second] of pairs) {
      const answers = answerEveryQuestion("a");
      answers[first] = "d";
      answers[second] = dimension === "calibration_risk" ? "c" : "d";
      const result = scoreStudyProfile(answers);

      expect(result.rawScores[dimension]).toBe(6);
      for (const otherDimension of pairs.map(([id]) => id).filter((id) => id !== dimension)) {
        expect(result.rawScores[otherDimension]).toBe(0);
      }
    }
  });

  it.each([
    [0, "low"],
    [1, "low"],
    [2, "low"],
    [3, "moderate"],
    [4, "moderate"],
    [5, "high"],
    [6, "high"],
  ] as const)("classifies raw score %i as %s", (rawScore, expected) => {
    expect(classifyStudyProfileScore(rawScore)).toBe(expected);
  });

  it("supports configurable, fully-covered product routing thresholds", () => {
    const thresholds = [
      { classification: "low", min: 0, max: 1 },
      { classification: "moderate", min: 2, max: 3 },
      { classification: "high", min: 4, max: 6 },
    ] as const;

    expect(classifyStudyProfileScore(4, thresholds)).toBe("high");
    expect(() => scoreStudyProfile(answerEveryQuestion("a"), {
      ...DEFAULT_STUDY_PROFILE_SCORING_CONFIG,
      thresholds: [
        { classification: "low", min: 0, max: 2 },
        { classification: "high", min: 2, max: 6 },
      ],
    })).toThrow(/exactly once/);
  });

  it.each([
    ["a", "relatively_calibrated"],
    ["b", "mixed"],
    ["c", "overconfidence_risk"],
    ["d", "underconfidence_risk"],
  ] as const)("routes q8=%s to %s", (answer, expected) => {
    const answers = answerEveryQuestion("a");
    answers.q8 = answer;
    expect(scoreStudyProfile(answers).calibrationDirection).toBe(expected);
  });

  it("routes a strong familiarity illusion toward overconfidence unless underconfidence is explicit", () => {
    const overconfidenceAnswers = answerEveryQuestion("a");
    overconfidenceAnswers.q7 = "d";
    const underconfidenceAnswers = { ...overconfidenceAnswers, q8: "d" as const };

    expect(scoreStudyProfile(overconfidenceAnswers).calibrationDirection).toBe("overconfidence_risk");
    expect(scoreStudyProfile(underconfidenceAnswers).calibrationDirection).toBe("underconfidence_risk");
  });

  it("uses plain-language labels for confidence results", () => {
    const overAnswers = answerEveryQuestion("a");
    overAnswers.q8 = "c";
    const underAnswers = { ...overAnswers, q8: "d" as const };

    expect(scoreStudyProfile(overAnswers).scores.calibration_risk.userFacingLabel)
      .toBe("Test yourself sooner");
    expect(scoreStudyProfile(underAnswers).scores.calibration_risk.userFacingLabel)
      .toBe("Trust correct results more");
  });

  it("selects high signals ahead of lower signals", () => {
    const answers = answerEveryQuestion("a");
    answers.q5 = "d";
    answers.q6 = "d";
    answers.q9 = "d";
    answers.q10 = "c";

    const result = scoreStudyProfile(answers);

    expect(result.primaryPattern.dimension).toBe("attention_variability");
    expect(result.secondaryPattern.dimension).toBe("mistake_sensitivity");
  });

  it("uses stable salience order for true ties", () => {
    const result = scoreStudyProfile(answerEveryQuestion("a"));

    expect(result.primaryPattern.dimension).toBe("calibration_risk");
    expect(result.secondaryPattern.dimension).toBe("starting_friction");
    expect(result.isBalanced).toBe(true);
    expect(result.lowSignal).toBe(true);
  });

  it("ranks a higher mean severity first even inside the same routing band", () => {
    const answers = answerEveryQuestion("a");
    answers.q1 = "d";
    answers.q2 = "c"; // starting = 5
    answers.q3 = "d";
    answers.q4 = "d"; // structure = 6

    const result = scoreStudyProfile(answers);

    expect(result.primaryPattern.dimension).toBe("structure_need");
    expect(result.secondaryPattern.dimension).toBe("starting_friction");
    expect(result.scores.structure_need.meanSeverity).toBe(3);
    expect(result.scores.starting_friction.meanSeverity).toBe(2.5);
  });

  it("uses the worst individual answer after equal mean severity", () => {
    const answers = answerEveryQuestion("a");
    answers.q1 = "d"; // starting = 3, worst = 3
    answers.q3 = "c";
    answers.q4 = "b"; // structure = 3, worst = 2

    const result = scoreStudyProfile(answers);

    expect(result.primaryPattern.dimension).toBe("starting_friction");
    expect(result.secondaryPattern.dimension).toBe("structure_need");
  });

  it("does not diagnose evidence-based teach-back as a familiarity problem", () => {
    const answers = answerEveryQuestion("a");
    answers.q7 = "c";
    answers.q8 = "b";

    const result = scoreStudyProfile(answers);

    expect(result.rawScores.calibration_risk).toBe(2);
    expect(result.classifications.calibration_risk).toBe("low");
    expect(result.isBalanced).toBe(true);
  });

  it("does not treat a short checklist or planned reset as study friction", () => {
    const answers = answerEveryQuestion("a");
    answers.q3 = "b";
    answers.q6 = "b";

    const result = scoreStudyProfile(answers);

    expect(result.rawScores.structure_need).toBe(0);
    expect(result.rawScores.attention_variability).toBe(0);
  });

  it("uses impact order only after severity and worst answer are tied", () => {
    const answers = answerEveryQuestion("a");
    answers.q1 = "d";
    answers.q8 = "c";

    const result = scoreStudyProfile(answers);

    expect(result.primaryPattern.dimension).toBe("calibration_risk");
    expect(result.secondaryPattern.dimension).toBe("starting_friction");
  });

  it("marks the profile balanced only when no dimension reaches raw score 3", () => {
    const belowThreshold = scoreStudyProfile(answerEveryQuestion("b"));
    const atThresholdAnswers = answerEveryQuestion("a");
    atThresholdAnswers.q1 = "c";
    atThresholdAnswers.q2 = "b";
    const atThreshold = scoreStudyProfile(atThresholdAnswers);

    expect(belowThreshold.isBalanced).toBe(true);
    expect(belowThreshold.lowSignal).toBe(false);
    expect(atThreshold.rawScores.starting_friction).toBe(3);
    expect(atThreshold.isBalanced).toBe(false);
  });

  it("accepts every answer option for every question in a complete quiz", () => {
    for (const questionId of STUDY_PROFILE_QUESTION_IDS) {
      for (const option of ["a", "b", "c", "d"] as const) {
        const answers = answerEveryQuestion("a");
        answers[questionId] = option;
        expect(() => scoreStudyProfile(answers)).not.toThrow();
      }
    }
  });
});

function answerEveryQuestion(answer: StudyProfileAnswerId): StudyProfileAnswers {
  return Object.fromEntries(STUDY_PROFILE_QUESTION_IDS.map((questionId) => [
    questionId,
    answer,
  ])) as StudyProfileAnswers;
}
