import { describe, expect, it } from "vitest";
import {
  STUDY_PROFILE_QUESTION_IDS,
  scoreStudyProfile,
  selectStudyProfileInteractions,
  type StudyProfileAnswerId,
  type StudyProfileAnswers,
  type StudyProfileQuestionId,
} from "@/lib/study-profile";

describe("Study Profile interaction routing", () => {
  it.each([
    ["friction_structure", { q1: "d", q2: "d", q3: "d", q4: "d" }],
    ["friction_mistakes", { q1: "d", q2: "d", q9: "d", q10: "d" }],
    ["friction_attention", { q1: "d", q2: "d", q5: "d", q6: "d" }],
    ["structure_attention", { q3: "d", q4: "d", q5: "d", q6: "d" }],
    ["mistakes_overconfidence", { q8: "c", q9: "d", q10: "d" }],
    ["mistakes_underconfidence", { q8: "d", q9: "d", q10: "d" }],
    ["overconfidence_low_friction", { q8: "c" }],
    ["stamina_attention", { q5: "d", q6: "d", q11: "d", q12: "d" }],
    ["structure_stamina", { q3: "d", q4: "d", q11: "d", q12: "d" }],
  ] as const)("selects %s when its conditions are present", (expectedId, overrides) => {
    const profile = scoreStudyProfile(withAnswers(overrides));
    expect(selectStudyProfileInteractions(profile).map(({ id }) => id)).toContain(expectedId);
  });

  it("selects the autonomy rule for low starting friction and low structure need", () => {
    const profile = scoreStudyProfile(answerEveryQuestion("a"));
    const interactions = selectStudyProfileInteractions(profile);

    expect(interactions.map(({ id }) => id)).toContain("autonomy_low_friction_structure");
    expect(interactions.find(({ id }) => id === "autonomy_low_friction_structure")?.actions)
      .toContain("Use broad goals instead of a detailed checklist.");
  });

  it("orders simultaneous interactions by deterministic priority", () => {
    const profile = scoreStudyProfile(answerEveryQuestion("d"));
    const interactions = selectStudyProfileInteractions(profile);

    expect(interactions[0].id).toBe("friction_structure");
    expect(interactions.map(({ id }) => id)).toEqual([
      "friction_structure",
      "friction_mistakes",
      "friction_attention",
      "structure_attention",
      "mistakes_underconfidence",
      "stamina_attention",
      "structure_stamina",
    ]);
  });
});

function withAnswers(overrides: Partial<Record<StudyProfileQuestionId, StudyProfileAnswerId>>) {
  return { ...answerEveryQuestion("a"), ...overrides };
}

function answerEveryQuestion(answer: StudyProfileAnswerId): StudyProfileAnswers {
  return Object.fromEntries(STUDY_PROFILE_QUESTION_IDS.map((questionId) => [
    questionId,
    answer,
  ])) as StudyProfileAnswers;
}
