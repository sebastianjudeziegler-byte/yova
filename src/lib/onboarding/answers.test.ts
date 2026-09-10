import { describe, expect, it } from "vitest";
import { onboardingQuestions as legacyQuestions } from "@/lib/sample-data";
import { PERSONALIZATION_STATE_ANSWER_INDEX } from "@/lib/personalization/personalization-state";
import {
  emptyOnboardingAnswers,
  hasStoredOnboardingAnswers,
  LEGACY_ONBOARDING_POSITIONS,
  ONBOARDING_ANSWERS_ANSWER_INDEX,
  onboardingAnswerId,
  onboardingAnsweredCount,
  onboardingAnswersFromLegacyArray,
  onboardingSupportNeeds,
  parseOnboardingAnswers,
  readOnboardingAnswers,
  serializeOnboardingAnswers,
  toggleOnboardingSupportNeed,
  withOnboardingAnswer,
  writeOnboardingAnswers,
} from "./answers";
import { ONBOARDING_QUESTION_IDS, ONBOARDING_QUESTIONS, onboardingQuestion } from "./questions";

/** A profile saved by an older build: labels at positions, nothing else. */
const LEGACY_LABEL_PROFILE = [
  "I get distracted",
  "Give me clear structure with flexibility",
  "20 to 30 minutes",
  "A concrete example first",
  "Often",
  "I intend to begin but often delay",
  "Evening",
  "Help me remember more",
  "Shorter sections with fewer steps at once",
  "I understand in class but forget during tests",
];

/** A profile saved after option IDs existed, still positional. */
const LEGACY_ID_PROFILE = [
  "retention_gap",
  "exact_guidance",
  "minutes_45_60",
  "try_then_feedback",
  "rarely",
  "on_time",
  "morning",
  "test_efficiency",
  "reduced_text_visual_structure",
  "long_plan_shutdown",
];

describe("baseline onboarding questions", () => {
  it("has ten questions in the redesign order with stable IDs", () => {
    expect(ONBOARDING_QUESTIONS.map((question) => question.id)).toEqual([...ONBOARDING_QUESTION_IDS]);
    expect(ONBOARDING_QUESTIONS.map((question) => question.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ONBOARDING_QUESTIONS.map((question) => question.prompt)).toEqual([
      "When do you usually have the most usable energy?",
      "What study-session length usually feels realistic?",
      "How often do you lose focus while studying?",
      "How much guidance do you want from YOVA?",
      "When a topic is difficult, what usually helps most?",
      "When you want to prove to yourself that you actually know something, what works best?",
      "When you're studying, which is more likely?",
      "Which starting pattern sounds most like you?",
      "Would any of these make YOVA easier for you to use?",
      "Is there anything else YOVA should know?",
    ]);
  });

  it("uses the rewritten Q6 and Q7 wording and option IDs", () => {
    expect(onboardingQuestion("prove_knowing").options).toEqual([
      { id: "explain_back", label: "Explaining it out loud or in writing" },
      { id: "map_it", label: "Mapping out how the pieces connect" },
      { id: "answer_questions", label: "Answering questions on it" },
      { id: "solve_it", label: "Working through a problem" },
    ]);
    expect(onboardingQuestion("gist_detail").options).toEqual([
      { id: "gist_leaning", label: "I get the big picture but miss specifics" },
      { id: "detail_leaning", label: "I know the details but lose how they fit together" },
      { id: "balanced", label: "Depends on the subject" },
    ]);
  });

  it("keeps every migrated question's option IDs identical to its legacy position", () => {
    for (const [id, position] of Object.entries(LEGACY_ONBOARDING_POSITIONS)) {
      const current = onboardingQuestion(id as never).options.map((option) => option.id);
      const legacy = legacyQuestions[position!].options.map((option) => option.id);
      expect(current, id).toEqual(legacy);
    }
  });

  it("stores the record beyond the personalization state slot", () => {
    expect(ONBOARDING_ANSWERS_ANSWER_INDEX).toBeGreaterThan(PERSONALIZATION_STATE_ANSWER_INDEX);
  });
});

describe("one-time migration from position-indexed answers", () => {
  it("migrates a label-only legacy profile to IDs keyed by question", () => {
    const record = onboardingAnswersFromLegacyArray(LEGACY_LABEL_PROFILE);
    expect(record.answers).toEqual({
      energy_window: "evening",
      session_length: "minutes_20_30",
      focus_loss: "often",
      guidance: "structured_flexibility",
      difficulty_help: "concrete_example",
      starting_pattern: "often_delay",
      support_needs: ["shorter_sections"],
      extra_context: "forget_during_tests",
    });
    expect(record.legacy).toEqual({ common_blocker: "distracted", improvement_goal: "remember" });
  });

  it("migrates an ID-based positional profile without loss", () => {
    const record = onboardingAnswersFromLegacyArray(LEGACY_ID_PROFILE);
    expect(record.answers).toEqual({
      energy_window: "morning",
      session_length: "minutes_45_60",
      focus_loss: "rarely",
      guidance: "exact_guidance",
      difficulty_help: "try_then_feedback",
      starting_pattern: "on_time",
      support_needs: ["reduced_text_visual_structure"],
      extra_context: "long_plan_shutdown",
    });
    expect(record.legacy).toEqual({ common_blocker: "retention_gap", improvement_goal: "test_efficiency" });
  });

  it("leaves the two rewritten questions unanswered because no legacy answer can be trusted for them", () => {
    const record = onboardingAnswersFromLegacyArray(LEGACY_LABEL_PROFILE);
    expect(onboardingAnswerId(record, "prove_knowing")).toBeNull();
    expect(onboardingAnswerId(record, "gist_detail")).toBeNull();
    expect(onboardingAnsweredCount(record)).toBe(8);
  });

  it("drops values that are neither a known ID nor a known label", () => {
    const record = onboardingAnswersFromLegacyArray(["", "Anything at all", "", "", "", "", "Mars", "", "", ""]);
    expect(record.answers).toEqual({});
    expect(record.legacy).toEqual({});
  });

  it("reads a container without a stored record by migrating it once, then prefers the stored record", () => {
    const migrated = readOnboardingAnswers(LEGACY_LABEL_PROFILE);
    expect(hasStoredOnboardingAnswers(LEGACY_LABEL_PROFILE)).toBe(false);
    const container = writeOnboardingAnswers(LEGACY_LABEL_PROFILE, withOnboardingAnswer(migrated, "prove_knowing", "map_it"));
    expect(hasStoredOnboardingAnswers(container)).toBe(true);
    const reread = readOnboardingAnswers(container);
    expect(onboardingAnswerId(reread, "prove_knowing")).toBe("map_it");
    expect(onboardingAnswerId(reread, "energy_window")).toBe("evening");
  });

  it("survives the reorder: a saved profile projects back to the same legacy positions", () => {
    const record = readOnboardingAnswers(LEGACY_ID_PROFILE);
    const container = writeOnboardingAnswers(LEGACY_ID_PROFILE, record);
    expect(container.slice(0, 10)).toEqual(LEGACY_ID_PROFILE);
    expect(container[ONBOARDING_ANSWERS_ANSWER_INDEX]).toBe(serializeOnboardingAnswers(record));
  });

  it("keeps deep-profile and personalization-state slots untouched when writing", () => {
    const container = Array.from({ length: 17 }, (_, index) => `slot-${index}`);
    container[PERSONALIZATION_STATE_ANSWER_INDEX] = "{\"version\":1}";
    const written = writeOnboardingAnswers(container, withOnboardingAnswer(emptyOnboardingAnswers(), "guidance", "learner_choice"));
    expect(written.slice(10, 17)).toEqual(container.slice(10, 17));
    expect(written[1]).toBe("learner_choice");
  });
});

describe("ID-keyed answer record", () => {
  it("rejects unknown option IDs and labels on write", () => {
    const record = withOnboardingAnswer(emptyOnboardingAnswers(), "guidance", "do whatever");
    expect(onboardingAnswerId(record, "guidance")).toBeNull();
    const labelled = withOnboardingAnswer(emptyOnboardingAnswers(), "guidance", "Tell me exactly what to do");
    expect(onboardingAnswerId(labelled, "guidance")).toBe("exact_guidance");
  });

  it("keeps support needs as a validated multi-select set", () => {
    let record = toggleOnboardingSupportNeed(emptyOnboardingAnswers(), "shorter_sections");
    record = toggleOnboardingSupportNeed(record, "frequent_check_ins");
    record = toggleOnboardingSupportNeed(record, "not-an-option");
    expect(onboardingSupportNeeds(record)).toEqual(["shorter_sections", "frequent_check_ins"]);
    record = toggleOnboardingSupportNeed(record, "shorter_sections");
    expect(onboardingSupportNeeds(record)).toEqual(["frequent_check_ins"]);
  });

  it("round-trips through serialization and ignores foreign fields", () => {
    const record = withOnboardingAnswer(withOnboardingAnswer(emptyOnboardingAnswers(), "gist_detail", "detail_leaning"), "support_needs", ["extra_reading_time", "bogus"]);
    const parsed = parseOnboardingAnswers(serializeOnboardingAnswers(record));
    expect(parsed).toEqual({ version: 1, answers: { gist_detail: "detail_leaning", support_needs: ["extra_reading_time"] }, legacy: {} });
    expect(parseOnboardingAnswers("{\"version\":2,\"answers\":{}}")).toBeNull();
    expect(parseOnboardingAnswers("not json")).toBeNull();
    expect(parseOnboardingAnswers(JSON.stringify({ version: 1, answers: { guidance: "learner_choice", extra: "x" }, legacy: { common_blocker: "overwhelmed" } }))?.legacy).toEqual({ common_blocker: "overwhelmed" });
  });
});
