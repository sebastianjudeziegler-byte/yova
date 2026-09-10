import type { RoutingDecision, SessionRoute } from "@/lib/routing/session-route";

/**
 * The one-sentence personalization note on the session end screen: what
 * changed and why, drawn from the rule ID that fired. Rule IDs are ranked so
 * the most visible profile-driven change is the one named; the sentence is a
 * template per rule, never model text.
 */
export type PersonalizationNote = {
  ruleId: string;
  sentence: string;
};

const NOTE_TEMPLATES: ReadonlyArray<[prefix: string, sentence: (decision: RoutingDecision) => string]> = [
  ["C2.q9_visual_overrides_q6", () => "Because you asked for less text and more visual structure, you built a concept map instead of writing an explanation."],
  ["L3.q5.concrete_example", () => "Because you said a concrete example helps most, YOVA showed the structure before asking you to produce."],
  ["L3.q10.examples_before_ready", () => "Because you said you need examples before you feel ready, YOVA showed the structure before asking you to produce."],
  ["L3.q5.try_then_feedback", () => "Because you said trying first helps most, you produced before studying and then compared."],
  ["L3.q5.step_by_step", () => "Because you asked for step-by-step instructions, YOVA held the scaffolding one level higher and numbered the steps."],
  ["L3.q6.explain_back", () => "Because you prove knowledge by explaining, this session used the Feynman Technique."],
  ["L3.q6.map_it", () => "Because you prove knowledge by mapping, this session used Concept Mapping."],
  ["L3.q6.answer_questions", () => "Because you prove knowledge by answering questions, this session went straight to Active Recall."],
  ["L3.q6.solve_it", () => "Because you prove knowledge by solving, this session used Practice Problems after the worked example."],
  ["L4.q9.shorter_sections", (decision) => `Because you asked for shorter sections, the timer was trimmed to ${decision.value} minutes and practice capped at five questions.`],
  ["L4.q9.extra_reading_time", () => "Because you asked for extra reading time, the timer was extended and pace prompts were switched off."],
  ["L4.q9.simpler_repeated_instructions", () => "Because you asked for simpler instructions, each step restated the task in plain language."],
  ["L4.q9.frequent_check_ins", () => "Because you asked for frequent check-ins, YOVA paused at an explicit stopping point after each step."],
  ["L4.q3.very_often", () => "Because you lose focus very often, the timer dropped one band and stopping points were added."],
  ["L4.q3.often", () => "Because you lose focus often, the timer dropped one band and stopping points were added."],
  ["L4.q7.gist_leaning", () => "Because you catch the big picture but miss specifics, practice put definitions and terms first."],
  ["L4.q7.detail_leaning", () => "Because you know the details but lose how they fit, practice put compare-and-contrast items first."],
  ["L4.q10.forget_during_tests", () => "Because you forget during tests, this topic gets one extra practice round with tighter spacing."],
  ["L2.learner_reported_covered", () => "Because you marked this topic as already covered, YOVA skipped the learn block and went straight to practice."],
  ["L2.demonstrated", () => "Because the placement check showed you already know this, YOVA kept the review brief before asking you to produce."],
  ["L4.q2.minutes_10_15", () => "Because you said short sessions are realistic, the timer started at fifteen minutes."],
  ["L4.q2.minutes_45_60", () => "Because you said long sessions are realistic, the timer started at fifty-five minutes."],
  ["L5.q4.exact_guidance", () => "Because you asked to be told exactly what to do, YOVA applied the method without a chooser."],
  ["L5.q4.learner_choice", () => "Because you asked to decide, YOVA offered the method choice with its pick pre-selected."],
  ["L1.temporary.shape_b_not_built", () => "This procedural topic used a worked example as its source; the full worked-example route arrives in Week 2."],
];

export function personalizationNote(route: SessionRoute): PersonalizationNote {
  for (const [prefix, sentence] of NOTE_TEMPLATES) {
    const decision = route.decisions.find((candidate) => candidate.ruleId === prefix);
    if (decision) return { ruleId: decision.ruleId, sentence: sentence(decision) };
  }
  const layerOne = route.decisions.find((decision) => decision.layer === 1);
  return {
    ruleId: layerOne?.ruleId ?? "C6.rule_ids_recorded",
    sentence: `This session followed the ${route.methodName} default for this kind of topic; answer the profile questions in You to change how sessions run.`,
  };
}
