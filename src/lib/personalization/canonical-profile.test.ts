import { describe, expect, it } from "vitest";
import {
  CANONICAL_LEARNER_PROFILE_SCHEMA_VERSION,
  CANONICAL_PROFILE_QUESTIONNAIRE_VERSION,
  CANONICAL_PROFILE_SIGNAL_IDS,
  CanonicalLearnerProfileSchema,
  createCanonicalLearnerProfile,
  serializeCanonicalLearnerProfile,
} from "@/lib/personalization/canonical-profile-schema";
import {
  CANONICAL_PROFILE_QUESTIONS,
  canonicalProfileFromQuestionnaire,
  canonicalQuestionnaireCoversEverySignal,
  unansweredCanonicalProfileQuestionIds,
} from "@/lib/personalization/canonical-profile-questionnaire";
import {
  buildCanonicalLearnerFacingSummary,
  buildCanonicalProfileDecisionHints,
} from "@/lib/personalization/canonical-profile-summary";
import {
  CANONICAL_PROFILE_METHOD_PREFERENCE_POLICY_VERSION,
  canonicalEligibleMethodTieBreakPreferences,
  canonicalMethodPreferenceMapUsesKnownMethods,
} from "@/lib/personalization/canonical-profile-method-preference";

describe("canonical learner profile contract", () => {
  it("defines one versioned, concise question-to-decision registry", () => {
    expect(CANONICAL_LEARNER_PROFILE_SCHEMA_VERSION)
      .toBe("canonical_learner_profile_v1");
    expect(CANONICAL_PROFILE_QUESTIONNAIRE_VERSION)
      .toBe("canonical_profile_questionnaire_v1");
    expect(CANONICAL_PROFILE_QUESTIONS).toHaveLength(11);
    expect(canonicalQuestionnaireCoversEverySignal()).toBe(true);
    expect(new Set(CANONICAL_PROFILE_QUESTIONS.map((question) => question.id)).size)
      .toBe(CANONICAL_PROFILE_QUESTIONS.length);
    expect(new Set(CANONICAL_PROFILE_QUESTIONS.map((question) => question.signalId)).size)
      .toBe(CANONICAL_PROFILE_SIGNAL_IDS.length);

    for (const [index, question] of CANONICAL_PROFILE_QUESTIONS.entries()) {
      expect(question.number).toBe(index + 1);
      expect(question.signal.trim()).not.toBe("");
      expect(question.decisionIds.length).toBeGreaterThan(0);
      expect(question.decision.trim()).not.toBe("");
      expect(question.maxAuthority.trim()).not.toBe("");
      expect(question.authorityLimit.trim()).not.toBe("");
      expect(question.explanation.trim()).not.toBe("");
      expect(question.confirmationEvidence.length).toBeGreaterThan(0);
      expect(question.contradictionEvidence.length).toBeGreaterThan(0);
      expect(question.correction).toMatch(/Change this answer/);
      expect(question.options.some((option) => (
        option.id === "depends" || option.id === "not_sure"
      ))).toBe(true);
    }
    expect(new Set(CANONICAL_PROFILE_QUESTIONS.map((question) => question.format)))
      .toEqual(new Set(["direct_choice", "scenario"]));
  });

  it("keeps prohibited fixed-type claims out of all learner-facing registry copy", () => {
    const copy = JSON.stringify(CANONICAL_PROFILE_QUESTIONS);
    expect(copy).not.toMatch(
      /diagnos|personality type|intelligence level|learning style|neurotype/i,
    );
  });

  it("allows a partial response so existing learners can study without re-onboarding", () => {
    const profile = canonicalProfileFromQuestionnaire({
      questionnaireVersion: CANONICAL_PROFILE_QUESTIONNAIRE_VERSION,
      answers: [{
        questionId: "profile_realistic_session_length",
        value: "minutes_20_30",
      }],
    });

    expect(profile.signals).toEqual([{
      signalId: "realistic_session_length",
      value: "minutes_20_30",
      source: "canonical_questionnaire",
      sourceQuestionId: "profile_realistic_session_length",
      provenance: "direct_answer",
    }]);
    expect(unansweredCanonicalProfileQuestionIds(profile)).toHaveLength(10);
  });

  it("rejects signal/value mismatches and duplicate canonical signals", () => {
    expect(CanonicalLearnerProfileSchema.safeParse({
      schemaVersion: CANONICAL_LEARNER_PROFILE_SCHEMA_VERSION,
      questionnaireVersion: CANONICAL_PROFILE_QUESTIONNAIRE_VERSION,
      signals: [{
        signalId: "control_mode",
        value: "minutes_20_30",
        source: "canonical_questionnaire",
        sourceQuestionId: "profile_control_mode",
        provenance: "direct_answer",
      }],
    }).success).toBe(false);

    expect(CanonicalLearnerProfileSchema.safeParse({
      schemaVersion: CANONICAL_LEARNER_PROFILE_SCHEMA_VERSION,
      questionnaireVersion: CANONICAL_PROFILE_QUESTIONNAIRE_VERSION,
      signals: ["yova_decides", "help_me_choose"].map((value) => ({
        signalId: "control_mode",
        value,
        source: "canonical_questionnaire",
        sourceQuestionId: "profile_control_mode",
        provenance: "direct_answer",
      })),
    }).success).toBe(false);
  });

  it("serializes profiles deterministically in canonical signal order", () => {
    const control = {
      signalId: "control_mode" as const,
      value: "help_me_choose" as const,
      source: "canonical_questionnaire" as const,
      sourceQuestionId: "profile_control_mode",
      provenance: "direct_answer" as const,
    };
    const duration = {
      signalId: "realistic_session_length" as const,
      value: "minutes_20_30" as const,
      source: "canonical_questionnaire" as const,
      sourceQuestionId: "profile_realistic_session_length",
      provenance: "direct_answer" as const,
    };
    const left = createCanonicalLearnerProfile([duration, control]);
    const right = createCanonicalLearnerProfile([control, duration]);

    expect(serializeCanonicalLearnerProfile(left))
      .toBe(serializeCanonicalLearnerProfile(right));
    expect(left.signals.map((signal) => signal.signalId))
      .toEqual(["control_mode", "realistic_session_length"]);
  });

  it("builds a deterministic learner-facing summary and an honest empty state", () => {
    const empty = buildCanonicalLearnerFacingSummary(
      createCanonicalLearnerProfile([]),
    );
    expect(empty.heading).toBe("How YOVA will work with you");
    expect(empty.statements[0]).toContain("You can start now");
    expect(empty.unansweredQuestionCount).toBe(11);

    const profile = completeQuestionnaireProfile();
    const first = buildCanonicalLearnerFacingSummary(profile);
    const second = buildCanonicalLearnerFacingSummary(profile);
    expect(first).toEqual(second);
    expect(first.statements.join(" ")).toContain("recommend one valid route");
    expect(first.statements.join(" ")).toContain("20–30 minute sessions");
    expect(first.evidenceBoundary).toContain("checked results");
    expect(first.unansweredQuestionCount).toBe(0);
  });

  it("projects profile answers only into methods already allowed by the router", () => {
    expect(canonicalMethodPreferenceMapUsesKnownMethods()).toBe(true);
    const profile = canonicalProfileFromQuestionnaire({
      questionnaireVersion: CANONICAL_PROFILE_QUESTIONNAIRE_VERSION,
      answers: [{
        questionId: "profile_successful_approach",
        value: "practice_problems",
      }],
    });

    expect(canonicalEligibleMethodTieBreakPreferences(profile, [
      "retrieval_practice",
      "practice_problems",
    ])).toEqual([{
      policyVersion: CANONICAL_PROFILE_METHOD_PREFERENCE_POLICY_VERSION,
      methodId: "practice_problems",
      signalId: "successful_approach",
      signalValue: "practice_problems",
      source: "canonical_questionnaire",
      sourceQuestionId: "profile_successful_approach",
      authority: "eligible_method_tiebreaker_only",
      reason: "successful_approach=practice_problems may rank practice_problems only because it is already eligible.",
    }]);
    expect(canonicalEligibleMethodTieBreakPreferences(
      profile,
      ["retrieval_practice"],
    )).toEqual([]);
  });

  it("uses the expanded method IDs in bounded entry preferences", () => {
    const preferenceFor = (value: "big_picture" | "try_first") => (
      canonicalEligibleMethodTieBreakPreferences(
        canonicalProfileFromQuestionnaire({
          questionnaireVersion: CANONICAL_PROFILE_QUESTIONNAIRE_VERSION,
          answers: [{
            questionId: "profile_unfamiliar_entry",
            value,
          }],
        }),
        ["concept_mapping", "pretesting", "practice_problems"],
      ).map((preference) => preference.methodId)
    );

    expect(preferenceFor("big_picture")).toEqual(["concept_mapping"]);
    expect(preferenceFor("try_first")).toEqual(["pretesting", "practice_problems"]);
  });

  it("changes a method tie-break projection when only one method-authority answer changes", () => {
    const profileFor = (value: "closed_note_retrieval" | "practice_problems") => (
      canonicalProfileFromQuestionnaire({
        questionnaireVersion: CANONICAL_PROFILE_QUESTIONNAIRE_VERSION,
        answers: [{
          questionId: "profile_successful_approach",
          value,
        }],
      })
    );
    const eligible = [
      "retrieval_practice",
      "spaced_retrieval",
      "practice_problems",
    ] as const;

    expect(canonicalEligibleMethodTieBreakPreferences(
      profileFor("closed_note_retrieval"),
      eligible,
    ).map((item) => item.methodId)).toEqual([
      "retrieval_practice",
      "spaced_retrieval",
    ]);
    expect(canonicalEligibleMethodTieBreakPreferences(
      profileFor("practice_problems"),
      eligible,
    ).map((item) => item.methodId)).toEqual(["practice_problems"]);
  });

  it.each(CANONICAL_PROFILE_QUESTIONS)(
    "changes only %s input while preserving its declared authority",
    (question) => {
      const baselineAnswers = CANONICAL_PROFILE_QUESTIONS.map((candidate) => ({
        questionId: candidate.id,
        value: candidate.options[0].id,
      }));
      const changedAnswers = baselineAnswers.map((answer) => (
        answer.questionId === question.id
          ? { ...answer, value: question.options[1].id }
          : answer
      ));
      const baseline = canonicalProfileFromQuestionnaire({
        questionnaireVersion: CANONICAL_PROFILE_QUESTIONNAIRE_VERSION,
        answers: baselineAnswers,
      });
      const changed = canonicalProfileFromQuestionnaire({
        questionnaireVersion: CANONICAL_PROFILE_QUESTIONNAIRE_VERSION,
        answers: changedAnswers,
      });
      const baselineHint = buildCanonicalProfileDecisionHints(baseline)
        .find((hint) => hint.signalId === question.signalId);
      const changedHint = buildCanonicalProfileDecisionHints(changed)
        .find((hint) => hint.signalId === question.signalId);

      expect(serializeCanonicalLearnerProfile(changed))
        .not.toBe(serializeCanonicalLearnerProfile(baseline));
      expect(changed.signals.filter((signal) => {
        const before = baseline.signals.find((item) => item.signalId === signal.signalId);
        return before?.value !== signal.value;
      }).map((signal) => signal.signalId)).toEqual([question.signalId]);
      expect(baselineHint?.decisionIds).toEqual(question.decisionIds);
      expect(changedHint?.decisionIds).toEqual(question.decisionIds);
      expect(changedHint?.maxAuthority).toBe(question.maxAuthority);
      expect(changedHint?.rationale).not.toBe(baselineHint?.rationale);
      expect(buildCanonicalLearnerFacingSummary(changed))
        .not.toEqual(buildCanonicalLearnerFacingSummary(baseline));
    },
  );
});

function completeQuestionnaireProfile() {
  return canonicalProfileFromQuestionnaire({
    questionnaireVersion: CANONICAL_PROFILE_QUESTIONNAIRE_VERSION,
    answers: CANONICAL_PROFILE_QUESTIONS.map((question) => ({
      questionId: question.id,
      value: question.options[
        question.signalId === "control_mode"
          || question.signalId === "realistic_session_length"
          ? 1
          : 0
      ].id,
    })),
  });
}
