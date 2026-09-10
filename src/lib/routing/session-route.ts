import { CORE_METHOD_CATALOG, type CoreMethodId, type LearningTaskType } from "@/lib/learning/method-catalog";
import {
  onboardingAnswerId,
  onboardingSupportNeeds,
  type OnboardingAnswers,
} from "@/lib/onboarding/answers";

/**
 * Baseline session routing. A pure function over a finite input space.
 *
 * Five layers resolve in order; a later layer can only modify what an earlier
 * layer left open. Every decision records the rule ID that fired. Those IDs
 * power "Change method", the end-of-session personalization note, and the
 * permanent personalization delta test. See docs/redesign/02-ROUTING.md.
 *
 * No model is in the loop and nothing here reads a label.
 */
export const BASELINE_ROUTING_VERSION = "baseline_routing_v1" as const;

export const ROUTING_BLOCK_KINDS = ["learn", "practice"] as const;
export type RoutingBlockKind = (typeof ROUTING_BLOCK_KINDS)[number];

export const ROUTING_EVIDENCE_LEVELS = ["not_assessed", "gap", "demonstrated", "learner_reported_covered"] as const;
export type RoutingEvidence = (typeof ROUTING_EVIDENCE_LEVELS)[number];

export type RoutingInput = {
  taskType: LearningTaskType;
  blockKind: RoutingBlockKind;
  /** Placement evidence on this topic. */
  evidence: RoutingEvidence;
  /** Whether the learner has material for this topic (Shape A1 vs A2). */
  hasSource: boolean;
  /** Only consulted for `mixed_assessment`: whether the topic contains problems. */
  topicHasProblems: boolean;
  answers: OnboardingAnswers;
};

export type SessionShape = "A" | "C";
export type ShapeAVariant = "standard" | "sq3r" | "outline_from_memory" | "worked_example_source";
/** Scaffolding levels for Shape A, least to most independent. */
export const SHAPE_A_ENTRY_LEVELS = ["study_full", "brief_review", "skip_to_practice"] as const;
export type ShapeAEntry = (typeof SHAPE_A_ENTRY_LEVELS)[number];
export type ProduceStep = "typed_explanation" | "concept_map" | "outline" | "retrieval_questions" | "worked_solution";
export type QuestionWeighting = "terms_first" | "relationships_first";
export type InstructionStyle = "standard" | "numbered_steps" | "plain_restated";
export type StoppingPoints = "standard" | "after_each_step";
export type MethodVisibility = "silent" | "change_link" | "chooser";
export type EnergyWindow = "morning" | "afternoon" | "evening" | "late_night";

export type RoutingLayer = 1 | 2 | 3 | 4 | 5 | "conflict";

export type RoutingDecision = {
  layer: RoutingLayer;
  /** Stable identifier of the rule that fired. Assert on this, never on text. */
  ruleId: string;
  /** Which output the rule set or confirmed. */
  field: string;
  value: string | number | boolean | null;
  reason: string;
};

export type SessionRoute = {
  version: typeof BASELINE_ROUTING_VERSION;
  input: RoutingInput;
  shape: SessionShape;
  shapeVariant: ShapeAVariant | null;
  /** Shape A only: study the learner's material (A1) or an AI explanation (A2). */
  learnPath: "source" | "ai_explanation" | null;
  /** Shape A only: what the AI explanation must centre on when there is no source. */
  explanationFocus: "concept" | "worked_example" | null;
  entry: ShapeAEntry;
  produceStep: ProduceStep | null;
  produceBeforeStudy: boolean;
  workedStructureBeforeProduce: boolean;
  /** Shape C learn block for memorization: a brief study step before questions. */
  briefStudyStep: boolean;
  methodId: CoreMethodId;
  methodName: string;
  timerMinutes: number;
  /** Maximum questions per practice round (3–8). */
  questionCap: number;
  questionMinimum: number;
  weighting: QuestionWeighting;
  practiceRoundCeiling: number;
  instructionStyle: InstructionStyle;
  stoppingPoints: StoppingPoints;
  pacePrompts: boolean;
  visibility: MethodVisibility;
  preferredWindow: { learn: EnergyWindow; practice: "off_peak" } | null;
  homeQueueCollapsed: boolean;
  /** Set when a task type is routed to Shape A only because Shape B is not built. */
  temporaryRoute: { reason: "shape_b_not_built"; intendedShape: "B" } | null;
  decisions: RoutingDecision[];
  ruleIds: string[];
};

export const PRACTICE_QUESTION_MINIMUM = 3;
export const PRACTICE_QUESTION_MAXIMUM = 8;
export const PRACTICE_ROUND_CEILING = 3;
export const TIMER_MINIMUM_MINUTES = 10;
export const TIMER_MAXIMUM_MINUTES = 60;

/** Q2 bands in order; a modifier moves one band at a time. */
const TIMER_BANDS = [15, 25, 40, 55] as const;
const DEFAULT_TIMER_BAND_INDEX = 1;
const TIMER_BAND_BY_ANSWER: Readonly<Record<string, number>> = {
  minutes_10_15: 0,
  minutes_20_30: 1,
  minutes_30_45: 2,
  minutes_45_60: 3,
};

const PROCEDURAL_TASK_TYPES: readonly LearningTaskType[] = ["problem_solving", "programming"];

const METHOD_FOR_PRODUCE_STEP: Readonly<Record<ProduceStep, CoreMethodId>> = {
  typed_explanation: "self_explanation",
  concept_map: "concept_mapping",
  retrieval_questions: "retrieval_practice",
  outline: "retrieval_based_outlining",
  worked_solution: "practice_problems",
};

export function routeSession(input: RoutingInput): SessionRoute {
  const decisions: RoutingDecision[] = [];
  const decide = (decision: RoutingDecision) => { decisions.push(decision); };
  const { answers } = input;
  const q1 = onboardingAnswerId(answers, "energy_window");
  const q2 = onboardingAnswerId(answers, "session_length");
  const q3 = onboardingAnswerId(answers, "focus_loss");
  const q4 = onboardingAnswerId(answers, "guidance");
  const q5 = onboardingAnswerId(answers, "difficulty_help");
  const q6 = onboardingAnswerId(answers, "prove_knowing");
  const q7 = onboardingAnswerId(answers, "gist_detail");
  const q9 = onboardingSupportNeeds(answers);
  const q10 = onboardingAnswerId(answers, "extra_context");

  // ---------------------------------------------------------------- Layer 1
  // Task type decides the shape. No profile answer overrides this layer.
  const layer1 = layerOneShape(input);
  decide({ layer: 1, ruleId: layer1.ruleId, field: "shape", value: layer1.shape, reason: layer1.reason });
  if (layer1.temporaryRoute) {
    decide({ layer: 1, ruleId: "L1.temporary.shape_b_not_built", field: "temporaryRoute", value: "shape_b_not_built", reason: "Shape B ships in Week 2; procedural topics use Shape A with a worked example as the source until then." });
  }
  let shape: SessionShape = layer1.shape;
  const shapeVariant = layer1.shapeVariant;
  const defaultProduceStep = layer1.defaultProduceStep;
  const briefStudyStep = layer1.briefStudyStep;

  // ---------------------------------------------------------------- Layer 2
  // Placement evidence decides the scaffolding level.
  let entryLevel: number;
  if (input.blockKind === "practice") {
    entryLevel = 2;
    decide({ layer: 2, ruleId: "L2.practice_block", field: "entry", value: "skip_to_practice", reason: "A practice block is always closed-book practice." });
  } else if (shape === "C") {
    entryLevel = 2;
    decide({ layer: 2, ruleId: `L2.${input.evidence}.shape_c`, field: "entry", value: "skip_to_practice", reason: "This task type practises directly, so evidence only changes the brief study step." });
  } else {
    const level = { not_assessed: 0, gap: 0, demonstrated: 1, learner_reported_covered: 2 }[input.evidence];
    entryLevel = level;
    decide({
      layer: 2,
      ruleId: `L2.${input.evidence}`,
      field: "entry",
      value: SHAPE_A_ENTRY_LEVELS[level],
      reason: {
        not_assessed: "Nothing is known about this topic yet, so study the source in full before producing.",
        gap: "The placement check found a gap, so study the source in full before producing.",
        demonstrated: "The placement check was passed, so a brief review is enough before producing.",
        learner_reported_covered: "You marked this as already covered, so the learn block is skipped in favour of practice.",
      }[input.evidence],
    });
  }

  // ---------------------------------------------------------------- Layer 3
  // Q5 moves the entry point by one level at most (conflict rule 3).
  let produceBeforeStudy = false;
  let workedStructureBeforeProduce = false;
  let instructionStyle: InstructionStyle = "standard";
  const q5Effective = q10 === "examples_before_ready" && (!q5 || q5 === "mixed") ? "concrete_example" : q5;
  if (input.blockKind === "learn" && shape === "A") {
    const before = entryLevel;
    if (q5Effective === "step_by_step") {
      entryLevel = Math.max(0, entryLevel - 1);
      instructionStyle = "numbered_steps";
      decide({ layer: 3, ruleId: "L3.q5.step_by_step", field: "entry", value: SHAPE_A_ENTRY_LEVELS[entryLevel], reason: "You asked for step-by-step instructions, so scaffolding is held one level higher and steps are numbered." });
    }
    // Conflict rule 3: one level only, never past independent.
    const moved = Math.min(2, Math.max(before - 1, Math.min(before + 1, entryLevel)));
    if (moved !== entryLevel) {
      entryLevel = moved;
      decide({ layer: "conflict", ruleId: "C3.q5_one_level_only", field: "entry", value: SHAPE_A_ENTRY_LEVELS[entryLevel], reason: "A difficulty preference moves the entry point by one level only." });
    }
    if (entryLevel === 2) {
      shape = "C";
      decide({ layer: 2, ruleId: "L2.skip_learn_block_to_shape_c", field: "shape", value: "C", reason: "Skipping the learn block means closed-book practice." });
    } else if (q5Effective === "concrete_example") {
      workedStructureBeforeProduce = true;
      decide({ layer: 3, ruleId: q5 === "concrete_example" ? "L3.q5.concrete_example" : "L3.q10.examples_before_ready", field: "workedStructureBeforeProduce", value: true, reason: "You asked for a concrete example first, so a worked structure appears before you produce." });
    } else if (q5Effective === "try_then_feedback") {
      produceBeforeStudy = true;
      decide({ layer: 3, ruleId: "L3.q5.try_then_feedback", field: "produceBeforeStudy", value: true, reason: "You learn by trying first, so you produce before studying and then compare." });
    } else if (q5Effective === "simple_explanation") {
      decide({ layer: 3, ruleId: "L3.q5.simple_explanation", field: "entry", value: SHAPE_A_ENTRY_LEVELS[entryLevel], reason: "A simple explanation first is the Shape A default." });
    } else if (q5 === "mixed") {
      decide({ layer: "conflict", ruleId: "C5.q5_mixed_default", field: "entry", value: SHAPE_A_ENTRY_LEVELS[entryLevel], reason: "A mixture applies no modifier, so the task type default stands." });
    }
  }

  // Q6 decides the Shape A produce step.
  let produceStep: ProduceStep | null = null;
  if (shape === "A") {
    if (shapeVariant === "outline_from_memory") {
      produceStep = "outline";
      decide({ layer: 3, ruleId: "L3.variant.outline_fixed", field: "produceStep", value: "outline", reason: "Writing tasks always produce a claim and structure from memory." });
      if (q6) decide({ layer: "conflict", ruleId: "C1.layer1_wins.q6", field: "produceStep", value: "outline", reason: "The task type fixes the produce step; the profile cannot change it." });
    } else if (q6 === "explain_back") {
      produceStep = "typed_explanation";
      decide({ layer: 3, ruleId: "L3.q6.explain_back", field: "produceStep", value: produceStep, reason: "You prove knowledge by explaining, so you type an explanation with the source hidden." });
    } else if (q6 === "map_it") {
      produceStep = "concept_map";
      decide({ layer: 3, ruleId: "L3.q6.map_it", field: "produceStep", value: produceStep, reason: "You prove knowledge by mapping, so you build the concepts and their labelled links." });
    } else if (q6 === "answer_questions") {
      produceStep = "retrieval_questions";
      decide({ layer: 3, ruleId: "L3.q6.answer_questions", field: "produceStep", value: produceStep, reason: "You prove knowledge by answering questions, so producing is skipped for retrieval questions." });
    } else if (q6 === "solve_it") {
      if (shapeVariant === "worked_example_source") {
        produceStep = "worked_solution";
        decide({ layer: 3, ruleId: "L3.q6.solve_it", field: "produceStep", value: produceStep, reason: "You prove knowledge by solving, so you work a comparable problem after the example." });
      } else {
        produceStep = defaultProduceStep;
        decide({ layer: "conflict", ruleId: "C1.layer1_wins.q6_solve_it", field: "produceStep", value: produceStep, reason: "This task type has no problems to solve, so the task default produce step stands." });
      }
    } else {
      produceStep = defaultProduceStep;
      decide({ layer: "conflict", ruleId: "C5.q6_unanswered_default", field: "produceStep", value: produceStep, reason: "No proof preference is saved, so the task type default produce step is used." });
    }
  }

  // ---------------------------------------------------------------- Layer 4
  // Modifiers never change the shape.
  let timerBand = q2 && q2 in TIMER_BAND_BY_ANSWER ? TIMER_BAND_BY_ANSWER[q2] : DEFAULT_TIMER_BAND_INDEX;
  decide({ layer: 4, ruleId: `L4.q2.${q2 ?? "unanswered"}`, field: "timerBand", value: TIMER_BANDS[timerBand], reason: q2 && q2 in TIMER_BAND_BY_ANSWER ? "Your realistic session length sets the base timer." : "No session length is saved, so the middle band is the base timer." });
  let questionCap = PRACTICE_QUESTION_MAXIMUM;
  if (timerBand === 0) {
    questionCap = Math.min(questionCap, 5);
    decide({ layer: 4, ruleId: "L4.q2.short_band_question_cap", field: "questionCap", value: 5, reason: "A 10–15 minute session caps practice at five questions." });
  }
  if (q3 === "often" || q3 === "very_often") {
    timerBand = Math.max(0, timerBand - 1);
    decide({ layer: 4, ruleId: `L4.q3.${q3}`, field: "timerBand", value: TIMER_BANDS[timerBand], reason: "You lose focus often, so the timer drops one band and more stopping points are added." });
  } else if (q3) {
    decide({ layer: 4, ruleId: `L4.q3.${q3}`, field: "timerBand", value: TIMER_BANDS[timerBand], reason: "Focus loss is not frequent, so the timer keeps its band." });
  }
  let stoppingPoints: StoppingPoints = q3 === "often" || q3 === "very_often" ? "after_each_step" : "standard";
  let timerMinutes: number = TIMER_BANDS[timerBand];
  let pacePrompts = true;
  let practiceRoundCeiling = PRACTICE_ROUND_CEILING;
  let weighting: QuestionWeighting | null = null;
  let homeQueueCollapsed = false;

  if (q7 === "gist_leaning") {
    weighting = "terms_first";
    decide({ layer: 4, ruleId: "L4.q7.gist_leaning", field: "weighting", value: weighting, reason: "You catch the big picture but miss specifics, so definition and term items come first." });
  } else if (q7 === "detail_leaning") {
    weighting = "relationships_first";
    decide({ layer: 4, ruleId: "L4.q7.detail_leaning", field: "weighting", value: weighting, reason: "You know details but lose how they fit, so compare-contrast and structure items come first." });
  }

  for (const support of q9) {
    switch (support) {
      case "shorter_sections":
        timerMinutes = timerMinutes * 0.75;
        questionCap = Math.min(questionCap, 5);
        decide({ layer: 4, ruleId: "L4.q9.shorter_sections", field: "timerMinutes", value: Math.round(timerMinutes), reason: "Shorter sections: fewer targets per block, timer −25%, at most five questions." });
        break;
      case "reduced_text_visual_structure":
        if (shape === "A" && produceStep && produceStep !== "outline") {
          produceStep = "concept_map";
          decide({ layer: "conflict", ruleId: "C2.q9_visual_overrides_q6", field: "produceStep", value: "concept_map", reason: "Less text and more visual structure is an accessibility need, so the produce step becomes a concept map." });
        } else {
          decide({ layer: 4, ruleId: "L4.q9.reduced_text_visual_structure", field: "produceStep", value: produceStep, reason: "Less text and more visual structure is recorded; there is no produce step to change in this block." });
        }
        break;
      case "extra_reading_time":
        timerMinutes = timerMinutes * 1.25;
        pacePrompts = false;
        decide({ layer: 4, ruleId: "L4.q9.extra_reading_time", field: "timerMinutes", value: Math.round(timerMinutes), reason: "Extra time to read: timer +25% and no pace prompts." });
        break;
      case "simpler_repeated_instructions":
        instructionStyle = "plain_restated";
        decide({ layer: 4, ruleId: "L4.q9.simpler_repeated_instructions", field: "instructionStyle", value: instructionStyle, reason: "Instructions use plain language and the task is restated at each step." });
        break;
      case "frequent_check_ins":
        stoppingPoints = "after_each_step";
        decide({ layer: 4, ruleId: "L4.q9.frequent_check_ins", field: "stoppingPoints", value: stoppingPoints, reason: "Frequent check-ins: an explicit stopping point after each step." });
        break;
      default:
        break;
    }
  }

  if (q1 && q1 !== "varies") {
    decide({ layer: 4, ruleId: `L4.q1.${q1}`, field: "preferredWindow", value: q1, reason: "Learn blocks are proposed in your peak energy window and practice off-peak." });
  }
  if (q10 === "forget_during_tests") {
    practiceRoundCeiling += 1;
    decide({ layer: 4, ruleId: "L4.q10.forget_during_tests", field: "practiceRoundCeiling", value: practiceRoundCeiling, reason: "You forget during tests, so each topic gets one extra practice round with tighter spacing." });
  } else if (q10 === "long_plan_shutdown") {
    homeQueueCollapsed = true;
    decide({ layer: 4, ruleId: "L4.q10.long_plan_shutdown", field: "homeQueueCollapsed", value: true, reason: "Long plans make you shut down, so Home shows the next block only." });
  }

  // Conflict rule 4: timer modifiers stack but clamp.
  const rounded = Math.round(timerMinutes);
  const clamped = Math.min(TIMER_MAXIMUM_MINUTES, Math.max(TIMER_MINIMUM_MINUTES, rounded));
  if (clamped !== rounded) {
    decide({ layer: "conflict", ruleId: "C4.timer_clamp", field: "timerMinutes", value: clamped, reason: "Timer modifiers stack but clamp to 10–60 minutes." });
  }
  timerMinutes = clamped;
  decide({ layer: 4, ruleId: "L4.timer_resolved", field: "timerMinutes", value: timerMinutes, reason: "The session timer is a nudge from your profile, not a boundary." });

  if (!weighting) {
    weighting = input.taskType === "memorization" ? "terms_first" : "relationships_first";
    decide({ layer: 4, ruleId: `L4.q7.${q7 ?? "unanswered"}.task_default`, field: "weighting", value: weighting, reason: input.taskType === "memorization" ? "Memorization defaults to term items first." : "Conceptual work defaults to relationship items first." });
  }

  // ---------------------------------------------------------------- Layer 5
  let visibility: MethodVisibility;
  if (q4 === "exact_guidance") {
    visibility = "silent";
    decide({ layer: 5, ruleId: "L5.q4.exact_guidance", field: "visibility", value: visibility, reason: "You asked to be told exactly what to do, so the method is applied silently with detailed steps." });
  } else if (q4 === "learner_choice") {
    visibility = "chooser";
    decide({ layer: 5, ruleId: "L5.q4.learner_choice", field: "visibility", value: visibility, reason: "You asked to decide, so a method chooser opens with YOVA's pick pre-selected." });
  } else {
    visibility = "change_link";
    decide({ layer: 5, ruleId: q4 === "structured_flexibility" ? "L5.q4.structured_flexibility" : "L5.q4.unanswered_default", field: "visibility", value: visibility, reason: "The method is applied and a Change method link shows the reason." });
  }

  // ---------------------------------------------------------------- Output
  const briefStudyStepActive = shape === "C" && input.blockKind === "learn" && briefStudyStep;
  const method = resolveMethod({ shape, shapeVariant, produceStep, layer1 });
  decide({ layer: "conflict", ruleId: "C6.rule_ids_recorded", field: "methodId", value: method.id, reason: `Every decision above is recorded; the session runs ${method.name}.` });

  return {
    version: BASELINE_ROUTING_VERSION,
    input,
    shape,
    shapeVariant: shape === "A" ? shapeVariant : null,
    // Shape C's brief study step reads the learner's material when there is
    // any, the same A1/A2 split Shape A uses. A practice block has no study step.
    learnPath: shape === "A" || briefStudyStepActive ? (input.hasSource ? "source" : "ai_explanation") : null,
    explanationFocus: shape === "A" && !input.hasSource ? (shapeVariant === "worked_example_source" ? "worked_example" : "concept") : null,
    entry: SHAPE_A_ENTRY_LEVELS[entryLevel],
    produceStep: shape === "A" ? produceStep : null,
    produceBeforeStudy: shape === "A" && produceStep !== "retrieval_questions" ? produceBeforeStudy : false,
    workedStructureBeforeProduce: shape === "A" ? workedStructureBeforeProduce : false,
    briefStudyStep: briefStudyStepActive,
    methodId: method.id,
    methodName: method.name,
    timerMinutes,
    questionCap,
    questionMinimum: PRACTICE_QUESTION_MINIMUM,
    weighting,
    practiceRoundCeiling,
    instructionStyle,
    stoppingPoints,
    pacePrompts,
    visibility,
    preferredWindow: q1 && q1 !== "varies" ? { learn: q1 as EnergyWindow, practice: "off_peak" } : null,
    homeQueueCollapsed,
    temporaryRoute: layer1.temporaryRoute,
    decisions,
    ruleIds: decisions.map((decision) => decision.ruleId),
  };
}

type LayerOneResult = {
  ruleId: string;
  reason: string;
  shape: SessionShape;
  shapeVariant: ShapeAVariant;
  defaultProduceStep: ProduceStep;
  briefStudyStep: boolean;
  temporaryRoute: SessionRoute["temporaryRoute"];
};

function layerOneShape(input: RoutingInput): LayerOneResult {
  const { taskType, blockKind } = input;
  if (blockKind === "practice") {
    return { ruleId: `L1.${taskType}.practice`, reason: "Practice blocks are closed-book practice for every task type.", shape: "C", shapeVariant: "standard", defaultProduceStep: "retrieval_questions", briefStudyStep: false, temporaryRoute: null };
  }
  const temporary = { reason: "shape_b_not_built", intendedShape: "B" } as const;
  switch (taskType) {
    case "problem_solving":
      return { ruleId: "L1.problem_solving.learn", reason: "Problem solving learns from a worked example.", shape: "A", shapeVariant: "worked_example_source", defaultProduceStep: "typed_explanation", briefStudyStep: false, temporaryRoute: temporary };
    case "programming":
      return { ruleId: "L1.programming.learn", reason: "Programming learns by tracing a worked example.", shape: "A", shapeVariant: "worked_example_source", defaultProduceStep: "typed_explanation", briefStudyStep: false, temporaryRoute: temporary };
    case "memorization":
      return { ruleId: "L1.memorization.learn", reason: "Memorization practises directly after a brief study step.", shape: "C", shapeVariant: "standard", defaultProduceStep: "retrieval_questions", briefStudyStep: true, temporaryRoute: null };
    case "conceptual_learning":
      return { ruleId: "L1.conceptual_learning.learn", reason: "Conceptual learning studies, produces, compares and repairs.", shape: "A", shapeVariant: "standard", defaultProduceStep: "typed_explanation", briefStudyStep: false, temporaryRoute: null };
    case "reading_to_quiz":
      return { ruleId: "L1.reading_to_quiz.learn", reason: "Reading for a quiz uses the SQ3R variant of Shape A.", shape: "A", shapeVariant: "sq3r", defaultProduceStep: "typed_explanation", briefStudyStep: false, temporaryRoute: null };
    case "writing_argumentation":
      return { ruleId: "L1.writing_argumentation.learn", reason: "Writing uses the outline-from-memory variant of Shape A.", shape: "A", shapeVariant: "outline_from_memory", defaultProduceStep: "outline", briefStudyStep: false, temporaryRoute: null };
    case "mixed_assessment":
      return input.topicHasProblems
        ? { ruleId: "L1.mixed_assessment.learn.problems", reason: "This mixed topic has problems, so it learns from a worked example.", shape: "A", shapeVariant: "worked_example_source", defaultProduceStep: "typed_explanation", briefStudyStep: false, temporaryRoute: temporary }
        : { ruleId: "L1.mixed_assessment.learn", reason: "Mixed assessment without problems studies, produces, compares and repairs.", shape: "A", shapeVariant: "standard", defaultProduceStep: "typed_explanation", briefStudyStep: false, temporaryRoute: null };
    default: {
      const never: never = taskType;
      throw new Error(`Unknown task type ${String(never)}`);
    }
  }
}

function resolveMethod({ shape, shapeVariant, produceStep, layer1 }: { shape: SessionShape; shapeVariant: ShapeAVariant; produceStep: ProduceStep | null; layer1: LayerOneResult }): { id: CoreMethodId; name: string } {
  let id: CoreMethodId;
  if (shape === "C") id = "retrieval_practice";
  else if (shapeVariant === "sq3r") id = "read_recall_review";
  else if (shapeVariant === "outline_from_memory") id = "retrieval_based_outlining";
  else if (shapeVariant === "worked_example_source") id = produceStep === "worked_solution" ? "practice_problems" : "worked_example_fading";
  else id = METHOD_FOR_PRODUCE_STEP[produceStep ?? layer1.defaultProduceStep];
  return { id, name: CORE_METHOD_CATALOG[id].name };
}

export function isProceduralTaskType(taskType: LearningTaskType) {
  return PROCEDURAL_TASK_TYPES.includes(taskType);
}

/** The Shape A produce steps a learner may switch to for this route without changing the shape. */
export function alternativeProduceSteps(route: SessionRoute): ProduceStep[] {
  if (route.shape !== "A" || !route.produceStep) return [];
  if (route.shapeVariant === "outline_from_memory") return [];
  const candidates: ProduceStep[] = ["typed_explanation", "concept_map", "retrieval_questions"];
  if (route.shapeVariant === "worked_example_source") candidates.push("worked_solution");
  return candidates.filter((step) => step !== route.produceStep);
}

export function methodNameForProduceStep(route: SessionRoute, produceStep: ProduceStep) {
  if (route.shapeVariant === "sq3r") return CORE_METHOD_CATALOG.read_recall_review.name;
  if (route.shapeVariant === "worked_example_source" && produceStep !== "worked_solution") return CORE_METHOD_CATALOG.worked_example_fading.name;
  return CORE_METHOD_CATALOG[METHOD_FOR_PRODUCE_STEP[produceStep]].name;
}

/**
 * "Change method" (Layer 5): the learner picks another produce step for this
 * Shape A block. The shape, entry point and modifiers are untouched; the
 * change is recorded as its own rule so the note and the receipt can name it.
 */
export function withProduceStepOverride(route: SessionRoute, produceStep: ProduceStep): SessionRoute {
  if (route.shape !== "A" || !route.produceStep || !alternativeProduceSteps(route).includes(produceStep)) return route;
  const methodName = methodNameForProduceStep(route, produceStep);
  const methodId = (Object.entries(CORE_METHOD_CATALOG).find(([, method]) => method.name === methodName)?.[0] ?? route.methodId) as CoreMethodId;
  const decision: RoutingDecision = { layer: 5, ruleId: `L5.learner_change_method.${produceStep}`, field: "produceStep", value: produceStep, reason: `You changed the method to ${methodName} for this session.` };
  const decisions = [...route.decisions, decision];
  return {
    ...route,
    produceStep,
    produceBeforeStudy: produceStep === "retrieval_questions" ? false : route.produceBeforeStudy,
    methodId,
    methodName,
    decisions,
    ruleIds: decisions.map((entry) => entry.ruleId),
  };
}
