import { describe, expect, it } from "vitest";
import { emptyOnboardingAnswers, withOnboardingAnswer } from "@/lib/onboarding/answers";
import { routeSession, withStudyOutside, type RoutingInput } from "@/lib/routing/session-route";
import {
  currentShapeAStep,
  entersCompare,
  initialShapeAState,
  isShapeAComplete,
  produceAsText,
  shapeAReducer,
  shapeASteps,
  type ShapeAState,
} from "./shape-a";

function route(overrides: Partial<RoutingInput> = {}, answers: Record<string, string> = {}) {
  let record = emptyOnboardingAnswers();
  for (const [id, value] of Object.entries(answers)) record = withOnboardingAnswer(record, id as never, value);
  return routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: true, topicHasProblems: false, answers: record, ...overrides });
}

const kinds = (state: ShapeAState) => state.steps.map((step) => step.kind);

describe("Shape A step sequence", () => {
  it("A1 with a source: direct → away → produce → compare → repair → end", () => {
    expect(shapeASteps(route()).map((step) => step.kind)).toEqual(["direct", "away", "produce", "compare", "repair", "end"]);
  });

  it("A2 without a source replaces the direct and away steps with an in-app explanation", () => {
    expect(shapeASteps(route({ hasSource: false })).map((step) => step.kind)).toEqual(["explanation", "produce", "compare", "repair", "end"]);
  });

  it("produces before studying when the profile learns by trying first", () => {
    expect(shapeASteps(route({}, { difficulty_help: "try_then_feedback" })).map((step) => step.kind)).toEqual(["produce", "direct", "away", "compare", "repair", "end"]);
  });

  it("shows a worked structure before producing when the profile wants an example first", () => {
    expect(shapeASteps(route({}, { difficulty_help: "concrete_example" })).map((step) => step.kind)).toEqual(["direct", "away", "worked_structure", "produce", "compare", "repair", "end"]);
  });

  it("skips producing entirely for Active Recall and hands off to retrieval questions", () => {
    const steps = shapeASteps(route({}, { prove_knowing: "answer_questions" }));
    expect(steps.map((step) => step.kind)).toEqual(["direct", "away", "end"]);
    expect(steps.at(-1)?.label).toBe("Retrieval questions");
  });

  it("names the brief review entry for a demonstrated topic", () => {
    expect(shapeASteps(route({ evidence: "demonstrated" }))[0]?.label).toBe("Brief review");
  });

  it("is empty for Shape C routes", () => {
    expect(shapeASteps(route({ blockKind: "practice" }))).toEqual([]);
  });

  it("is identical between runs for the same route", () => {
    const a = route({}, { prove_knowing: "map_it" });
    expect(shapeASteps(a)).toEqual(shapeASteps(routeSession(a.input)));
  });
});

describe("Shape A reducer", () => {
  it("walks the A1 sequence and refuses events that do not fit the current step", () => {
    let state = initialShapeAState(route());
    expect(currentShapeAStep(state)?.kind).toBe("direct");
    // A produce submission cannot skip the study step.
    state = shapeAReducer(state, { type: "submit_produce", produce: { kind: "typed_explanation", text: "early" } });
    expect(currentShapeAStep(state)?.kind).toBe("direct");
    state = shapeAReducer(state, { type: "continue" });
    expect(currentShapeAStep(state)?.kind).toBe("away");
    state = shapeAReducer(state, { type: "continue" });
    expect(currentShapeAStep(state)?.kind).toBe("produce");
    // Empty work does not count as producing.
    state = shapeAReducer(state, { type: "submit_produce", produce: { kind: "typed_explanation", text: "   " } });
    expect(currentShapeAStep(state)?.kind).toBe("produce");
    state = shapeAReducer(state, { type: "submit_produce", produce: { kind: "typed_explanation", text: "Glycolysis splits glucose into two pyruvate." } });
    expect(currentShapeAStep(state)?.kind).toBe("compare");
    // The learner cannot move past compare until the comparison is shown.
    state = shapeAReducer(state, { type: "continue" });
    expect(currentShapeAStep(state)?.kind).toBe("compare");
    state = shapeAReducer(state, { type: "comparison_ready", comparison: { feedback: "You did not mention NADH.", missing: ["NADH is produced"], incorrect: [] } });
    expect(state.comparison?.missing).toEqual(["NADH is produced"]);
    state = shapeAReducer(state, { type: "continue" });
    expect(currentShapeAStep(state)?.kind).toBe("repair");
    state = shapeAReducer(state, { type: "skip_repair" });
    expect(isShapeAComplete(state)).toBe(true);
    expect(state.repairSkipped).toBe(true);
    // Terminal.
    expect(shapeAReducer(state, { type: "continue" })).toBe(state);
  });

  it("records a repair when the learner addresses the named gaps", () => {
    let state = initialShapeAState(route({ hasSource: false }));
    state = shapeAReducer(state, { type: "continue" });
    state = shapeAReducer(state, { type: "submit_produce", produce: { kind: "typed_explanation", text: "An explanation." } });
    state = shapeAReducer(state, { type: "comparison_ready", comparison: { feedback: "Missing the mechanism.", missing: ["mechanism"], incorrect: [] } });
    state = shapeAReducer(state, { type: "continue" });
    state = shapeAReducer(state, { type: "submit_repair", text: "The mechanism is..." });
    expect(state.repair).toBe("The mechanism is...");
    expect(isShapeAComplete(state)).toBe(true);
  });

  it("accepts a concept map only when it has at least one concept and one labelled link", () => {
    let state = initialShapeAState(route({ hasSource: false }, { prove_knowing: "map_it" }));
    state = shapeAReducer(state, { type: "continue" });
    state = shapeAReducer(state, { type: "submit_produce", produce: { kind: "concept_map", concepts: ["ATP"], links: [] } });
    expect(currentShapeAStep(state)?.kind).toBe("produce");
    state = shapeAReducer(state, { type: "submit_produce", produce: { kind: "concept_map", concepts: ["ATP", "ADP"], links: [{ from: "ATP", to: "ADP", label: "loses a phosphate to become" }] } });
    expect(currentShapeAStep(state)?.kind).toBe("compare");
    expect(produceAsText(state.produce!)).toBe("Concepts: ATP, ADP\nATP —loses a phosphate to become→ ADP");
  });

  it("acknowledging the timer never changes the step", () => {
    const state = initialShapeAState(route());
    const nudged = shapeAReducer(state, { type: "acknowledge_timer" });
    expect(nudged.timerAcknowledged).toBe(true);
    expect(kinds(nudged)).toEqual(kinds(state));
    expect(nudged.index).toBe(state.index);
  });
});

// Brief 1.5 follow-up: a try-it-first learner reaches Compare from the study step, not from produce.
describe("when to request the comparison", () => {
  const produce = { kind: "typed_explanation" as const, text: "Light splits water and powers the Calvin cycle." };

  it("requests it on arriving at Compare after produce-then-study", () => {
    const tryFirst = route({}, { difficulty_help: "try_then_feedback" });
    let state = initialShapeAState(tryFirst);
    const produced = shapeAReducer(state, { type: "submit_produce", produce });
    expect(currentShapeAStep(produced)?.kind).toBe("direct");
    expect(entersCompare(state, produced)).toBe(false);
    state = shapeAReducer(produced, { type: "continue" });
    expect(entersCompare(produced, state)).toBe(false);
    const atCompare = shapeAReducer(state, { type: "continue" });
    expect(currentShapeAStep(atCompare)?.kind).toBe("compare");
    expect(entersCompare(state, atCompare)).toBe(true);
  });

  it("requests it on submitting produce when Compare comes next", () => {
    const standard = route({ hasSource: false });
    const atProduce = shapeAReducer(initialShapeAState(standard), { type: "continue" });
    const atCompare = shapeAReducer(atProduce, { type: "submit_produce", produce });
    expect(entersCompare(atProduce, atCompare)).toBe(true);
  });

  it("does not request it again once a comparison is in, or for an ignored event", () => {
    const standard = route({ hasSource: false });
    const atProduce = shapeAReducer(initialShapeAState(standard), { type: "continue" });
    const atCompare = shapeAReducer(atProduce, { type: "submit_produce", produce });
    const compared = shapeAReducer(atCompare, { type: "comparison_ready", comparison: { feedback: "You named the light reactions.", missing: [], incorrect: [] } });
    expect(entersCompare(atCompare, compared)).toBe(false);
    expect(entersCompare(atCompare, shapeAReducer(atCompare, { type: "skip_repair" }))).toBe(false);
  });
});

describe("outside YOVA", () => {
  it("is directions and then the practice hand-off: no away step, no produce, no explanation", () => {
    expect(shapeASteps(withStudyOutside(route({ hasSource: false }))).map((step) => step.kind)).toEqual(["direct", "end"]);
    expect(shapeASteps(withStudyOutside(route())).map((step) => step.kind)).toEqual(["direct", "end"]);
  });
});

