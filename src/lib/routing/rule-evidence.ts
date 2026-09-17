import { describeQuestionMix } from "@/lib/practice/question-mix";
import type { LearningTaskType } from "@/lib/learning/method-catalog";
import { alternativeProduceSteps, type RoutingDecision, type SessionRoute } from "@/lib/routing/session-route";

/**
 * What the learner may be told about why a session runs the way it does
 * (Brief 1.5 items 6 and 7). Every entry is a template on a rule that fired,
 * never model text: the end-screen note, the hub's "chosen because" pills, the
 * reason half of each tip and the end receipt all read from here.
 *
 * Item 7: if a routing rule fired, the learner can see it somewhere. The end
 * receipt names every fired rule except HIDDEN_RULE_IDS (the topic difficulty
 * band), whose effect, the question count, is named instead.
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
  /** Omit for a preview; set from the actual round/answer history for a receipt. */
  practiceOccurred?: boolean;
  repairRoundOccurred?: boolean;
  /** A missed round currently offers a retry; this is not evidence that it ran. */
  repairRoundAvailable?: boolean;
  /** Explicit check-in copy was displayed, rather than a routing flag alone. */
  checkInsShown?: boolean;
};

/** A rule ID, or a family: a trailing dot matches by prefix, a RegExp matches the whole ID. */
type Template = [match: string | RegExp, sentence: (decision: RoutingDecision, route: SessionRoute) => string];

/** Ranked: the first that fired is the end-screen personalization note. */
export const NOTE_TEMPLATES: ReadonlyArray<Template> = [
  ["C2.q9_visual_overrides_q6", () => "Because you asked for less text and more visual structure, you built a concept map instead of writing an explanation."],
  ["L3.q5.concrete_example", () => "Because you said a concrete example helps most, YOVA showed a worked example before asking you to produce."],
  ["L3.q10.examples_before_ready", () => "Because you said you need examples before you feel ready, YOVA showed a worked example before asking you to produce."],
  ["L3.q5.try_then_feedback", () => "Because you said trying first helps most, you produced before studying and then compared."],
  ["L3.q5.step_by_step", () => "Because you asked for step-by-step instructions, YOVA held the scaffolding one level higher and numbered the steps."],
  ["L3.q6.explain_back", () => "Because you prove knowledge by explaining, this session used the Feynman Technique."],
  ["L3.q6.map_it", () => "Because you prove knowledge by mapping, this session used Concept Mapping."],
  ["L3.q6.answer_questions", () => "Because you prove knowledge by answering questions, this session uses Active Recall for practice."],
  ["L3.q6.solve_it", () => "Because you prove knowledge by solving, this session uses Practice Problems."],
  ["L4.q9.shorter_sections", (_decision, route) => `Because you asked for shorter sections, this block uses a ${route.timerMinutes}-minute estimate and a smaller workload.`],
  ["L4.q9.extra_reading_time", () => "Because you asked for extra reading time, the reading allowance is extended and timer nudges are switched off."],
  ["L4.q9.simpler_repeated_instructions", () => "Because you asked for simpler instructions, each step restated the task in plain language."],
  ["L4.q9.frequent_check_ins", () => "Because you asked for frequent check-ins, YOVA offered an explicit stopping point after each step."],
  ["L4.q3.very_often", (_decision, route) => `Because you lose focus very often, the session uses a shorter workload allowance and a ${route.timerMinutes}-minute estimate.`],
  ["L4.q3.often", (_decision, route) => `Because you lose focus often, the session uses a shorter workload allowance and a ${route.timerMinutes}-minute estimate.`],
  ["L4.q7.gist_leaning.mix_recall", () => "Because you catch the big picture but miss specifics, the question mix gives extra weight to recalling specific facts."],
  ["L4.q7.detail_leaning.mix_compare_contrast", () => "Because you know the details but lose how they fit, the question mix gives extra weight to comparing ideas."],
  ["L4.q10.forget_during_tests", () => "Because you forget during tests, an extra retry is available if a point still needs practice."],
  ["L2.learner_reported_covered", () => "Because you marked this topic as already covered, YOVA skipped the learn block and went straight to practice."],
  ["L2.demonstrated", () => "Because the placement check showed you already know this, YOVA kept the review brief before asking you to produce."],
  ["L4.q2.minutes_10_15", (_decision, route) => `Because you said short sessions are realistic, the session uses a ${route.timerMinutes}-minute estimate within your allowance.`],
  ["L4.q2.minutes_45_60", (_decision, route) => `Because you said long sessions are realistic, the session uses a ${route.timerMinutes}-minute estimate within your allowance.`],
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
  ["L5.learner_study_outside", () => "Because you chose to study outside YOVA, YOVA gave directions and then went straight to practice."],
  [/^L5\.learner_change_method\./, (_decision, route) => `Because you chose it, this session used ${route.methodName}.`],
  ["L4.mix.", (decision, route) => `Because ${TASK_TYPE_PHRASE[route.input.taskType]}, practice asks ${describeQuestionMix(route.questionMix)} questions.`],
];

/** Where each task type's session comes from: the Layer 1 rule, on the receipt. */
const LAYER_ONE_SENTENCE: Record<string, string> = {
  "L1.conceptual_learning.learn": "Because this is a conceptual topic, the session studies, produces, compares and repairs.",
  "L1.memorization.learn": "Because this topic is for memorizing, the session practises closed-book after a brief study step.",
  "L1.reading_to_quiz.learn": "Because this is reading for a quiz, the session uses the SQ3R reading method.",
  "L1.writing_argumentation.learn": "Because this topic is written argument, the session builds the argument from memory before checking it.",
  "L1.problem_solving.learn": "Because this topic is problem solving, you learn from a worked example.",
  "L1.programming.learn": "Because this topic is programming, you learn by tracing a worked example.",
  "L1.mixed_assessment.learn.problems": "Because this mixed topic has problems, you learn from a worked example.",
  "L1.mixed_assessment.learn": "Because this topic is assessed several ways, the session studies, produces, compares and repairs.",
};

const SESSION_LENGTH_PHRASE: Record<string, string> = { minutes_20_30: "twenty to thirty minute", minutes_30_45: "thirty to forty-five minute" };
const ENERGY_PHRASE: Record<string, string> = { morning: "in the morning", afternoon: "in the afternoon", evening: "in the evening", late_night: "late at night" };

/** Everything else that can fire: named on the end receipt only, not as pills or tips. */
const DETAIL_TEMPLATES: ReadonlyArray<Template> = [
  [/^L1\.[a-z_]+\.learn(\.problems)?$/, (decision, route) => route.produceStep === "retrieval_questions" ? "Because of this topic and the selected method, the session studies and then practises without the source." : LAYER_ONE_SENTENCE[decision.ruleId] ?? "Because of the kind of topic this is, the session follows its usual shape."],
  [/^L1\.[a-z_]+\.practice$/, () => "Because this is a practice block, it is closed-book practice for any kind of topic."],
  ["L2.practice_block", () => "Because this is a practice block, it starts straight at the questions."],
  ["L2.not_assessed", (_decision, route) => `Because YOVA has not assessed this topic yet, you study it before ${route.produceStep === "retrieval_questions" ? "answering questions" : "producing"}.`],
  ["L2.gap", (_decision, route) => `Because the placement check found a gap, you study it before ${route.produceStep === "retrieval_questions" ? "answering questions" : "producing"}.`],
  [/^L2\.[a-z_]+\.shape_c$/, () => "Because this kind of topic practises directly, what YOVA knows about it only changes the brief study step."],
  ["L2.skip_learn_block_to_shape_c", () => "Because the learn block was skipped, this session is closed-book practice."],
  ["L3.q5.simple_explanation", () => "Because you said a simple explanation helps most, the session keeps its study-first order."],
  ["C5.q5_mixed_default", () => "Because you said a mixture helps most, the session keeps this topic's usual order."],
  ["C3.q5_one_level_only", () => "Because a preference can move where the session starts by one step only, YOVA moved it one step."],
  ["L3.variant.outline_fixed", () => "Because this topic is written argument, you outline the claim and its structure from memory."],
  ["C1.layer1_wins.q6", () => "Because this kind of topic fixes how you show what you know, your proof preference did not change the produce step."],
  ["C1.layer1_wins.q6_solve_it", () => "Because this topic has no problems to solve, the session kept its usual produce step."],
  ["C5.q6_unanswered_default", () => "Because you have not said how you prove you know something, the session used this topic's usual produce step."],
  [/^L4\.q2\.minutes_(20_30|30_45)$/, (decision, route) => `Because you said ${SESSION_LENGTH_PHRASE[decision.ruleId.slice("L4.q2.".length)]} sessions are realistic, this block uses a ${route.timerMinutes}-minute estimate within your allowance.`],
  ["L4.q2.task_dependent", (_decision, route) => `Because you said session length depends on the task, this block uses a ${route.timerMinutes}-minute estimate.`],
  ["L4.q2.unanswered", (_decision, route) => `Because no session length is saved, this block uses a ${route.timerMinutes}-minute estimate.`],
  ["L4.q2.short_band_question_cap", (_decision, route) => `Because you said short sessions are realistic, this block contains ${route.questionTarget} planned practice questions.`],
  [/^L4\.q3\.(rarely|sometimes)$/, (decision) => `Because you ${decision.ruleId.endsWith("rarely") ? "rarely" : "sometimes"} lose focus, no additional focus-loss reduction applies.`],
  ["L4.q9.reduced_text_visual_structure", () => "Because you asked for less text and more visual structure, YOVA noted it, and this block has no writing step to change."],
  [/^L4\.q1\.(morning|afternoon|evening|late_night)$/, (decision) => `Because your energy is highest ${ENERGY_PHRASE[decision.ruleId.slice("L4.q1.".length)]}, YOVA proposes learn blocks then and practice at other times.`],
  ["L4.q10.long_plan_shutdown", () => "Because long plans make you shut down, Home shows only your next block."],
  ["C4.timer_clamp", (_decision, route) => `Because the session must fit its allowed range, this block uses a ${route.timerMinutes}-minute estimate.`],
  ["L4.timer_resolved", (_decision, route) => `Because the timer is a guide rather than a limit, it is set to ${route.timerMinutes} minutes and never stops you.`],
  // Founder decision (16 Sept 2026): the difficulty band stays hidden; its effect is named.
  ["L4.difficulty.high.more_questions", (_decision, route) => `Practice in this block contains ${route.questionTarget} questions before any missed-point retry.`],
  ["C8.difficulty_over_question_clamp", (_decision, route) => `The planned first round contains ${route.questionTarget} questions to cover this topic.`],
  [/^L5\.q4\.(structured_flexibility|unanswered_default)$/, (decision, route) => `Because ${decision.ruleId.endsWith("structured_flexibility") ? "you asked for clear structure with flexibility" : "no guidance preference is saved"}, YOVA applied its pick${alternativeProduceSteps(route).length ? " and offered a change before you start" : ""}.`],
  ["C6.rule_ids_recorded", (_decision, route) => `YOVA recorded every decision behind this session, which ran ${route.methodName}.`],
];

/** Never named to the learner; its effect is (founder decision, 16 Sept 2026). */
export const HIDDEN_RULE_IDS: ReadonlySet<string> = new Set(["L4.difficulty.low", "L4.difficulty.medium", "L4.difficulty.high"]);

/** Rules whose sentence claims an example was shown. */
export const EXAMPLE_CLAIM_RULE_IDS = new Set(["L3.q5.concrete_example", "L3.q10.examples_before_ready"]);

function headOf(sentence: string) {
  return sentence.match(/^Because (.+?), /)?.[1] ?? sentence;
}

function matches(match: string | RegExp, ruleId: string) {
  if (match instanceof RegExp) return match.test(ruleId);
  return match.endsWith(".") ? ruleId.startsWith(match) : ruleId === match;
}

function entriesFor(templates: ReadonlyArray<Template>, route: SessionRoute, happened: HappenedInSession) {
  return templates.flatMap(([match, sentence]) => {
    if (happened.exampleShown === false && typeof match === "string" && EXAMPLE_CLAIM_RULE_IDS.has(match)) return [];
    const decision = route.decisions.find((candidate) => matches(match, candidate.ruleId));
    if (!decision || !effectiveRule(decision.ruleId, route, happened)) return [];
    let text = sentence(decision, route);
    if (EXAMPLE_CLAIM_RULE_IDS.has(decision.ruleId) && happened.exampleShown === undefined) text = `Because ${decision.ruleId.includes("q10") ? "you said you need examples before feeling ready" : "you said a concrete example helps most"}, this session includes a worked-example step when the material supports one.`;
    return [{ ruleId: decision.ruleId, head: headOf(text), sentence: text }];
  });
}

/** A fired rule can be overridden later; it is not evidence that its action ran. */
function effectiveRule(id: string, route: SessionRoute, happened: HappenedInSession) {
  const practice = happened.practiceOccurred ?? (route.shape === "C" || route.produceStep === "retrieval_questions");
  if ((id.startsWith("L4.practice.") || id.startsWith("L4.mix.") || id.startsWith("L4.q7.") || id === "L4.q10.forget_during_tests" || id.startsWith("C7.") || id.startsWith("C8.") || id === "L4.difficulty.high.more_questions" || id === "L4.q2.short_band_question_cap") && !practice) return false;
  if (id === "L4.practice.error_repair.after_missed_round" && happened.repairRoundOccurred === false && !happened.repairRoundAvailable) return false;
  if (id === "L3.q5.try_then_feedback" && (!route.produceBeforeStudy || route.produceStep === "retrieval_questions")) return false;
  if (EXAMPLE_CLAIM_RULE_IDS.has(id) && (!route.workedStructureBeforeProduce || route.produceStep === "retrieval_questions")) return false;
  const produced: Record<string, string> = { "L3.q6.explain_back": "typed_explanation", "L3.q6.map_it": "concept_map", "L3.q6.answer_questions": "retrieval_questions", "L3.q6.solve_it": "worked_solution", "C2.q9_visual_overrides_q6": "concept_map" };
  if (id in produced && route.produceStep !== produced[id]) return false;
  if (id === "L4.q9.frequent_check_ins" && happened.checkInsShown === false) return false;
  // These are plan/home claims, not actions observable in this session.
  if (id.startsWith("L4.q1.") || id === "L4.q10.long_plan_shutdown") return false;
  if ((id === "L2.not_assessed" || id === "L2.gap" || id === "L3.q5.simple_explanation") && route.produceBeforeStudy) return false;
  return true;
}

/** For an examples-first learner the session could not show an example: the reason, without the claim. */
const EXAMPLE_NOT_SHOWN: Record<string, string> = {
  "L3.q5.concrete_example": "Because you said a concrete example helps most, the session included an example step, but you continued without an example being shown.",
  "L3.q10.examples_before_ready": "Because you said you need examples before you feel ready, the session included an example step, but you continued without an example being shown.",
};

/** Personalization-note rules first (in note rank), then practice and mix rules. Never topic difficulty. */
export function ruleEvidence(route: SessionRoute, happened: HappenedInSession = {}): RuleEvidence[] {
  return [...entriesFor(NOTE_TEMPLATES, route, happened), ...entriesFor(PRACTICE_TEMPLATES, route, happened)];
}

/** Only the end-note candidates. */
export function noteEvidence(route: SessionRoute, happened: HappenedInSession = {}): RuleEvidence[] {
  return entriesFor(NOTE_TEMPLATES, route, happened);
}

/**
 * The end receipt: every fired rule, in note rank, then practice, then the
 * rest. Only HIDDEN_RULE_IDS are left out.
 */
export function receiptEvidence(route: SessionRoute, happened: HappenedInSession = {}): RuleEvidence[] {
  const notShown = happened.exampleShown === false
    ? route.ruleIds.filter((ruleId) => ruleId in EXAMPLE_NOT_SHOWN && effectiveRule(ruleId, route, happened)).map((ruleId) => ({ ruleId, head: headOf(EXAMPLE_NOT_SHOWN[ruleId]!), sentence: EXAMPLE_NOT_SHOWN[ruleId]! }))
    : [];
  const entries = [...notShown, ...ruleEvidence(route, happened), ...entriesFor(DETAIL_TEMPLATES, route, happened)];
  return [...new Map(entries.map((entry) => [entry.ruleId, entry])).values()].filter((entry) => !HIDDEN_RULE_IDS.has(entry.ruleId));
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
