import { describe, expect, it } from "vitest";
import { LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";
import { emptyOnboardingAnswers, withOnboardingAnswer, type OnboardingAnswers } from "@/lib/onboarding/answers";
import { ONBOARDING_QUESTIONS } from "@/lib/onboarding/questions";
import { chosenBecause, HIDDEN_RULE_IDS, receiptEvidence } from "./rule-evidence";
import { alternativeProduceSteps, routeSession, withProduceStepOverride, withStudyOutside, type RoutingInput, type SessionRoute } from "./session-route";

/**
 * Brief 1.5 item 7: if a routing rule fired, the learner can see it somewhere.
 * The end receipt names every fired rule; the only exception is the topic
 * difficulty band, which stays hidden while its effect (the question count)
 * is named (founder decision, 16 Sept 2026).
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

describe("every fired rule is visible", () => {
  const routes = everyRoute();

  it("covers a large sample of routes", () => {
    expect(routes.length).toBeGreaterThan(20_000);
  });

  it("the end receipt names every fired rule except the hidden difficulty band", { timeout: 60_000 }, () => {
    const invisible = new Map<string, number>();
    for (const route of routes) {
      for (const happened of [{}, { exampleShown: true }, { exampleShown: false }]) {
        const named = new Set(receiptEvidence(route, happened).map((entry) => entry.ruleId));
        for (const ruleId of route.ruleIds) {
          if (!named.has(ruleId) && !HIDDEN_RULE_IDS.has(ruleId)) invisible.set(ruleId, (invisible.get(ruleId) ?? 0) + 1);
        }
      }
    }
    expect([...invisible.keys()].sort()).toEqual([]);
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
    expect(receiptEvidence(high).find((entry) => entry.ruleId === "L4.difficulty.high.more_questions")?.sentence).toBe("Practice on this topic asks eight questions per round.");
  });

  it("an examples-first learner shown no example gets an honest sentence, not a claim", () => {
    const examplesFirst = routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: true, topicHasProblems: false, answers: withOnboardingAnswer(emptyOnboardingAnswers(), "difficulty_help", "concrete_example") });
    const sentence = receiptEvidence(examplesFirst, { exampleShown: false }).find((entry) => entry.ruleId === "L3.q5.concrete_example")?.sentence;
    expect(sentence).toBe("Because you said a concrete example helps most, YOVA looked for a worked example, but there was none to show this time.");
  });
});
