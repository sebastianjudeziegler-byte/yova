import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BaselineSession, type BaselineSessionProps } from "./baseline-session";
import { emptyOnboardingAnswers, withOnboardingAnswer } from "@/lib/onboarding/answers";
import { routeSession } from "@/lib/routing/session-route";
import { initialShapeADraft, initialShapeAState, shapeAReducer } from "@/lib/session-shapes/shape-a";
import { initialShapeCState, shapeCReducer } from "@/lib/session-shapes/shape-c";
import { routeFingerprint, saveBaselineCheckpoint, loadBaselineCheckpoint, type BaselineCheckpoint } from "@/lib/session-shapes/baseline-checkpoint";
import { conceptMapAsProduce } from "@/lib/session-shapes/concept-map";
import { settleTips, tipRequest } from "@/lib/session-shapes/session-tips";
import { TopicWorkloadSchema } from "@/lib/plan-generation/topic-plan-contract";
import type { BaselineSegmentResult } from "@/lib/session-shapes/baseline-session-result";

const route = routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: false, topicHasProblems: false, answers: withOnboardingAnswer(emptyOnboardingAnswers(), "prove_knowing", "map_it") });
const map = { concepts: [{ id: "water", label: "Water final Ω" }, { id: "potential", label: "Water potential" }], links: [{ id: "flow", from: "water", to: "potential", label: "moves down the gradient" }] };
const draft = { ...initialShapeADraft(), map, repairText: "Higher to lower water potential." };
const aState = shapeAReducer(shapeAReducer(initialShapeAState(route), { type: "continue" }), { type: "edit_draft", draft });
const checkpoint: BaselineCheckpoint = { version: 1, planId: "plan", planSessionId: "session", produceStep: "concept_map", studyLocation: "inside", routeFingerprint: routeFingerprint(route), savedAt: "2026-09-17T10:00:00Z", elapsedSeconds: 90, started: true, aState, cState: initialShapeCState(route), direction: null, learnBlock: null, practiceKeyPoints: [], tips: {}, timer: { paused: true, hidden: false, extraMinutes: 5, acknowledgedLimit: null } };
const props = { plan: { id: "plan", title: "Cell transport", topic: "Osmosis", rationale: "Apply osmosis to unfamiliar examples.", sourceMode: "ai_generated", materials: [], sessions: [] }, session: { id: "session", title: "Osmosis", objective: "Explain how water moves.", topicIds: [], learningMode: "learn", estimatedMinutes: 25 }, topic: null, route, nextSession: null, checkpoint, onChangeProduceStep: () => {}, onExit: () => {}, onComplete: async () => true } as unknown as BaselineSessionProps;
function render(state: BaselineCheckpoint["aState"]) { return renderToStaticMarkup(createElement(BaselineSession, { ...props, checkpoint: { ...checkpoint, aState: state } })); }

describe("baseline session restored UI", () => {
  it("resumes activity two with its exact draft and the completed first activity's work and time", () => {
    const { segmentedProps, restored } = segmentedFixture();
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    expect(saveBaselineCheckpoint(storage, "account", restored)).toBe(true);
    const loaded = loadBaselineCheckpoint(storage, "account", restored.planSessionId, restored.routeFingerprint);
    expect(loaded?.segmentProgress?.completed[0]?.checkpoint.aState.draft?.map).toEqual(map);
    expect(loaded?.segmentProgress?.completed[0]?.result.comparison?.feedback).toBe("Original first activity feedback.");
    const html = renderToStaticMarkup(createElement(BaselineSession, { ...segmentedProps, checkpoint: loaded }));
    expect(html).toContain('data-segment-id="segment-2"');
    expect(html).toContain('value="Water final Ω"');
    expect(html).toContain("ACTIVITY 2 OF 2");
    expect(html).toContain("Original first activity production.");
    expect(html).toContain("Original first activity feedback.");
    expect(html).toContain("3:30"); // 120 seconds completed + 90 in the current draft.
  });

  it("does not offer terminal Finish for activity one or resume activity two without its first result", () => {
    const { segmentedProps, restored } = segmentedFixture();
    const invalid = { ...restored, segmentProgress: { activeSegmentId: "segment-2", completed: [] } };
    const invalidHtml = renderToStaticMarkup(createElement(BaselineSession, { ...segmentedProps, checkpoint: invalid }));
    expect(invalidHtml).toContain("This activity could not be verified.");
    expect(invalidHtml).not.toContain('data-segment-id="segment-2"');
    const firstEnd = { ...restored, aState: { ...restored.aState, index: restored.aState.steps.length - 1 }, cState: { ...restored.cState, phase: "done" as const }, segmentProgress: { activeSegmentId: "segment-1", completed: [] } };
    const html = renderToStaticMarkup(createElement(BaselineSession, { ...segmentedProps, checkpoint: firstEnd }));
    expect(html).toContain("Continue to next activity");
    expect(html).toContain("ACTIVITY COMPLETE");
    expect(html).not.toContain(">Finish<");
    expect(html).not.toContain("SESSION COMPLETE");
  });
  it("shows the missed-point retry tip at the offer but does not receipt an unused retry", () => {
    const practiceRoute = routeSession({ ...route.input, taskType: "memorization" });
    const question = { id: "q1", slotId: "s1", keyPointIds: ["k1"], kind: "recall" as const, prompt: "Which direction does water move?", choices: ["Higher to lower water potential", "Lower to higher water potential", "Neither direction"], correctChoiceIndex: 0, explanation: "Water moves down the water potential gradient." };
    let state = shapeCReducer(initialShapeCState(practiceRoute), { type: "continue" });
    state = shapeCReducer(state, { type: "questions_ready", questions: [question] });
    state = shapeCReducer(state, { type: "answer", choiceIndex: 1 });
    state = shapeCReducer(state, { type: "next" });
    expect(state.phase).toBe("round_complete");
    const [tip] = settleTips(tipRequest(practiceRoute, ["round"], { practiceOccurred: true }), []);
    const renderPractice = (cState: typeof state) => renderToStaticMarkup(createElement(BaselineSession, { ...props, route: practiceRoute, checkpoint: { ...checkpoint, cState, tips: { round: tip } } }));
    const retryOffer = renderPractice(state);
    expect(retryOffer).toContain('data-tip-step="round"');
    expect(retryOffer).toContain('data-tip-rule-id="L4.practice.error_repair.after_missed_round"');
    expect(retryOffer).toContain("Answer only what you missed.");
    let clean = shapeCReducer(initialShapeCState(practiceRoute), { type: "continue" });
    clean = shapeCReducer(clean, { type: "questions_ready", questions: [question] });
    clean = shapeCReducer(clean, { type: "answer", choiceIndex: 0 });
    clean = shapeCReducer(clean, { type: "next" });
    expect(clean.phase).toBe("done");
    expect(renderPractice(clean)).not.toContain('data-receipt-rule-id="L4.practice.error_repair.after_missed_round"');
  });
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

function segmentedFixture() {
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const single = (index: number) => ({ version: "topic_workload_v1", topicSubtopics: [{ topicId: ids[index], subtopics: [index ? "Diffusion" : "Osmosis"] }], questionCount: 3, recallQuestionCount: 1, transferQuestionCount: 2, produceSteps: 1, sourceReadMinutes: 3, estimatedMinutes: 12, ceilingMinutes: 30, practicePlaceholder: false, practiceRound: 0, suggestedDate: true, ruleIds: ["L3.q6.map_it"] });
  const workload = TopicWorkloadSchema.parse({ ...single(0), topicSubtopics: [...single(0).topicSubtopics, ...single(1).topicSubtopics], questionCount: 6, recallQuestionCount: 2, transferQuestionCount: 4, produceSteps: 2, sourceReadMinutes: 6, estimatedMinutes: 24, segments: ids.map((_, index) => ({ segmentId: `segment-${index + 1}`, learningMode: "learn", taskType: "conceptual_learning", workload: single(index) })) });
  const topics = ids.map((id, index) => ({ id, title: index ? "Diffusion" : "Osmosis", description: "Explain the transport mechanism.", subtopics: [index ? "Diffusion" : "Osmosis"], prerequisiteTopicIds: [], sourceReferences: [] }));
  const segmentedProps = { ...props, plan: { ...props.plan, knowledgeMap: { topics } }, session: { ...props.session, workload }, segmentContexts: topics.map((topic, index) => ({ segmentId: `segment-${index + 1}`, topic, route, interleavedKeyPoints: [] })) } as unknown as BaselineSessionProps;
  const result: BaselineSegmentResult = { shape: "A", methodName: "Concept Mapping", ruleIds: route.ruleIds, noteRuleId: "L3.q6.map_it", correctAnswers: 3, totalAnswers: 3, keyPointOutcomes: [{ keyPointId: "k1", sourceTopicId: ids[0], text: "Water follows its potential gradient.", outcome: "secure" }], topicDone: true, escalated: false, produced: "Original first activity production.", comparison: { feedback: "Original first activity feedback.", missing: [], incorrect: [] }, elapsedSeconds: 120 };
  const restored: BaselineCheckpoint = { ...checkpoint, routeFingerprint: routeFingerprint(route, { workload }), segmentProgress: { activeSegmentId: "segment-2", completed: [{ segmentId: "segment-1", result, checkpoint }] } };
  return { segmentedProps, restored };
}
