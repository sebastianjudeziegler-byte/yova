import { describe, expect, it } from "vitest";
import {
  CANONICAL_V1_PERSONALIZATION_CONTROL_KEYS,
  consolidatePersonalizationStateForCanonicalV1,
  migrateAllLegacyProfileSources,
  migrateDeepProfileAnswersToCanonicalProfile,
  migrateLegacyAnswerVectorToCanonicalProfile,
  migrateLegacyAnswerVectorToCanonicalV1,
  migrateOnboardingAnswersToCanonicalProfile,
  migratePersonalizationStateToCanonicalProfile,
  migrateStoredAdditionalContextToCanonicalProfile,
  migrateStudyProfileToCanonicalProfile,
  setCanonicalV1PersonalizationControl,
} from "@/lib/personalization/canonical-profile-migration";
import {
  canonicalProfileSignal,
  serializeCanonicalLearnerProfile,
} from "@/lib/personalization/canonical-profile-schema";
import { encodeAdditionalLearnerContext } from "@/lib/personalization/learner-profile";
import {
  defaultPersonalizationState,
  effectivePersonalizationWorkspaceSettings,
  writePersonalizationStateToAnswers,
  type PersonalizationState,
} from "@/lib/personalization/personalization-state";
import type { StudyProfileAnswers } from "@/lib/study-profile/types";

describe("canonical profile compatibility migration", () => {
  it("adapts legacy onboarding IDs and labels without requiring missing answers", () => {
    const answers: string[] = [];
    answers[1] = "Recommend options and let me decide";
    answers[2] = "20 to 30 minutes";
    answers[3] = "A concrete example first";
    answers[4] = "Often";
    answers[5] = "I intend to begin but often delay";
    answers[6] = "Evening";
    answers[8] = "Less text and more visual structure";

    const profile = migrateOnboardingAnswersToCanonicalProfile(answers);

    expect(signalValues(profile)).toEqual({
      control_mode: "ill_customize",
      starting_friction: "often_delays",
      realistic_session_length: "minutes_20_30",
      unfamiliar_entry: "concrete_example",
      focus_pacing: "activity_changes",
      functional_support: "reduced_text_visual_structure",
      preferred_working_period: "evening",
    });
    expect(profile.signals.every((signal) => (
      signal.source === "legacy_onboarding"
      && signal.provenance === "compatible_migration"
    ))).toBe(true);
  });

  it("adapts every compatible deeper-profile answer and leaves free text unclassified", () => {
    const answers: string[] = [];
    answers[10] = "A concrete example before the rule";
    answers[11] = "I understand it but cannot apply it";
    answers[12] = "Explain the mistake directly";
    answers[13] = "Keep the full path visible";
    answers[14] = "Always use diagrams for me.";

    expect(signalValues(migrateDeepProfileAnswersToCanonicalProfile(answers)))
      .toEqual({
        unfamiliar_entry: "concrete_example",
        post_study_breakdown: "application_gap",
        first_repair: "direct_correction",
        workspace_structure: "full_path",
      });
  });

  it("adapts the persisted additional-context envelope used by existing accounts", () => {
    const answers: string[] = [];
    answers[10] = "big_picture";
    answers[11] = "delayed_forgetting";
    answers[12] = "smaller_steps";
    answers[13] = "one_step";
    const profile = migrateStoredAdditionalContextToCanonicalProfile(
      encodeAdditionalLearnerContext(answers),
    );

    expect(signalValues(profile)).toEqual({
      unfamiliar_entry: "big_picture",
      post_study_breakdown: "delayed_forgetting",
      first_repair: "smaller_steps",
      workspace_structure: "one_step",
    });
    expect(migrateStoredAdditionalContextToCanonicalProfile(
      "Old unstructured context that cannot be mapped safely.",
    ).signals).toEqual([]);
  });

  it("adapts complete Study Profile pairs but never treats a lone answer as evidence", () => {
    const complete = migrateStudyProfileToCanonicalProfile({
      answers: highStudyProfileAnswers(),
      metadata: { energyWindow: "morning" },
    });
    expect(signalValues(complete)).toEqual({
      starting_friction: "often_waits_for_pressure",
      post_study_breakdown: "recognition_without_recall",
      first_repair: "hint_first",
      workspace_structure: "one_step",
      focus_pacing: "short_blocks_with_changes",
      preferred_working_period: "morning",
    });
    expect(canonicalProfileSignal(complete, "focus_pacing")?.provenance)
      .toBe("paired_response_inference");
    expect(canonicalProfileSignal(complete, "preferred_working_period")?.source)
      .toBe("legacy_study_profile_metadata");

    expect(migrateStudyProfileToCanonicalProfile({ answers: { q3: "d" } }).signals)
      .toEqual([]);
    expect(signalValues(migrateStudyProfileToCanonicalProfile({
      answers: { q5: "d", q6: "d" },
    }))).toEqual({ focus_pacing: "activity_changes" });
    expect(signalValues(migrateStudyProfileToCanonicalProfile({
      answers: { q11: "d", q12: "d" },
    }))).toEqual({ focus_pacing: "shorter_blocks" });
    expect(migrateStudyProfileToCanonicalProfile({
      answers: { q7: "d", q8: "d" },
    }).signals).toEqual([]);
  });

  it("uses direct deep answers ahead of overlapping derived and onboarding answers", () => {
    const answers: string[] = [];
    answers[3] = "A simple explanation first";
    answers[10] = "Trying it before seeing an explanation";
    answers[12] = "Explain the mistake directly";
    const state = {
      ...defaultPersonalizationState(),
      studyProfile: {
        ...defaultPersonalizationState().studyProfile,
        answers: highStudyProfileAnswers(),
      },
    };
    const profile = migrateAllLegacyProfileSources({
      answerVector: answers,
      personalizationState: state,
    });

    expect(canonicalProfileSignal(profile, "unfamiliar_entry")).toMatchObject({
      value: "try_first",
      source: "legacy_deep_profile",
    });
    expect(canonicalProfileSignal(profile, "first_repair")).toMatchObject({
      value: "direct_correction",
      source: "legacy_deep_profile",
    });
  });

  it("honors supported learner corrections, pauses, and do-not-infer choices", () => {
    const base = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([
      "",
      "",
      "",
      "A simple explanation first",
      "Often",
    ], {
      ...base,
      pausedSignalIds: ["signal:attention_variability"],
      corrections: [{
        signalId: "signal:processing_entry",
        correctedValue: "A concrete example before the rule",
        note: null,
        doNotInfer: false,
        updatedAt: "2026-08-30T10:00:00.000Z",
      }, {
        signalId: "signal:workspace_preference",
        correctedValue: null,
        note: "Do not use this usual layout.",
        doNotInfer: true,
        updatedAt: "2026-08-30T10:00:00.000Z",
      }],
      studyProfile: {
        ...base.studyProfile,
        answers: {
          q3: "d",
          q4: "d",
          q5: "d",
          q6: "d",
          q11: "d",
          q12: "d",
        },
      },
    });
    const profile = migrateLegacyAnswerVectorToCanonicalProfile(answers);

    expect(canonicalProfileSignal(profile, "unfamiliar_entry")).toMatchObject({
      value: "concrete_example",
      source: "learner_correction",
    });
    expect(canonicalProfileSignal(profile, "focus_pacing")).toBeNull();
    expect(canonicalProfileSignal(profile, "workspace_structure")).toBeNull();
  });

  it("returns an empty, valid profile when self-report is disabled", () => {
    const state = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([
      "I struggle to start",
      "Tell me exactly what to do",
      "20 to 30 minutes",
    ], {
      ...state,
      controls: { ...state.controls, selfReport: false },
      studyProfile: {
        ...state.studyProfile,
        answers: highStudyProfileAnswers(),
      },
    });

    expect(migrateLegacyAnswerVectorToCanonicalProfile(answers).signals).toEqual([]);
    expect(migratePersonalizationStateToCanonicalProfile({
      ...state,
      controls: { ...state.controls, selfReport: false },
    }).signals).toEqual([]);
  });

  it("is deterministic and fail-soft for empty or incompatible legacy values", () => {
    const incompatible = [
      "This value did not exist",
      "An unsupported profile label",
      "Two hours",
    ];
    const first = migrateLegacyAnswerVectorToCanonicalProfile(incompatible);
    const second = migrateLegacyAnswerVectorToCanonicalProfile(incompatible);

    expect(first.signals).toEqual([]);
    expect(serializeCanonicalLearnerProfile(first))
      .toBe(serializeCanonicalLearnerProfile(second));
  });
});

describe("canonical v1 experimentation retirement", () => {
  it("does not expose an active-experiment control", () => {
    expect(CANONICAL_V1_PERSONALIZATION_CONTROL_KEYS).not.toContain("experiments");
  });

  it("archives an unfinished experiment once, disables it, and preserves old history", () => {
    const state = stateWithActiveExperiment();
    const consolidated = consolidatePersonalizationStateForCanonicalV1(state);

    expect(consolidated.controls.experiments).toBe(false);
    expect(consolidated.activeExperiment).toBeNull();
    expect(consolidated.experimentHistory.map((item) => item.id))
      .toEqual(["old-experiment", "active-experiment"]);
    expect(consolidated.experimentHistory[0]).toEqual(state.experimentHistory[0]);
    expect(consolidated.experimentHistory[1]).toMatchObject({
      id: "active-experiment",
      result: "stopped",
      summary: expect.stringContaining("canonical profile v1"),
    });

    expect(consolidatePersonalizationStateForCanonicalV1(consolidated))
      .toEqual(consolidated);
  });

  it("rejects stale attempts to reactivate experiments while allowing v1 controls", () => {
    const state = stateWithActiveExperiment();
    const stale = setCanonicalV1PersonalizationControl(
      state,
      "experiments",
      true,
      "2026-08-30T11:00:00.000Z",
    );
    expect(stale.controls.experiments).toBe(false);
    expect(stale.activeExperiment).toBeNull();

    const receipts = setCanonicalV1PersonalizationControl(
      stale,
      "receipts",
      false,
      "2026-08-30T11:01:00.000Z",
    );
    expect(receipts.controls.receipts).toBe(false);
    expect(receipts.controls.experiments).toBe(false);
    expect(receipts.experimentHistory).toEqual(stale.experimentHistory);
  });

  it("returns the consolidated state beside the migrated profile for persistence wiring", () => {
    const answers = writePersonalizationStateToAnswers(
      ["I struggle to start"],
      stateWithActiveExperiment(),
    );
    const migration = migrateLegacyAnswerVectorToCanonicalV1(answers);

    expect(migration.profile.signals).toContainEqual(expect.objectContaining({
      signalId: "starting_friction",
      value: "often_delays",
    }));
    expect(migration.personalizationState.controls.experiments).toBe(false);
    expect(migration.personalizationState.activeExperiment).toBeNull();
    expect(migration.personalizationState.experimentHistory.map((item) => item.id))
      .toEqual(["old-experiment", "active-experiment"]);
  });

  it("keeps historical experiment records read-only", () => {
    const state = stateWithActiveExperiment();
    state.experimentHistory = [{
      ...state.experimentHistory[0],
      variable: "workspace",
      variantA: "one_step",
      variantB: "full_path",
      result: "promising_a",
    }];
    const consolidated = consolidatePersonalizationStateForCanonicalV1(state);

    expect(consolidated.experimentHistory[0].result).toBe("promising_a");
    expect(effectivePersonalizationWorkspaceSettings(consolidated, {
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
    }).layout).toBe("automatic");
  });
});

function signalValues(profile: ReturnType<typeof migrateLegacyAnswerVectorToCanonicalProfile>) {
  return Object.fromEntries(profile.signals.map((signal) => [
    signal.signalId,
    signal.value,
  ]));
}

function highStudyProfileAnswers(): StudyProfileAnswers {
  return {
    q1: "d",
    q2: "d",
    q3: "d",
    q4: "d",
    q5: "d",
    q6: "d",
    q7: "d",
    q8: "c",
    q9: "d",
    q10: "d",
    q11: "d",
    q12: "d",
  };
}

function stateWithActiveExperiment(): PersonalizationState {
  const state = defaultPersonalizationState();
  return {
    ...state,
    controls: { ...state.controls, experiments: true },
    activeExperiment: {
      id: "active-experiment",
      variable: "workspace",
      variantA: "one_step",
      variantB: "full_path",
      startedAt: "2026-08-29T10:00:00.000Z",
      taskType: "conceptual_learning",
      knowledgeStage: "developing",
      minimumSessionsPerVariant: 2,
      userApproved: true,
      nextVariant: "a",
      observations: [],
    },
    experimentHistory: [{
      id: "old-experiment",
      variable: "presentation",
      variantA: "example_first",
      variantB: "rule_first",
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
      result: "mixed",
      summary: "Earlier results were mixed.",
      sessionsA: 2,
      sessionsB: 2,
      checkedAnswers: 12,
      accuracyA: 75,
      accuracyB: 75,
      completedAt: "2026-08-20T10:00:00.000Z",
    }],
  };
}
