import { describe, expect, it } from "vitest";
import { CORE_METHOD_CATALOG, LEARNING_TASK_TYPES, type LearningTaskType } from "@/lib/learning/method-catalog";
import { emptyOnboardingAnswers, withOnboardingAnswer, type OnboardingAnswers } from "@/lib/onboarding/answers";
import { ONBOARDING_QUESTIONS, type OnboardingQuestionId } from "@/lib/onboarding/questions";
import {
  alternativeProduceSteps,
  PRACTICE_QUESTION_MAXIMUM,
  PRACTICE_QUESTION_MINIMUM,
  ROUTING_BLOCK_KINDS,
  ROUTING_EVIDENCE_LEVELS,
  routeSession,
  SHAPE_A_ENTRY_LEVELS,
  TIMER_MAXIMUM_MINUTES,
  TIMER_MINIMUM_MINUTES,
  withStudyOutside,
  type RoutingInput,
} from "./session-route";

type AnswerSeed = Partial<Record<Exclude<OnboardingQuestionId, "support_needs">, string>> & { support_needs?: string[] };

function answersOf(seed: AnswerSeed = {}): OnboardingAnswers {
  let record = emptyOnboardingAnswers();
  for (const [id, value] of Object.entries(seed)) {
    record = withOnboardingAnswer(record, id as OnboardingQuestionId, value as string | string[]);
  }
  return record;
}

function input(overrides: Partial<RoutingInput> = {}): RoutingInput {
  return {
    taskType: "conceptual_learning",
    blockKind: "learn",
    evidence: "not_assessed",
    hasSource: true,
    topicHasProblems: false,
    answers: answersOf(),
    ...overrides,
  };
}

/** Every task type × block kind × evidence × source × problems: 224 contexts. */
function everyContext(): Array<Omit<RoutingInput, "answers">> {
  const contexts: Array<Omit<RoutingInput, "answers">> = [];
  for (const taskType of LEARNING_TASK_TYPES) {
    for (const blockKind of ROUTING_BLOCK_KINDS) {
      for (const evidence of ROUTING_EVIDENCE_LEVELS) {
        for (const hasSource of [true, false]) {
          for (const topicHasProblems of [true, false]) {
            contexts.push({ taskType, blockKind, evidence, hasSource, topicHasProblems });
          }
        }
      }
    }
  }
  return contexts;
}

/** Every single-question answer value, plus the empty profile. */
function everySingleAnswer(): Array<{ label: string; answers: OnboardingAnswers }> {
  const seeds: Array<{ label: string; answers: OnboardingAnswers }> = [{ label: "unanswered", answers: answersOf() }];
  for (const question of ONBOARDING_QUESTIONS) {
    for (const option of question.options) {
      seeds.push({
        label: `${question.id}=${option.id}`,
        answers: answersOf(question.id === "support_needs" ? { support_needs: [option.id] } : { [question.id]: option.id }),
      });
    }
  }
  return seeds;
}

const PROCEDURAL: LearningTaskType[] = ["problem_solving", "programming"];

describe("baseline routing — exhaustive input space", () => {
  const contexts = everyContext();
  const singles = everySingleAnswer();

  it("covers 224 topic contexts and every option of all ten questions", () => {
    expect(contexts).toHaveLength(224);
    expect(singles.length).toBe(1 + ONBOARDING_QUESTIONS.reduce((sum, question) => sum + question.options.length, 0));
  });

  it("records a rule ID for every decision, in every context, for every answer", () => {
    let evaluated = 0;
    for (const context of contexts) {
      for (const single of singles) {
        const route = routeSession({ ...context, answers: single.answers });
        evaluated += 1;
        expect(route.decisions.length, single.label).toBeGreaterThan(0);
        for (const decision of route.decisions) {
          expect(decision.ruleId, single.label).toMatch(/^(L[1-5]|C[1-6])\./);
        }
        expect(route.ruleIds).toEqual(route.decisions.map((decision) => decision.ruleId));
        expect(route.ruleIds).toContain("C6.rule_ids_recorded");
        expect(route.ruleIds.some((id) => id.startsWith("L1."))).toBe(true);
        expect(route.ruleIds.some((id) => id.startsWith("L2."))).toBe(true);
        expect(route.ruleIds.some((id) => id.startsWith("L5."))).toBe(true);
      }
    }
    expect(evaluated).toBe(contexts.length * singles.length);
  });

  it("keeps every output inside its clamps and catalog", () => {
    for (const context of contexts) {
      for (const single of singles) {
        const route = routeSession({ ...context, answers: single.answers });
        expect(route.timerMinutes).toBeGreaterThanOrEqual(TIMER_MINIMUM_MINUTES);
        expect(route.timerMinutes).toBeLessThanOrEqual(TIMER_MAXIMUM_MINUTES);
        expect(route.questionCap).toBeGreaterThanOrEqual(PRACTICE_QUESTION_MINIMUM);
        expect(route.questionCap).toBeLessThanOrEqual(PRACTICE_QUESTION_MAXIMUM);
        expect(route.questionMinimum).toBe(PRACTICE_QUESTION_MINIMUM);
        expect(route.practiceRoundCeiling).toBeGreaterThanOrEqual(3);
        expect(route.practiceRoundCeiling).toBeLessThanOrEqual(4);
        expect(CORE_METHOD_CATALOG[route.methodId].name).toBe(route.methodName);
        expect(SHAPE_A_ENTRY_LEVELS).toContain(route.entry);
        if (route.shape === "C") {
          expect(route.produceStep).toBeNull();
          // Only Shape C's brief study step reads a source; practice never does.
          expect(route.learnPath).toBe(route.briefStudyStep ? (context.hasSource ? "source" : "ai_explanation") : null);
          expect(route.methodName).toBe("Active Recall");
        } else {
          expect(route.produceStep).not.toBeNull();
          expect(route.learnPath).toBe(context.hasSource ? "source" : "ai_explanation");
        }
      }
    }
  });

  it("is deterministic", () => {
    const seed = input({ answers: answersOf({ difficulty_help: "concrete_example", prove_knowing: "map_it", support_needs: ["shorter_sections", "extra_reading_time"] }) });
    expect(routeSession(seed)).toEqual(routeSession(structuredClone(seed)));
  });
});

describe("Layer 1 — task type decides the shape", () => {
  it.each([
    ["problem_solving", "A", "worked_example_source", "Worked Examples", true],
    ["programming", "A", "worked_example_source", "Worked Examples", true],
    ["memorization", "C", null, "Active Recall", false],
    ["conceptual_learning", "A", "standard", "Feynman Technique", false],
    ["reading_to_quiz", "A", "sq3r", "SQ3R", false],
    ["writing_argumentation", "A", "outline_from_memory", "Outline from Memory", false],
    ["mixed_assessment", "A", "standard", "Feynman Technique", false],
  ] as const)("%s learn block → Shape %s", (taskType, shape, variant, method, temporary) => {
    const route = routeSession(input({ taskType }));
    expect(route.shape).toBe(shape);
    expect(route.shapeVariant).toBe(variant);
    expect(route.methodName).toBe(method);
    expect(route.ruleIds).toContain(`L1.${taskType}.learn`);
    expect(route.temporaryRoute).toEqual(temporary ? { reason: "shape_b_not_built", intendedShape: "B" } : null);
    if (temporary) expect(route.ruleIds).toContain("L1.temporary.shape_b_not_built");
  });

  it("routes a mixed topic with problems to the worked-example route", () => {
    const route = routeSession(input({ taskType: "mixed_assessment", topicHasProblems: true }));
    expect(route.shapeVariant).toBe("worked_example_source");
    expect(route.ruleIds).toContain("L1.mixed_assessment.learn.problems");
  });

  it("memorization keeps a brief study step before practice, but only in its learn block", () => {
    expect(routeSession(input({ taskType: "memorization" })).briefStudyStep).toBe(true);
    expect(routeSession(input({ taskType: "memorization", blockKind: "practice" })).briefStudyStep).toBe(false);
  });

  it("the brief study step reads the learner's material when there is any, and an AI explanation otherwise", () => {
    expect(routeSession(input({ taskType: "memorization", hasSource: true })).learnPath).toBe("source");
    expect(routeSession(input({ taskType: "memorization", hasSource: false })).learnPath).toBe("ai_explanation");
    // A practice block has no study step to point anywhere.
    expect(routeSession(input({ taskType: "memorization", blockKind: "practice", hasSource: true })).learnPath).toBeNull();
    expect(routeSession(input({ blockKind: "practice", hasSource: true })).learnPath).toBeNull();
  });

  it.each(LEARNING_TASK_TYPES)("%s practice block is always Shape C", (taskType) => {
    for (const evidence of ROUTING_EVIDENCE_LEVELS) {
      const route = routeSession(input({ taskType, blockKind: "practice", evidence }));
      expect(route.shape).toBe("C");
      expect(route.ruleIds).toContain(`L1.${taskType}.practice`);
      expect(route.ruleIds).toContain("L2.practice_block");
    }
  });

  it("conflict rule 1: no profile answer produces Feynman on a calculus procedure", () => {
    for (const taskType of PROCEDURAL) {
      for (const single of everySingleAnswer()) {
        const route = routeSession(input({ taskType, answers: single.answers }));
        expect(route.methodName, single.label).not.toBe("Feynman Technique");
        expect(route.methodName, single.label).not.toBe("Concept Mapping");
        expect(["Worked Examples", "Practice Problems", "Active Recall"]).toContain(route.methodName);
      }
    }
  });
});

describe("Layer 2 — placement evidence decides the scaffolding level", () => {
  it.each([
    ["not_assessed", "study_full", "A"],
    ["gap", "study_full", "A"],
    ["demonstrated", "brief_review", "A"],
    ["learner_reported_covered", "skip_to_practice", "C"],
  ] as const)("%s → %s", (evidence, entry, shape) => {
    const route = routeSession(input({ evidence }));
    expect(route.entry).toBe(entry);
    expect(route.shape).toBe(shape);
    expect(route.ruleIds).toContain(`L2.${evidence}`);
    if (shape === "C") expect(route.ruleIds).toContain("L2.skip_learn_block_to_shape_c");
  });
});

describe("Layer 3 — produce step and entry point", () => {
  it("Q5 concrete_example shows a worked structure before producing", () => {
    const route = routeSession(input({ answers: answersOf({ difficulty_help: "concrete_example" }) }));
    expect(route.workedStructureBeforeProduce).toBe(true);
    expect(route.entry).toBe("study_full");
    expect(route.ruleIds).toContain("L3.q5.concrete_example");
  });

  it("Q5 step_by_step holds scaffolding one level higher and numbers the steps", () => {
    const route = routeSession(input({ evidence: "demonstrated", answers: answersOf({ difficulty_help: "step_by_step" }) }));
    expect(route.entry).toBe("study_full");
    expect(route.instructionStyle).toBe("numbered_steps");
    expect(route.ruleIds).toContain("L3.q5.step_by_step");
  });

  it("Q5 step_by_step pulls a learner-reported topic back to a brief review, one level only", () => {
    const route = routeSession(input({ evidence: "learner_reported_covered", answers: answersOf({ difficulty_help: "step_by_step" }) }));
    expect(route.shape).toBe("A");
    expect(route.entry).toBe("brief_review");
  });

  it("Q5 try_then_feedback produces before studying", () => {
    const route = routeSession(input({ answers: answersOf({ difficulty_help: "try_then_feedback" }) }));
    expect(route.produceBeforeStudy).toBe(true);
    expect(route.ruleIds).toContain("L3.q5.try_then_feedback");
  });

  it("Q5 simple_explanation is the Shape A default and mixed applies no modifier (conflict rule 5)", () => {
    const simple = routeSession(input({ answers: answersOf({ difficulty_help: "simple_explanation" }) }));
    const mixed = routeSession(input({ answers: answersOf({ difficulty_help: "mixed" }) }));
    const unanswered = routeSession(input());
    for (const route of [simple, mixed, unanswered]) {
      expect(route.entry).toBe("study_full");
      expect(route.produceBeforeStudy).toBe(false);
      expect(route.workedStructureBeforeProduce).toBe(false);
    }
    expect(simple.ruleIds).toContain("L3.q5.simple_explanation");
    expect(mixed.ruleIds).toContain("C5.q5_mixed_default");
  });

  it("conflict rule 3: across every evidence level Q5 moves the entry point by at most one level and never past independent", () => {
    for (const evidence of ROUTING_EVIDENCE_LEVELS) {
      const base = SHAPE_A_ENTRY_LEVELS.indexOf(routeSession(input({ evidence })).entry);
      for (const option of ["simple_explanation", "concrete_example", "step_by_step", "try_then_feedback", "mixed"]) {
        const moved = SHAPE_A_ENTRY_LEVELS.indexOf(routeSession(input({ evidence, answers: answersOf({ difficulty_help: option }) })).entry);
        expect(Math.abs(moved - base), `${evidence}/${option}`).toBeLessThanOrEqual(1);
        expect(moved).toBeLessThanOrEqual(2);
      }
    }
  });

  it.each([
    ["explain_back", "typed_explanation", "Feynman Technique"],
    ["map_it", "concept_map", "Concept Mapping"],
    ["answer_questions", "retrieval_questions", "Active Recall"],
  ] as const)("Q6 %s → %s shown as %s", (answer, produceStep, method) => {
    const route = routeSession(input({ answers: answersOf({ prove_knowing: answer }) }));
    expect(route.produceStep).toBe(produceStep);
    expect(route.methodName).toBe(method);
    expect(route.ruleIds).toContain(`L3.q6.${answer}`);
  });

  it("Q6 solve_it biases procedural topics to Practice Problems and falls back elsewhere (conflict rule 1)", () => {
    const procedural = routeSession(input({ taskType: "problem_solving", answers: answersOf({ prove_knowing: "solve_it" }) }));
    expect(procedural.produceStep).toBe("worked_solution");
    expect(procedural.methodName).toBe("Practice Problems");
    expect(procedural.ruleIds).toContain("L3.q6.solve_it");
    const conceptual = routeSession(input({ answers: answersOf({ prove_knowing: "solve_it" }) }));
    expect(conceptual.produceStep).toBe("typed_explanation");
    expect(conceptual.ruleIds).toContain("C1.layer1_wins.q6_solve_it");
  });

  it("Q6 unanswered falls back to the task type default (conflict rule 5)", () => {
    expect(routeSession(input()).ruleIds).toContain("C5.q6_unanswered_default");
    expect(routeSession(input({ taskType: "writing_argumentation" })).produceStep).toBe("outline");
    expect(routeSession(input({ taskType: "reading_to_quiz" })).methodName).toBe("SQ3R");
  });

  it("the outline variant ignores Q6 (conflict rule 1)", () => {
    const route = routeSession(input({ taskType: "writing_argumentation", answers: answersOf({ prove_knowing: "map_it" }) }));
    expect(route.produceStep).toBe("outline");
    expect(route.ruleIds).toContain("C1.layer1_wins.q6");
    expect(alternativeProduceSteps(route)).toEqual([]);
  });

  it("Q10 examples_before_ready acts like Q5 concrete_example when Q5 is silent", () => {
    const route = routeSession(input({ answers: answersOf({ extra_context: "examples_before_ready" }) }));
    expect(route.workedStructureBeforeProduce).toBe(true);
    expect(route.ruleIds).toContain("L3.q10.examples_before_ready");
    const explicit = routeSession(input({ answers: answersOf({ extra_context: "examples_before_ready", difficulty_help: "try_then_feedback" }) }));
    expect(explicit.workedStructureBeforeProduce).toBe(false);
    expect(explicit.produceBeforeStudy).toBe(true);
  });
});

describe("Layer 4 — modifiers never change the shape", () => {
  it.each([
    ["minutes_10_15", 15, 5],
    ["minutes_20_30", 25, 8],
    ["minutes_30_45", 40, 8],
    ["minutes_45_60", 55, 8],
    ["task_dependent", 25, 8],
  ] as const)("Q2 %s → %s minutes, cap %s", (answer, minutes, cap) => {
    const route = routeSession(input({ answers: answersOf({ session_length: answer }) }));
    expect(route.timerMinutes).toBe(minutes);
    expect(route.questionCap).toBe(cap);
    expect(route.ruleIds).toContain(`L4.q2.${answer}`);
  });

  it("Q3 often/very_often drop the timer one band and add stopping points", () => {
    for (const answer of ["often", "very_often"]) {
      const route = routeSession(input({ answers: answersOf({ session_length: "minutes_30_45", focus_loss: answer }) }));
      expect(route.timerMinutes).toBe(25);
      expect(route.stoppingPoints).toBe("after_each_step");
      expect(route.ruleIds).toContain(`L4.q3.${answer}`);
    }
    const steady = routeSession(input({ answers: answersOf({ session_length: "minutes_30_45", focus_loss: "rarely" }) }));
    expect(steady.timerMinutes).toBe(40);
    expect(steady.stoppingPoints).toBe("standard");
  });

  // Brief 1.5 item 2: task type decides the question-type mix, Q7 shifts one item.
  it.each([
    ["gist_leaning", "L4.q7.gist_leaning.mix_recall", { recall: 2, application: 1, compare_contrast: 1, prediction: 0, misconception: 1 }],
    ["detail_leaning", "L4.q7.detail_leaning.mix_compare_contrast", { recall: 1, application: 1, compare_contrast: 2, prediction: 0, misconception: 1 }],
  ] as const)("Q7 %s shifts the conceptual question mix (%s)", (answer, ruleId, mix) => {
    const route = routeSession(input({ taskType: "conceptual_learning", answers: answersOf({ gist_detail: answer }) }));
    expect(route.questionMix).toEqual(mix);
    expect(route.ruleIds).toEqual(expect.arrayContaining(["L4.mix.conceptual_learning", ruleId]));
  });

  it("Q7 balanced or unanswered keeps the task type's mix", () => {
    const balanced = routeSession(input({ taskType: "memorization", answers: answersOf({ gist_detail: "balanced" }) }));
    expect(balanced.questionMix).toEqual({ recall: 4, application: 0, compare_contrast: 0, prediction: 0, misconception: 1 });
    expect(balanced.ruleIds).toContain("L4.mix.memorization");
    expect(routeSession(input()).ruleIds.filter((id) => id.includes(".mix_"))).toEqual([]);
  });

  // Brief 1.5 item 3: which practice round a practice block opens with, by rule.
  it("a practice block opens with Active Recall by default and records the Error Repair rule", () => {
    const route = routeSession(input({ blockKind: "practice" }));
    expect(route.firstPracticeRound).toBe("active_recall");
    expect(route.methodName).toBe("Active Recall");
    expect(route.ruleIds).toEqual(expect.arrayContaining(["L4.practice.active_recall.default", "L4.practice.error_repair.after_missed_round"]));
  });

  it("a deadline within three days makes it a Practice Test", () => {
    const route = routeSession(input({ blockKind: "practice", daysToDeadline: 2.5 }));
    expect(route.firstPracticeRound).toBe("practice_test");
    expect(route.methodId).toBe("practice_test_error_repair");
    expect(route.methodName).toBe("Practice Test");
    expect(route.ruleIds).toContain("L4.practice.practice_test.deadline_within_3_days");
    expect(routeSession(input({ blockKind: "practice", daysToDeadline: 3.5 })).firstPracticeRound).toBe("active_recall");
    expect(routeSession(input({ blockKind: "practice", daysToDeadline: -1 })).firstPracticeRound).toBe("active_recall");
  });

  it("two or more related topics that each passed once make it an Interleaved Review", () => {
    const route = routeSession(input({ blockKind: "practice", passedRelatedTopicIds: ["t1", "t2"] }));
    expect(route.firstPracticeRound).toBe("interleaved_review");
    expect(route.methodId).toBe("interleaved_practice");
    expect(route.methodName).toBe("Interleaved Review");
    expect(route.ruleIds).toContain("L4.practice.interleaved_review.related_topics_passed");
    expect(routeSession(input({ blockKind: "practice", passedRelatedTopicIds: ["t1"] })).firstPracticeRound).toBe("active_recall");
  });

  it("the Practice Test wins when both could fire, and says so", () => {
    const route = routeSession(input({ blockKind: "practice", daysToDeadline: 1, passedRelatedTopicIds: ["t1", "t2"] }));
    expect(route.firstPracticeRound).toBe("practice_test");
    expect(route.ruleIds).toEqual(expect.arrayContaining(["L4.practice.practice_test.deadline_within_3_days", "C7.practice_test_over_interleaved"]));
    expect(route.ruleIds).not.toContain("L4.practice.interleaved_review.related_topics_passed");
  });

  it("a learn block's questions stay Active Recall", () => {
    const route = routeSession(input({ taskType: "memorization", blockKind: "learn", daysToDeadline: 1, passedRelatedTopicIds: ["t1", "t2"] }));
    expect(route.shape).toBe("C");
    expect(route.firstPracticeRound).toBe("active_recall");
    expect(route.ruleIds).not.toContain("L4.practice.practice_test.deadline_within_3_days");
  });

  // Brief 1.5 item 4: deterministic topic difficulty; only the high band changes anything.
  it("low and medium difficulty keep a five-question round and record the band", () => {
    const low = routeSession(input({ subtopicCount: 1, prerequisiteDepth: 0 }));
    expect(low.questionTarget).toBe(5);
    expect(low.ruleIds).toContain("L4.difficulty.low");
    expect(routeSession(input({ subtopicCount: 3, prerequisiteDepth: 1 })).ruleIds).toContain("L4.difficulty.medium");
  });

  it("high difficulty asks eight questions, raising the cap past a shorter-sections clamp", () => {
    const route = routeSession(input({ subtopicCount: 4, prerequisiteDepth: 3, answers: answersOf({ support_needs: ["shorter_sections"] }) }));
    expect(route.questionTarget).toBe(8);
    expect(route.questionCap).toBe(8);
    expect(route.ruleIds).toEqual(expect.arrayContaining(["L4.difficulty.high", "L4.difficulty.high.more_questions", "C8.difficulty_over_question_clamp"]));
  });

  it("high difficulty without a clamp records no conflict", () => {
    const route = routeSession(input({ subtopicCount: 6, prerequisiteDepth: 0, answers: answersOf({ session_length: "minutes_45_60" }) }));
    expect(route.questionCap).toBe(8);
    expect(route.ruleIds).not.toContain("C8.difficulty_over_question_clamp");
  });

  it("Q9 shorter_sections trims the timer and caps questions at five", () => {
    const route = routeSession(input({ answers: answersOf({ session_length: "minutes_45_60", support_needs: ["shorter_sections"] }) }));
    expect(route.timerMinutes).toBe(41);
    expect(route.questionCap).toBe(5);
    expect(route.ruleIds).toContain("L4.q9.shorter_sections");
  });

  it("Q9 reduced_text_visual_structure overrides Q6 (conflict rule 2)", () => {
    const route = routeSession(input({ answers: answersOf({ prove_knowing: "explain_back", support_needs: ["reduced_text_visual_structure"] }) }));
    expect(route.produceStep).toBe("concept_map");
    expect(route.methodName).toBe("Concept Mapping");
    expect(route.ruleIds).toContain("L3.q6.explain_back");
    expect(route.ruleIds).toContain("C2.q9_visual_overrides_q6");
  });

  it("Q9 extra_reading_time extends the timer and removes pace prompts", () => {
    const route = routeSession(input({ answers: answersOf({ session_length: "minutes_20_30", support_needs: ["extra_reading_time"] }) }));
    expect(route.timerMinutes).toBe(31);
    expect(route.pacePrompts).toBe(false);
  });

  it("Q9 simpler_repeated_instructions and frequent_check_ins change delivery only", () => {
    const route = routeSession(input({ answers: answersOf({ support_needs: ["simpler_repeated_instructions", "frequent_check_ins"] }) }));
    expect(route.instructionStyle).toBe("plain_restated");
    expect(route.stoppingPoints).toBe("after_each_step");
    expect(route.shape).toBe("A");
  });

  it("Q1 sets the preferred window; 'It changes' sets none", () => {
    expect(routeSession(input({ answers: answersOf({ energy_window: "evening" }) })).preferredWindow).toEqual({ learn: "evening", practice: "off_peak" });
    expect(routeSession(input({ answers: answersOf({ energy_window: "varies" }) })).preferredWindow).toBeNull();
  });

  it("Q10 forget_during_tests adds a practice round; long_plan_shutdown collapses the queue", () => {
    expect(routeSession(input({ answers: answersOf({ extra_context: "forget_during_tests" }) })).practiceRoundCeiling).toBe(4);
    expect(routeSession(input({ answers: answersOf({ extra_context: "long_plan_shutdown" }) })).homeQueueCollapsed).toBe(true);
    expect(routeSession(input()).practiceRoundCeiling).toBe(3);
  });

  it("conflict rule 4: timer modifiers stack but clamp to 10–60", () => {
    const low = routeSession(input({ answers: answersOf({ session_length: "minutes_10_15", focus_loss: "very_often", support_needs: ["shorter_sections"] }) }));
    expect(low.timerMinutes).toBe(11);
    const floor = routeSession(input({ answers: answersOf({ session_length: "minutes_10_15", support_needs: ["shorter_sections", "shorter_sections"] }) }));
    expect(floor.timerMinutes).toBe(11);
    const high = routeSession(input({ answers: answersOf({ session_length: "minutes_45_60", support_needs: ["extra_reading_time"] }) }));
    expect(high.timerMinutes).toBe(60);
    expect(high.ruleIds).toContain("C4.timer_clamp");
  });

  it("no Layer 4 answer changes the shape", () => {
    for (const question of ONBOARDING_QUESTIONS.filter((candidate) => ["energy_window", "session_length", "focus_loss", "gist_detail", "support_needs", "extra_context"].includes(candidate.id))) {
      for (const option of question.options) {
        if (option.id === "examples_before_ready") continue;
        const answers = answersOf(question.id === "support_needs" ? { support_needs: [option.id] } : { [question.id]: option.id });
        for (const taskType of LEARNING_TASK_TYPES) {
          expect(routeSession(input({ taskType, answers })).shape, `${question.id}=${option.id}`).toBe(routeSession(input({ taskType })).shape);
        }
      }
    }
  });
});

describe("Layer 5 — what the learner sees", () => {
  it.each([
    ["exact_guidance", "silent"],
    ["structured_flexibility", "change_link"],
    ["learner_choice", "chooser"],
  ] as const)("Q4 %s → %s", (answer, visibility) => {
    const route = routeSession(input({ answers: answersOf({ guidance: answer }) }));
    expect(route.visibility).toBe(visibility);
    expect(route.ruleIds).toContain(`L5.q4.${answer}`);
  });

  it("defaults to a visible Change method link when unanswered", () => {
    const route = routeSession(input());
    expect(route.visibility).toBe("change_link");
    expect(route.ruleIds).toContain("L5.q4.unanswered_default");
  });
});

describe("Change method alternatives", () => {
  it("offers the other Shape A produce steps without changing the shape", () => {
    expect(alternativeProduceSteps(routeSession(input({ answers: answersOf({ prove_knowing: "map_it" }) })))).toEqual(["typed_explanation", "retrieval_questions"]);
    expect(alternativeProduceSteps(routeSession(input({ taskType: "problem_solving" })))).toEqual(["concept_map", "retrieval_questions", "worked_solution"]);
    expect(alternativeProduceSteps(routeSession(input({ blockKind: "practice" })))).toEqual([]);
  });
});

// Brief 1.5 item 8: outside YOVA is directions, then "I'm back", then straight to practice.
describe("studying outside YOVA", () => {
  it("turns a learn block into directions then closed-book practice, with no produce step or explanation", () => {
    const inside = routeSession(input({ hasSource: false, answers: answersOf({ prove_knowing: "map_it", difficulty_help: "concrete_example" }) }));
    const outside = withStudyOutside(inside);
    expect(outside.learnPath).toBe("outside");
    expect(outside.produceStep).toBe("retrieval_questions");
    expect(outside.workedStructureBeforeProduce).toBe(false);
    expect(outside.produceBeforeStudy).toBe(false);
    expect(outside.explanationFocus).toBeNull();
    expect(outside.methodName).toBe(CORE_METHOD_CATALOG.retrieval_practice.name);
    expect(outside.ruleIds).toContain("L5.learner_study_outside");
    expect(alternativeProduceSteps(outside)).toEqual([]);
  });

  it("drops the decisions the outside path no longer carries out, so nothing claims them", () => {
    const outside = withStudyOutside(routeSession(input({ answers: answersOf({ prove_knowing: "map_it", difficulty_help: "concrete_example", support_needs: ["reduced_text_visual_structure"] }) })));
    for (const gone of ["L3.q6.map_it", "L3.q5.concrete_example", "C2.q9_visual_overrides_q6"]) expect(outside.ruleIds).not.toContain(gone);
    expect(outside.ruleIds).toContain("L4.q2.unanswered");
  });

  it("a memorization learn block's brief study step also becomes outside directions", () => {
    const outside = withStudyOutside(routeSession(input({ taskType: "memorization" })));
    expect(outside.shape).toBe("A");
    expect(outside.briefStudyStep).toBe(false);
    expect(outside.learnPath).toBe("outside");
  });

  it("leaves practice blocks and skipped learn blocks alone", () => {
    const practice = routeSession(input({ blockKind: "practice" }));
    expect(withStudyOutside(practice)).toBe(practice);
    const covered = routeSession(input({ evidence: "learner_reported_covered" }));
    expect(withStudyOutside(covered)).toBe(covered);
  });
});

// Brief 1.5 item 8: "I've already covered this" makes the block practice, for every shape.
describe("a covered memorization learn block", () => {
  it("skips the brief study step and goes straight to closed-book practice", () => {
    const covered = routeSession(input({ taskType: "memorization", evidence: "learner_reported_covered" }));
    expect(covered.shape).toBe("C");
    expect(covered.briefStudyStep).toBe(false);
    expect(covered.learnPath).toBeNull();
    const notCovered = routeSession(input({ taskType: "memorization" }));
    expect(notCovered.briefStudyStep).toBe(true);
  });
});

