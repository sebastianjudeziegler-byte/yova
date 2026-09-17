import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BaselineSession, type BaselineSessionProps } from "./baseline-session";
import { emptyOnboardingAnswers, withOnboardingAnswer } from "@/lib/onboarding/answers";
import { routeSession } from "@/lib/routing/session-route";
import { initialShapeADraft, initialShapeAState, shapeAReducer } from "@/lib/session-shapes/shape-a";
import { initialShapeCState } from "@/lib/session-shapes/shape-c";
import { routeFingerprint, type BaselineCheckpoint } from "@/lib/session-shapes/baseline-checkpoint";
import { conceptMapAsProduce } from "@/lib/session-shapes/concept-map";

const route = routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: false, topicHasProblems: false, answers: withOnboardingAnswer(emptyOnboardingAnswers(), "prove_knowing", "map_it") });
const map = { concepts: [{ id: "water", label: "Water final Ω" }, { id: "potential", label: "Water potential" }], links: [{ id: "flow", from: "water", to: "potential", label: "moves down the gradient" }] };
const draft = { ...initialShapeADraft(), map, repairText: "Higher to lower water potential." };
const aState = shapeAReducer(shapeAReducer(initialShapeAState(route), { type: "continue" }), { type: "edit_draft", draft });
const checkpoint: BaselineCheckpoint = { version: 1, planId: "plan", planSessionId: "session", produceStep: "concept_map", studyLocation: "inside", routeFingerprint: routeFingerprint(route), savedAt: "2026-09-17T10:00:00Z", elapsedSeconds: 90, started: true, aState, cState: initialShapeCState(route), direction: null, learnBlock: null, practiceKeyPoints: [], tips: {}, timer: { paused: true, hidden: false, extraMinutes: 5, acknowledgedLimit: null } };
const props = { plan: { id: "plan", title: "Cell transport", topic: "Osmosis", rationale: "Apply osmosis to unfamiliar examples.", sourceMode: "ai_generated", materials: [], sessions: [] }, session: { id: "session", title: "Osmosis", objective: "Explain how water moves.", topicIds: [], learningMode: "learn", estimatedMinutes: 25 }, topic: null, route, nextSession: null, checkpoint, onChangeProduceStep: () => {}, onExit: () => {}, onComplete: async () => true } as unknown as BaselineSessionProps;
function render(state: BaselineCheckpoint["aState"]) { return renderToStaticMarkup(createElement(BaselineSession, { ...props, checkpoint: { ...checkpoint, aState: state } })); }

describe("baseline session restored UI", () => {
  it("restores the exact map draft in controlled inputs and the visual relationship view", () => {
    const html = render(aState);
    expect(html).toContain('value="Water final Ω"');
    expect(html).toContain('value="moves down the gradient"');
    expect(html).toContain('Water final Ω —moves down the gradient→ Water potential');
    expect(html).toContain('Compare my map');
    expect(html).toContain('Resume');
  });
  it("restores a submitted map at comparison without inventing feedback or losing its identity", () => {
    const submitted = shapeAReducer(aState, { type: "submit_produce", produce: conceptMapAsProduce(map) });
    const html = render(submitted);
    expect(html).toContain('Your work was kept while you were away.');
    expect(html).toContain('aria-label="Submitted map"');
    expect(html).toContain('data-map-item-id="flow"');
  });
  it("shows a recovered interrupted correction as unchecked and offers retry or continuation", () => {
    let state = shapeAReducer(aState, { type: "submit_produce", produce: conceptMapAsProduce(map) });
    state = shapeAReducer(state, { type: "comparison_ready", comparison: { feedback: "The direction is reversed.", missing: [], incorrect: ["Name the correct direction."] } });
    state = shapeAReducer(state, { type: "continue" });
    state = shapeAReducer(state, { type: "submit_repair", text: "Higher to lower water potential." });
    const html = render(state);
    expect(html).toContain('Retry correction check');
    expect(html).toContain('Continue unchecked');
    expect(html).toContain('Original answer and feedback');
    expect(html).toContain('Your correction is saved but has not been checked.');
  });
  it("renders revised feedback distinctly while retaining the original feedback", () => {
    let state = shapeAReducer(aState, { type: "submit_produce", produce: conceptMapAsProduce(map) });
    state = shapeAReducer(state, { type: "comparison_ready", comparison: { feedback: "The direction is reversed.", missing: [], incorrect: ["Name the correct direction."] } });
    state = shapeAReducer(state, { type: "continue" });
    state = shapeAReducer(state, { type: "submit_repair", text: "Higher to lower water potential." });
    state = shapeAReducer(state, { type: "repair_comparison_ready", comparison: { feedback: "The new direction matches the reference.", missing: [], incorrect: [] } });
    const html = render(state);
    expect(html).toContain('Your correction was checked.');
    expect(html).toContain('The new direction matches the reference.');
    expect(html).toContain('The direction is reversed.');
    expect(html).not.toContain('Check correction');
  });
  it("offers optional queued work within the persisted ceiling even after the current estimate", () => {
    const workload = { version: "topic_workload_v1" as const, topicSubtopics: [], questionCount: 32, recallQuestionCount: 32, transferQuestionCount: 0, produceSteps: 0, sourceReadMinutes: 0, estimatedMinutes: 33, ceilingMinutes: 60, practicePlaceholder: true, practiceRound: 1, suggestedDate: true, ruleIds: [] };
    const completed = { ...checkpoint, cState: { ...checkpoint.cState, phase: "done" as const } };
    const renderAt = (minutes: number) => renderToStaticMarkup(createElement(BaselineSession, { ...props, session: { ...props.session, workload }, checkpoint: { ...completed, elapsedSeconds: minutes * 60 }, continuationSession: { ...props.session, id: "next", title: "The next queued learning block" } }));
    expect(renderAt(35)).toContain("Save and start next activity");
    expect(renderAt(35)).toContain("Finish");
    expect(renderAt(60)).not.toContain("Save and start next activity");
  });
});
