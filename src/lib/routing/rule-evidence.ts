import { describeQuestionMix } from "@/lib/practice/question-mix";
import type { LearningTaskType } from "@/lib/learning/method-catalog";
import type { RoutingDecision, SessionRoute } from "@/lib/routing/session-route";

/**
 * What the learner may be told about why a session runs the way it does
 * (Brief 1.5 items 6 and 7). Every entry is a template on a rule that fired,
 * never model text: the end-screen note, the hub's "chosen because" pills and
 * the reason half of each tip all read from here.
 */
export type RuleEvidence = {
  ruleId: string;
  /** Short head for a pill, e.g. "you prove knowledge by mapping". */
  head: string;
  /** One sentence. */
  sentence: string;
};

export type HappenedInSession = {
  /** false when the session could not show a worked example; omit before a session has run. */
  exampleShown?: boolean;
};

type Template = [prefix: string, sentence: (decision: RoutingDecision, route: SessionRoute) => string];

/** Ranked: the first that fired is the end-screen personalization note. */
export const NOTE_TEMPLATES: ReadonlyArray<Template> = [
  ["C2.q9_visual_overrides_q6", () => "Because you asked for less text and more visual structure, you built a concept map instead of writing an explanation."],
  ["L3.q5.concrete_example", () => "Because you said a concrete example helps most, YOVA showed a worked example before asking you to produce."],
  ["L3.q10.examples_before_ready", () => "Because you said you need examples before you feel ready, YOVA showed a worked example before asking you to produce."],
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
  ["L4.q7.gist_leaning.mix_recall", () => "Because you catch the big picture but miss specifics, practice asked one more question about a specific fact."],
  ["L4.q7.detail_leaning.mix_compare_contrast", () => "Because you know the details but lose how they fit, practice asked one more question comparing two ideas."],
  ["L4.q10.forget_during_tests", () => "Because you forget during tests, this topic gets one extra practice round with tighter spacing."],
  ["L2.learner_reported_covered", () => "Because you marked this topic as already covered, YOVA skipped the learn block and went straight to practice."],
  ["L2.demonstrated", () => "Because the placement check showed you already know this, YOVA kept the review brief before asking you to produce."],
  ["L4.q2.minutes_10_15", () => "Because you said short sessions are realistic, the timer started at fifteen minutes."],
  ["L4.q2.minutes_45_60", () => "Because you said long sessions are realistic, the timer started at fifty-five minutes."],
  ["L5.q4.exact_guidance", () => "Because you asked to be told exactly what to do, YOVA applied the method without a chooser."],
  ["L5.q4.learner_choice", () => "Because you asked to decide, YOVA offered the method choice with its pick pre-selected."],
  ["L1.temporary.shape_b_not_built", () => "Because the full worked-example route arrives in Week 2, this procedural topic used a worked example as its source."],
];

const TASK_TYPE_PHRASE: Record<LearningTaskType, string> = {
  memorization: "this topic is for memorizing",
  conceptual_learning: "this is a conceptual topic",
  problem_solving: "this topic is problem solving",
  reading_to_quiz: "this is reading for a quiz",
  writing_argumentation: "this topic is written argument",
  programming: "this topic is programming",
  mixed_assessment: "this topic is assessed several ways",
};

/** Practice and question-mix rules: routing evidence the hub and tips may name, never the end note. */
const PRACTICE_TEMPLATES: ReadonlyArray<Template> = [
  ["L4.practice.practice_test.deadline_within_3_days", () => "Because your deadline is within three days, practice runs as a longer exam-style Practice Test."],
  ["C7.practice_test_over_interleaved", () => "Because the exam is close, the Practice Test comes before mixing in related topics."],
  ["L4.practice.interleaved_review.related_topics_passed", () => "Because you have passed related topics once each, practice mixes them and asks which idea applies."],
  ["L4.practice.active_recall.default", () => "Because recall comes before review, practice opens with closed-book Active Recall on this topic."],
  ["L4.practice.error_repair.after_missed_round", () => "Because a missed point needs another try, a round after a miss covers only what you missed."],
  ["L4.mix.", (decision, route) => `Because ${TASK_TYPE_PHRASE[route.input.taskType]}, practice asks ${describeQuestionMix(route.questionMix)} questions.`],
];

/** Rules whose sentence claims an example was shown. */
export const EXAMPLE_CLAIM_RULE_IDS = new Set(["L3.q5.concrete_example", "L3.q10.examples_before_ready"]);

function headOf(sentence: string) {
  return sentence.match(/^Because (.+?), /)?.[1] ?? sentence;
}

function matches(prefix: string, ruleId: string) {
  return prefix.endsWith(".") ? ruleId.startsWith(prefix) : ruleId === prefix;
}

function entriesFor(templates: ReadonlyArray<Template>, route: SessionRoute, happened: HappenedInSession) {
  return templates.flatMap(([prefix, sentence]) => {
    if (happened.exampleShown === false && EXAMPLE_CLAIM_RULE_IDS.has(prefix)) return [];
    const decision = route.decisions.find((candidate) => matches(prefix, candidate.ruleId));
    if (!decision) return [];
    const text = sentence(decision, route);
    return [{ ruleId: decision.ruleId, head: headOf(text), sentence: text }];
  });
}

/** Personalization-note rules first (in note rank), then practice and mix rules. Never topic difficulty. */
export function ruleEvidence(route: SessionRoute, happened: HappenedInSession = {}): RuleEvidence[] {
  return [...entriesFor(NOTE_TEMPLATES, route, happened), ...entriesFor(PRACTICE_TEMPLATES, route, happened)];
}

/** Only the end-note candidates. */
export function noteEvidence(route: SessionRoute, happened: HappenedInSession = {}): RuleEvidence[] {
  return entriesFor(NOTE_TEMPLATES, route, happened);
}

/** When no profile rule fired: the task default, on the Layer 1 rule. */
export function defaultEvidence(route: SessionRoute): RuleEvidence {
  const layerOne = route.decisions.find((decision) => decision.layer === 1);
  return {
    ruleId: layerOne?.ruleId ?? "C6.rule_ids_recorded",
    head: "the default for this kind of topic",
    sentence: `This session followed the ${route.methodName} default for this kind of topic; answer the profile questions in You to change how sessions run.`,
  };
}

/** The hub's "chosen because" pills: one per reason, head only. */
export function chosenBecause(route: SessionRoute, happened: HappenedInSession = {}) {
  const evidence = ruleEvidence(route, happened);
  const profile = noteEvidence(route, happened);
  const pills = (profile.length ? evidence : [defaultEvidence(route), ...evidence]);
  return pills.map(({ ruleId, head }) => ({ ruleId, head }));
}
