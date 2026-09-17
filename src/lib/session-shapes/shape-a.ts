import type { ProduceStep, SessionRoute } from "@/lib/routing/session-route";
import { emptyConceptMap, type ConceptMapDraft, type MapItemFeedback } from "./concept-map";

/**
 * Shape A — study → produce → compare → repair. A coded step sequence.
 *
 * The state machine owns the order of steps. The AI fills bounded slots
 * (an explanation, a direction sentence, a comparison) but never decides
 * what step comes next, and nothing here sets topic status.
 * See docs/redesign/01-SESSION-SHAPES.md.
 */
export type ShapeAStepKind =
  | "direct"
  | "away"
  | "explanation"
  | "worked_structure"
  | "produce"
  | "compare"
  | "repair"
  | "end";

export type ShapeAStep = {
  kind: ShapeAStepKind;
  /** Learner-facing label; the kind is what code reads. */
  label: string;
  optional: boolean;
};

export type ShapeAProduceInput =
  | { kind: "typed_explanation" | "outline" | "worked_solution"; text: string }
  | { kind: "concept_map"; concepts: string[]; links: Array<{ from: string; to: string; label: string }>; map?: ConceptMapDraft };

export type ShapeADraft = { text: string; map: ConceptMapDraft; repairText: string; repairMap: ConceptMapDraft | null };
export const initialShapeADraft = (): ShapeADraft => ({ text: "", map: emptyConceptMap(), repairText: "", repairMap: null });

export type ShapeAComparison = {
  feedback: string;
  missing: string[];
  incorrect: string[];
  itemFeedback?: MapItemFeedback[];
};

export type ShapeAState = {
  steps: ShapeAStep[];
  index: number;
  produce: ShapeAProduceInput | null;
  comparison: ShapeAComparison | null;
  repair: string | null;
  repairSkipped: boolean;
  /** Optional for checkpoints written before durable drafts were introduced. */
  draft?: ShapeADraft;
  comparisonUnavailable?: boolean;
  repairStatus?: "pending" | "checked" | "error";
  repairComparison?: ShapeAComparison | null;
  revisedProduce?: ShapeAProduceInput | null;
  exampleViewed?: boolean;
  /** Set when the learner chooses to keep going after the timer nudge; never blocks. */
  timerAcknowledged: boolean;
};

export type ShapeAEvent =
  | { type: "continue" }
  | { type: "submit_produce"; produce: ShapeAProduceInput }
  | { type: "comparison_ready"; comparison: ShapeAComparison }
  | { type: "edit_draft"; draft: ShapeADraft }
  | { type: "example_viewed" }
  | { type: "skip_comparison" }
  | { type: "submit_repair"; text: string; produce?: ShapeAProduceInput }
  | { type: "repair_comparison_ready"; comparison: ShapeAComparison }
  | { type: "repair_failed" }
  | { type: "skip_repair" }
  | { type: "acknowledge_timer" };

/**
 * The step sequence for a route. Pure: same route, same steps.
 *
 * - A1 (source): direct → away → continue → produce → compare → repair
 * - A2 (no source): explanation → produce → compare → repair
 * - Q5 try_then_feedback: produce first, then study, then compare
 * - Q5 concrete_example: a worked structure before producing
 * - Q6 answer_questions: no produce step; the block hands off to retrieval questions
 */
export function shapeASteps(route: SessionRoute): ShapeAStep[] {
  if (route.shape !== "A" || !route.produceStep) return [];
  // Outside YOVA (Brief 1.5 item 8): the directions card is the whole study step; "I'm back" hands off to practice.
  if (route.learnPath === "outside") return [{ kind: "direct", label: "Study outside YOVA", optional: false }, { kind: "end", label: "Practice questions", optional: false }];
  const study: ShapeAStep[] = route.learnPath === "source"
    ? [
      { kind: "direct", label: route.entry === "brief_review" ? "Brief review" : "Study your material", optional: false },
      { kind: "away", label: "Continue when you are back", optional: false },
    ]
    : [{ kind: "explanation", label: route.entry === "brief_review" ? "Brief review" : "Read the explanation", optional: false }];
  if (route.produceStep === "retrieval_questions") {
    return [...study, { kind: "end", label: "Retrieval questions", optional: false }];
  }
  const produce: ShapeAStep = { kind: "produce", label: produceStepLabel(route.produceStep), optional: false };
  const worked: ShapeAStep[] = route.workedStructureBeforeProduce
    ? [{ kind: "worked_structure", label: "See the structure first", optional: false }]
    : [];
  const compareAndRepair: ShapeAStep[] = [
    { kind: "compare", label: "Compare with the source", optional: false },
    { kind: "repair", label: "Repair the gaps", optional: true },
    { kind: "end", label: "What's next", optional: false },
  ];
  if (route.produceBeforeStudy) {
    return [...worked, produce, ...study, ...compareAndRepair];
  }
  return [...study, ...worked, produce, ...compareAndRepair];
}

export function produceStepLabel(step: ProduceStep) {
  switch (step) {
    case "typed_explanation": return "Explain it in your own words";
    case "concept_map": return "Map the concepts and links";
    case "outline": return "Outline the claim and structure";
    case "worked_solution": return "Work a comparable problem";
    case "retrieval_questions": return "Answer retrieval questions";
    default: {
      const never: never = step;
      throw new Error(`Unknown produce step ${String(never)}`);
    }
  }
}

export function initialShapeAState(route: SessionRoute): ShapeAState {
  return {
    steps: shapeASteps(route),
    index: 0,
    produce: null,
    comparison: null,
    repair: null,
    repairSkipped: false,
    draft: initialShapeADraft(),
    timerAcknowledged: false,
  };
}

export function currentShapeAStep(state: ShapeAState): ShapeAStep | null {
  return state.steps[state.index] ?? null;
}

/**
 * True when an event has just moved the session onto Compare with work to
 * compare and no comparison yet: the one moment to request it. Produce leads
 * straight to Compare normally, but a try-it-first learner reaches Compare
 * from the study step after producing.
 */
export function entersCompare(previous: ShapeAState, next: ShapeAState) {
  return next.index !== previous.index && currentShapeAStep(next)?.kind === "compare" && next.produce !== null && next.comparison === null;
}

export function isShapeAComplete(state: ShapeAState) {
  return currentShapeAStep(state)?.kind === "end";
}

/**
 * Pure reducer. An event that does not fit the current step is ignored, so a
 * stale click can never skip a required step or move backwards.
 */
export function shapeAReducer(state: ShapeAState, event: ShapeAEvent): ShapeAState {
  const step = currentShapeAStep(state);
  if (!step) return state;
  if (event.type === "acknowledge_timer") return { ...state, timerAcknowledged: true };
  if (event.type === "example_viewed") return { ...state, exampleViewed: true };
  if (event.type === "edit_draft" && (step.kind === "produce" || (step.kind === "repair" && state.repairStatus !== "checked"))) return { ...state, draft: event.draft };
  switch (step.kind) {
    case "direct":
    case "away":
    case "explanation":
    case "worked_structure":
      return event.type === "continue" ? advance(state) : state;
    case "produce":
      return event.type === "submit_produce" && produceHasContent(event.produce)
        ? advance({ ...state, produce: event.produce })
        : state;
    case "compare":
      if (event.type === "comparison_ready") return { ...state, comparison: event.comparison };
      if (event.type === "skip_comparison" && !state.comparison) return { ...state, index: state.steps.length - 1, comparisonUnavailable: true, repairSkipped: true };
      // Feedback, not a verdict: the learner may continue once the comparison is shown.
      return event.type === "continue" && state.comparison ? advance(state) : state;
    case "repair":
      if (event.type === "submit_repair" && event.text.trim() && state.repairStatus !== "checked" && state.repairStatus !== "pending") return { ...state, repair: event.text.trim(), revisedProduce: event.produce ?? null, repairStatus: "pending", repairComparison: null };
      if (event.type === "repair_comparison_ready" && state.repairStatus === "pending") return { ...state, repairStatus: "checked", repairComparison: event.comparison };
      if (event.type === "repair_failed" && state.repairStatus === "pending") return { ...state, repairStatus: "error" };
      if (event.type === "skip_repair" || event.type === "continue") return advance({ ...state, repairSkipped: !state.repair });
      return state;
    case "end":
      return state;
    default: {
      const never: never = step.kind;
      throw new Error(`Unknown step ${String(never)}`);
    }
  }
}

function advance(state: ShapeAState): ShapeAState {
  return { ...state, index: Math.min(state.steps.length - 1, state.index + 1) };
}

export function produceHasContent(produce: ShapeAProduceInput) {
  if (produce.kind === "concept_map") {
    return produce.concepts.some((concept) => concept.trim()) && produce.links.some((link) => link.from.trim() && link.to.trim() && link.label.trim());
  }
  return produce.text.trim().length > 0;
}

/** Plain-text rendering of what the learner produced, for the comparison slot. */
export function produceAsText(produce: ShapeAProduceInput): string {
  if (produce.kind === "concept_map") {
    const concepts = produce.concepts.filter((concept) => concept.trim());
    const links = produce.links.filter((link) => link.from.trim() && link.to.trim() && link.label.trim());
    return [`Concepts: ${concepts.join(", ")}`, ...links.map((link) => `${link.from} —${link.label}→ ${link.to}`)].join("\n");
  }
  return produce.text;
}
