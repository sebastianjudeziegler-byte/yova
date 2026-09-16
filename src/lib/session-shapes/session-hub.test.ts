import { describe, expect, it } from "vitest";
import { emptyOnboardingAnswers, withOnboardingAnswer } from "@/lib/onboarding/answers";
import { routeSession, withStudyOutside, type RoutingInput } from "@/lib/routing/session-route";
import { hubRail, splitMinutes, timerView } from "./session-hub";
import { initialShapeAState, shapeAReducer } from "./shape-a";
import { initialShapeCState, shapeCReducer } from "./shape-c";

function route(overrides: Partial<RoutingInput> = {}, answers: Record<string, string | string[]> = {}) {
  let record = emptyOnboardingAnswers();
  for (const [id, value] of Object.entries(answers)) record = withOnboardingAnswer(record, id as never, value);
  return routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: true, topicHasProblems: false, answers: record, ...overrides });
}

describe("session hub rail", () => {
  it("splits the timer across steps in the handoff's proportions and keeps the total", () => {
    expect(splitMinutes(25, [10, 8, 3, 4])).toEqual([10, 8, 3, 4]);
    expect(splitMinutes(15, [10, 8, 3, 4]).reduce((sum, value) => sum + value, 0)).toBe(15);
    expect(splitMinutes(40, [4, 12, 5]).reduce((sum, value) => sum + value, 0)).toBe(40);
  });

  it("Shape A shows study, produce, compare, repair, end, and follows the reducer", () => {
    const routed = route();
    const cState = initialShapeCState(routed);
    let aState = initialShapeAState(routed);
    let rail = hubRail({ route: routed, aState, cState, atEnd: false, inQuestions: false });
    expect(rail.kicker).toBe("SHAPE A · STUDY → PRODUCE → COMPARE → REPAIR");
    expect(rail.rows.map((row) => row.key)).toEqual(["study", "produce", "compare", "repair", "end"]);
    expect(rail.rows.map((row) => row.status)).toEqual(["current", "future", "future", "future", "future"]);
    expect(rail.rows.at(-1)!.minutes).toBeNull();
    expect(rail.tipStep).toBe("study");
    expect(rail.stepNumber).toBe(1);
    // direct → away stays on the study row
    aState = shapeAReducer(aState, { type: "continue" });
    expect(hubRail({ route: routed, aState, cState, atEnd: false, inQuestions: false }).stepNumber).toBe(1);
    aState = shapeAReducer(aState, { type: "continue" });
    rail = hubRail({ route: routed, aState, cState, atEnd: false, inQuestions: false });
    expect(rail.rows.map((row) => row.status)).toEqual(["done", "current", "future", "future", "future"]);
    expect(rail.tipStep).toBe("produce");
    expect(rail.stepNumber).toBe(2);
    expect(rail.stepCount).toBe(5);
  });

  it("try-then-feedback puts produce before study", () => {
    const routed = route({}, { difficulty_help: "try_then_feedback" });
    const rail = hubRail({ route: routed, aState: initialShapeAState(routed), cState: initialShapeCState(routed), atEnd: false, inQuestions: false });
    expect(rail.rows.map((row) => row.key)).toEqual(["produce", "study", "compare", "repair", "end"]);
    expect(rail.kicker).toBe("SHAPE A · PRODUCE → STUDY → COMPARE → REPAIR");
  });

  it("Shape C shows closed-book practice rounds and review", () => {
    const routed = route({ taskType: "memorization", blockKind: "practice" });
    let cState = initialShapeCState(routed);
    const aState = initialShapeAState(routed);
    let rail = hubRail({ route: routed, aState, cState, atEnd: false, inQuestions: true });
    expect(rail.kicker).toBe("SHAPE C · CLOSED-BOOK PRACTICE");
    expect(rail.rows.map((row) => row.label)).toEqual(["Closed-book round 1", "Round review", "Session complete"]);
    expect(rail.tipStep).toBe("questions");
    cState = shapeCReducer(cState, { type: "questions_ready", questions: [{ id: "q1", slotId: "s1", kind: "recall", keyPointIds: ["k1"], prompt: "Which one?", choices: ["A", "B", "C", "D"], correctChoiceIndex: 0, explanation: "A is right." }] });
    cState = shapeCReducer(cState, { type: "answer", choiceIndex: 1 });
    cState = shapeCReducer(cState, { type: "next" });
    rail = hubRail({ route: routed, aState, cState, atEnd: false, inQuestions: true });
    expect(rail.tipStep).toBe("round");
    expect(rail.rows.map((row) => row.status)).toEqual(["done", "current", "future"]);
    rail = hubRail({ route: routed, aState, cState, atEnd: true, inQuestions: true });
    expect(rail.tipStep).toBe("end");
    expect(rail.rows.at(-1)!.status).toBe("current");
  });

  it("a memorization learn block opens on brief study", () => {
    const routed = route({ taskType: "memorization", blockKind: "learn" });
    const rail = hubRail({ route: routed, aState: initialShapeAState(routed), cState: initialShapeCState(routed), atEnd: false, inQuestions: false });
    expect(rail.rows[0]!.label).toBe("Brief study");
    expect(rail.tipStep).toBe("brief");
  });

  it("the Active Recall hand-off shows study then closed-book questions", () => {
    const routed = route({}, { prove_knowing: "answer_questions" });
    expect(routed.produceStep).toBe("retrieval_questions");
    const rail = hubRail({ route: routed, aState: initialShapeAState(routed), cState: initialShapeCState(routed), atEnd: false, inQuestions: false });
    expect(rail.kicker).toBe("SHAPE A · STUDY → CLOSED-BOOK QUESTIONS");
    expect(rail.rows.map((row) => row.key)).toEqual(["study", "questions", "round", "end"]);
    expect(rail.tipStep).toBe("study");
  });
});

describe("session hub rail outside YOVA", () => {
  it("shows studying outside, then closed-book questions", () => {
    const routed = withStudyOutside(route({ hasSource: false }));
    const rail = hubRail({ route: routed, aState: initialShapeAState(routed), cState: initialShapeCState(routed), atEnd: false, inQuestions: false });
    expect(rail.rows.map((row) => row.label)).toEqual(["Study outside YOVA", "Closed-book round 1", "Round review", "Session complete"]);
    expect(rail.tipStep).toBe("study");
  });
});

describe("hub timer", () => {
  it("adds the +5s, flags over time, and raises the banner again after a +5 is used up", () => {
    const base = { elapsedSeconds: 26 * 60, timerMinutes: 25, extraMinutes: 0, acknowledgedLimit: null };
    expect(timerView(base)).toMatchObject({ limitMinutes: 25, over: true, banner: true, progress: 1 });
    expect(timerView({ ...base, acknowledgedLimit: 25 }).banner).toBe(false);
    expect(timerView({ ...base, extraMinutes: 5, acknowledgedLimit: 25 })).toMatchObject({ limitMinutes: 30, over: false, banner: false });
    expect(timerView({ ...base, elapsedSeconds: 31 * 60, extraMinutes: 5, acknowledgedLimit: 25 })).toMatchObject({ over: true, banner: true });
    expect(timerView({ ...base, elapsedSeconds: 5 * 60 }).progress).toBeCloseTo(0.2);
  });
});
