import { describe, expect, it } from "vitest";
import { emptyOnboardingAnswers, withOnboardingAnswer } from "@/lib/onboarding/answers";
import { routeSession } from "@/lib/routing/session-route";
import { receiptEvidence } from "@/lib/routing/rule-evidence";
import { currentShapeAStep, initialShapeAState, shapeAReducer } from "./shape-a";

const route = routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: false, topicHasProblems: false, answers: emptyOnboardingAnswers() });
const original = { kind: "typed_explanation" as const, text: "Water moves from low water potential to high water potential." };
const feedback = { feedback: "The direction of movement is reversed.", missing: [], incorrect: ["Water moves from higher to lower water potential."] };
function atCompare() {
  return shapeAReducer(shapeAReducer(initialShapeAState(route), { type: "continue" }), { type: "submit_produce", produce: original });
}
function atRepair() {
  return shapeAReducer(shapeAReducer(atCompare(), { type: "comparison_ready", comparison: feedback }), { type: "continue" });
}

describe("session quality regression cases", () => {
  it("Move on without feedback exits compare and explicitly records unavailable feedback", () => {
    const state = shapeAReducer(atCompare(), { type: "skip_comparison" });
    expect(currentShapeAStep(state)?.kind).toBe("end");
    expect(state.comparisonUnavailable).toBe(true);
    expect(state.produce).toEqual(original);
  });

  it("submitting a repair waits for assessment and retains the original answer separately", () => {
    const submitted = shapeAReducer(atRepair(), { type: "submit_repair", text: "Water moves from higher to lower water potential." });
    expect(currentShapeAStep(submitted)?.kind).toBe("repair");
    expect(submitted.repairStatus).toBe("pending");
    expect(submitted.produce).toEqual(original);
    expect(submitted.comparison).toEqual(feedback);
    const checked = shapeAReducer(submitted, { type: "repair_comparison_ready", comparison: { feedback: "Your correction now gives the direction accurately.", missing: [], incorrect: [] } });
    expect(checked.repairComparison?.incorrect).toEqual([]);
    expect(checked.comparison?.incorrect).toHaveLength(1);
    expect(shapeAReducer(checked, { type: "submit_repair", text: "another answer" })).toBe(checked);
    expect(currentShapeAStep(shapeAReducer(checked, { type: "continue" }))?.kind).toBe("end");
  });

  it("an incorrect repair stays unresolved; a failed check keeps the correction unchecked", () => {
    const submitted = shapeAReducer(atRepair(), { type: "submit_repair", text: original.text });
    const checked = shapeAReducer(submitted, { type: "repair_comparison_ready", comparison: feedback });
    expect(checked.repairComparison?.incorrect).toHaveLength(1);
    const failed = shapeAReducer(submitted, { type: "repair_failed" });
    expect(failed.repair).toBe(original.text);
    expect(failed.repairStatus).toBe("error");
    expect(shapeAReducer(failed, { type: "continue" }).repairStatus).toBe("error");
  });

  it("retrieval overriding try-first cannot claim that the learner produced before study", () => {
    let answers = withOnboardingAnswer(emptyOnboardingAnswers(), "difficulty_help", "try_then_feedback");
    answers = withOnboardingAnswer(answers, "prove_knowing", "answer_questions");
    const retrieval = routeSession({ ...route.input, answers });
    const evidence = receiptEvidence(retrieval, { practiceOccurred: true });
    expect(evidence.some((entry) => /produced before studying/.test(entry.sentence))).toBe(false);
  });

  it("a writing session cannot claim that practice questions or extra rounds happened", () => {
    const evidence = receiptEvidence(route, { practiceOccurred: false });
    expect(evidence.some((entry) => /practice (asks|opens|asked)|round after a miss/.test(entry.sentence))).toBe(false);
  });
});
