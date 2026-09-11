import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyOnboardingAnswers, withOnboardingAnswer, type OnboardingAnswers } from "@/lib/onboarding/answers";
import type { OnboardingQuestionId } from "@/lib/onboarding/questions";
import { shapeASteps } from "@/lib/session-shapes/shape-a";
import { personalizationNote } from "./personalization-note";
import { routeSession, type RoutingInput, type SessionRoute } from "./session-route";

/**
 * Permanent personalization delta test (docs/redesign/02-ROUTING.md).
 *
 * Two contrasting saved profiles, same topic, same material. The resulting
 * blocks must differ on at least three of: shape entry point, produce step,
 * timer, question count/weighting, instruction style. Assertions are on rule
 * IDs, never on text. This test gates every change to routing.
 */
function profile(seed: Partial<Record<OnboardingQuestionId, string | string[]>>): OnboardingAnswers {
  let record = emptyOnboardingAnswers();
  for (const [id, value] of Object.entries(seed)) record = withOnboardingAnswer(record, id as OnboardingQuestionId, value as string | string[]);
  return record;
}

/** P1: short, distractible, wants exact steps, an example first, maps knowledge, misses specifics, needs shorter plain sections. */
export const BASELINE_PROFILE_1 = profile({
  energy_window: "evening",
  session_length: "minutes_10_15",
  focus_loss: "very_often",
  guidance: "exact_guidance",
  difficulty_help: "concrete_example",
  prove_knowing: "map_it",
  gist_detail: "gist_leaning",
  starting_pattern: "often_delay",
  support_needs: ["shorter_sections", "simpler_repeated_instructions"],
  extra_context: "forget_during_tests",
});

/** P2: long, steady, wants to decide, tries first, explains in own words, loses the big picture, no extra support. */
export const BASELINE_PROFILE_2 = profile({
  energy_window: "morning",
  session_length: "minutes_45_60",
  focus_loss: "rarely",
  guidance: "learner_choice",
  difficulty_help: "try_then_feedback",
  prove_knowing: "explain_back",
  gist_detail: "detail_leaning",
  starting_pattern: "on_time",
  extra_context: "nothing_else",
});

const SAME_TOPIC: Omit<RoutingInput, "answers"> = { taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: true, topicHasProblems: false };

export const DELTA_FIELDS = ["entry", "produceStep", "timerMinutes", "questionCap", "weighting", "instructionStyle"] as const;

export function routingDeltaFields(first: SessionRoute, second: SessionRoute) {
  const entryDiffers = first.entry !== second.entry || first.produceBeforeStudy !== second.produceBeforeStudy || first.workedStructureBeforeProduce !== second.workedStructureBeforeProduce;
  return [
    entryDiffers ? "entry" : null,
    first.produceStep !== second.produceStep ? "produceStep" : null,
    first.timerMinutes !== second.timerMinutes ? "timerMinutes" : null,
    first.questionCap !== second.questionCap || first.weighting !== second.weighting ? "questionCountOrWeighting" : null,
    first.instructionStyle !== second.instructionStyle ? "instructionStyle" : null,
  ].filter((field): field is string => Boolean(field));
}

export function sessionPrintout(route: SessionRoute) {
  return {
    shape: route.shape,
    variant: route.shapeVariant,
    method: route.methodName,
    entry: route.entry,
    produceBeforeStudy: route.produceBeforeStudy,
    workedStructureBeforeProduce: route.workedStructureBeforeProduce,
    produceStep: route.produceStep,
    steps: shapeASteps(route).map((step) => step.kind),
    timerMinutes: route.timerMinutes,
    questionCap: route.questionCap,
    weighting: route.weighting,
    practiceRoundCeiling: route.practiceRoundCeiling,
    instructionStyle: route.instructionStyle,
    stoppingPoints: route.stoppingPoints,
    visibility: route.visibility,
    personalizationNote: personalizationNote(route),
    ruleIds: route.ruleIds,
  };
}

describe("Brief 1 permanent personalization delta", () => {
  const first = routeSession({ ...SAME_TOPIC, answers: BASELINE_PROFILE_1 });
  const second = routeSession({ ...SAME_TOPIC, answers: BASELINE_PROFILE_2 });

  it("two contrasting profiles differ on at least three routed properties for the same topic", () => {
    if (process.env.YOVA_BASELINE_DELTA_PRINTOUT) {
      writeFileSync(process.env.YOVA_BASELINE_DELTA_PRINTOUT, JSON.stringify({ topic: SAME_TOPIC, P1: sessionPrintout(first), P2: sessionPrintout(second), differingFields: routingDeltaFields(first, second) }, null, 2));
    }
    const differing = routingDeltaFields(first, second);
    expect(differing.length).toBeGreaterThanOrEqual(3);
    expect(differing).toEqual(["entry", "produceStep", "timerMinutes", "questionCountOrWeighting", "instructionStyle"]);
  });

  it("asserts on the rule IDs that fired for each profile", () => {
    expect(first.ruleIds).toEqual(expect.arrayContaining([
      "L1.conceptual_learning.learn",
      "L2.not_assessed",
      "L3.q5.concrete_example",
      "L3.q6.map_it",
      "L4.q2.minutes_10_15",
      "L4.q2.short_band_question_cap",
      "L4.q3.very_often",
      "L4.q7.gist_leaning",
      "L4.q9.shorter_sections",
      "L4.q9.simpler_repeated_instructions",
      "L4.q1.evening",
      "L4.q10.forget_during_tests",
      "L5.q4.exact_guidance",
    ]));
    expect(second.ruleIds).toEqual(expect.arrayContaining([
      "L1.conceptual_learning.learn",
      "L2.not_assessed",
      "L3.q5.try_then_feedback",
      "L3.q6.explain_back",
      "L4.q2.minutes_45_60",
      "L4.q3.rarely",
      "L4.q7.detail_leaning",
      "L4.q1.morning",
      "L5.q4.learner_choice",
    ]));
    const shared = first.ruleIds.filter((id) => second.ruleIds.includes(id));
    expect(shared).toEqual(["L1.conceptual_learning.learn", "L2.not_assessed", "L4.timer_resolved", "C6.rule_ids_recorded"]);
  });

  it("the learner-visible session differs: steps, method, timer, questions, note", () => {
    expect(first.methodName).toBe("Concept Mapping");
    expect(second.methodName).toBe("Feynman Technique");
    expect(shapeASteps(first).map((step) => step.kind)).toEqual(["direct", "away", "worked_structure", "produce", "compare", "repair", "end"]);
    expect(shapeASteps(second).map((step) => step.kind)).toEqual(["produce", "direct", "away", "compare", "repair", "end"]);
    expect(first.timerMinutes).toBe(11);
    expect(second.timerMinutes).toBe(55);
    expect(first.questionCap).toBe(5);
    expect(second.questionCap).toBe(8);
    expect(first.practiceRoundCeiling).toBe(4);
    expect(second.practiceRoundCeiling).toBe(3);
    expect(personalizationNote(first).ruleId).toBe("L3.q5.concrete_example");
    expect(personalizationNote(second).ruleId).toBe("L3.q5.try_then_feedback");
  });

  it("the same profile twice is byte-identical (no randomness in routing)", () => {
    expect(JSON.stringify(routeSession({ ...SAME_TOPIC, answers: BASELINE_PROFILE_1 }))).toBe(JSON.stringify(first));
  });

  it("the delta holds on the practice block too", () => {
    const practice1 = routeSession({ ...SAME_TOPIC, blockKind: "practice", answers: BASELINE_PROFILE_1 });
    const practice2 = routeSession({ ...SAME_TOPIC, blockKind: "practice", answers: BASELINE_PROFILE_2 });
    expect(routingDeltaFields(practice1, practice2)).toEqual(expect.arrayContaining(["timerMinutes", "questionCountOrWeighting", "instructionStyle"]));
  });
});
