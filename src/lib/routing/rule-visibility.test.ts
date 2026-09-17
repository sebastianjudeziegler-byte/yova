import { describe, expect, it } from "vitest";
import { LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";
import { emptyOnboardingAnswers, withOnboardingAnswer, type OnboardingAnswers } from "@/lib/onboarding/answers";
import { ONBOARDING_QUESTIONS } from "@/lib/onboarding/questions";
import { chosenBecause, HIDDEN_RULE_IDS, receiptEvidence } from "./rule-evidence";
import { alternativeProduceSteps, routeSession, withProduceStepOverride, withStudyOutside, type RoutingInput, type SessionRoute } from "./session-route";

/**
 * Session quality S3: fired routing rules remain traceable internally.
 * A receipt names the effective method and observed actions, excluding rules
 * that were overridden or refer to practice that did not occur.
 */
function profile(seed: Record<string, string | string[]>) {
  return Object.entries(seed).reduce((record, [id, value]) => withOnboardingAnswer(record, id as never, value), emptyOnboardingAnswers());
}

/** The personalization-delta profiles, where several modifiers stack. */
const STACKED = [
  profile({ energy_window: "evening", session_length: "minutes_10_15", focus_loss: "very_often", guidance: "exact_guidance", difficulty_help: "concrete_example", prove_knowing: "map_it", gist_detail: "gist_leaning", starting_pattern: "often_delay", support_needs: ["shorter_sections", "simpler_repeated_instructions"], extra_context: "forget_during_tests" }),
  profile({ energy_window: "morning", session_length: "minutes_45_60", focus_loss: "rarely", guidance: "learner_choice", difficulty_help: "try_then_feedback", prove_knowing: "explain_back", gist_detail: "detail_leaning", starting_pattern: "on_time", extra_context: "nothing_else" }),
  profile({ session_length: "minutes_45_60", support_needs: ["extra_reading_time", "reduced_text_visual_structure", "frequent_check_ins"], prove_knowing: "solve_it", difficulty_help: "step_by_step", extra_context: "examples_before_ready" }),
];

function profiles(): OnboardingAnswers[] {
  const singles = ONBOARDING_QUESTIONS.flatMap((question) => question.options.map((option) => withOnboardingAnswer(emptyOnboardingAnswers(), question.id, question.multi ? [option.id] : option.id)));
  return [emptyOnboardingAnswers(), ...STACKED, ...singles];
}

function everyRoute(): SessionRoute[] {
  const routes: SessionRoute[] = [];
  const contexts: Array<Partial<RoutingInput>> = [
    {},
    { daysToDeadline: 2 },
    { passedRelatedTopicIds: ["a", "b"] },
    { daysToDeadline: 1, passedRelatedTopicIds: ["a", "b"] },
    { subtopicCount: 9, prerequisiteDepth: 3 },
    { subtopicCount: 3, prerequisiteDepth: 1 },
  ];
  for (const answers of profiles()) {
    for (const taskType of LEARNING_TASK_TYPES) {
      for (const blockKind of ["learn", "practice"] as const) {
        for (const evidence of ["not_assessed", "gap", "demonstrated", "learner_reported_covered"] as const) {
          for (const hasSource of [true, false]) {
            for (const context of contexts) {
              const route = routeSession({ taskType, blockKind, evidence, hasSource, topicHasProblems: taskType === "mixed_assessment", answers, ...context });
              routes.push(route, withStudyOutside(route), ...alternativeProduceSteps(route).map((step) => withProduceStepOverride(route, step)));
            }
          }
        }
      }
    }
  }
  return routes;
}

describe("effective personalization is visible", () => {
  const routes = everyRoute();

  it("covers a large sample of routes", () => {
    expect(routes.length).toBeGreaterThan(20_000);
  });

  it("receipts name effective produce preferences and reject overridden or unused actions across the route space", { timeout: 60_000 }, () => {
    const violations = new Set<string>();
    const preference = { typed_explanation: "L3.q6.explain_back", concept_map: "L3.q6.map_it", retrieval_questions: "L3.q6.answer_questions", worked_solution: "L3.q6.solve_it" };
    for (const route of routes) {
      const practiceOccurred = route.shape === "C" || route.produceStep === "retrieval_questions";
      const named = new Set(receiptEvidence(route, { practiceOccurred, repairRoundOccurred: false }).map((entry) => entry.ruleId));
      const expectedPreference = preference[route.produceStep as keyof typeof preference];
      if (expectedPreference && route.ruleIds.includes(expectedPreference) && !named.has(expectedPreference)) violations.add(`Missing effective ${expectedPreference}`);
      if ((!route.produceBeforeStudy || route.produceStep === "retrieval_questions") && named.has("L3.q5.try_then_feedback")) violations.add("False try-first claim");
      if (!practiceOccurred && [...named].some((id) => /^L4\.(practice|mix|q7)\./.test(id))) violations.add("False practice claim");
      if (named.has("L4.practice.error_repair.after_missed_round")) violations.add("False retry history");
      if (route.produceStep !== "concept_map" && named.has("C2.q9_visual_overrides_q6")) violations.add("False map claim");
      if (route.ruleIds.includes("C6.rule_ids_recorded") && !named.has("C6.rule_ids_recorded")) violations.add("Missing traceability");
    }
    expect([...violations]).toEqual([]);
  });

  it("names only rules that fired, one sentence each, and never the difficulty band", { timeout: 60_000 }, () => {
    for (const route of routes.filter((_, index) => index % 7 === 0)) {
      for (const entry of receiptEvidence(route)) {
        expect(route.ruleIds).toContain(entry.ruleId);
        expect(entry.sentence.match(/[.!?](\s|$)/g)?.length, entry.sentence).toBe(1);
        expect(entry.sentence).not.toMatch(/difficult/i);
      }
      for (const pill of chosenBecause(route)) expect(HIDDEN_RULE_IDS.has(pill.ruleId)).toBe(false);
    }
  });

  it("the hidden band is exactly the three difficulty bands, and a high band's effect is named", () => {
    expect([...HIDDEN_RULE_IDS].sort()).toEqual(["L4.difficulty.high", "L4.difficulty.low", "L4.difficulty.medium"]);
    const high = routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: true, topicHasProblems: false, answers: emptyOnboardingAnswers(), subtopicCount: 9, prerequisiteDepth: 3 });
    expect(high.ruleIds).toContain("L4.difficulty.high");
    expect(receiptEvidence(high, { practiceOccurred: false }).find((entry) => entry.ruleId === "L4.difficulty.high.more_questions")).toBeUndefined();
    expect(receiptEvidence(high, { practiceOccurred: true }).find((entry) => entry.ruleId === "L4.difficulty.high.more_questions")?.sentence).toBe("Practice in this block contains 8 questions before any missed-point retry.");
  });

  it("an examples-first learner shown no example gets an honest sentence, not a claim", () => {
    const examplesFirst = routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: true, topicHasProblems: false, answers: withOnboardingAnswer(emptyOnboardingAnswers(), "difficulty_help", "concrete_example") });
    const sentence = receiptEvidence(examplesFirst, { exampleShown: false }).find((entry) => entry.ruleId === "L3.q5.concrete_example")?.sentence;
    expect(sentence).toBe("Because you said a concrete example helps most, the session included an example step, but you continued without an example being shown.");
  });
});
