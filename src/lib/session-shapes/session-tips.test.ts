import { describe, expect, it } from "vitest";
import { emptyOnboardingAnswers, withOnboardingAnswer } from "@/lib/onboarding/answers";
import { routeSession, type RoutingInput } from "@/lib/routing/session-route";
import { settleTips, studyTipRequests, tipInstructions, tipRequest, TIP_EXEMPLARS, visibleTip, type SessionTip } from "./session-tips";

function route(overrides: Partial<RoutingInput> = {}, answers: Record<string, string | string[]> = {}) {
  let record = emptyOnboardingAnswers();
  for (const [id, value] of Object.entries(answers)) record = withOnboardingAnswer(record, id as never, value);
  return routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: true, topicHasProblems: false, answers: record, ...overrides });
}

// Brief 1.5 item 6: an instruction, then one sentence of reason drawn from a rule that fired.
describe("session tips", () => {
  it("offers each step only reasons from rules that fired, most relevant first", () => {
    const routed = route({}, { prove_knowing: "map_it", support_needs: ["frequent_check_ins"] });
    const requested = tipRequest(routed, ["produce", "repair", "end"]);
    expect(requested.map((entry) => entry.step)).toEqual(["produce", "repair", "end"]);
    for (const entry of requested) {
      expect(entry.reasons.length).toBeGreaterThan(0);
      for (const reason of entry.reasons) expect(routed.ruleIds).toContain(reason.ruleId);
    }
    expect(requested[0]!.reasons[0]!.ruleId).toBe("L3.q6.map_it");
    expect(requested[1]!.reasons[0]!.ruleId).toBe("L4.q9.frequent_check_ins");
  });

  it("keeps the produce tip when a mapped learning block also includes planned questions", () => {
    const routed = route({}, { prove_knowing: "map_it" });
    const requested = studyTipRequests(routed, true);
    expect(requested.learnBlock.map((tip) => tip.step)).toEqual(["study", "produce", "questions", "round", "end"]);
    expect(requested.direction.map((tip) => tip.step)).toEqual(["study", "produce"]);
    expect(requested.learnBlock.find((tip) => tip.step === "produce")?.reasons[0]?.ruleId).toBe("L3.q6.map_it");
    expect(studyTipRequests(route({ taskType: "memorization" }), true).learnBlock.map((tip) => tip.step)).toEqual(["brief", "questions", "round", "end"]);
    expect(studyTipRequests(route({}, { prove_knowing: "answer_questions" }), true).learnBlock.map((tip) => tip.step)).not.toContain("produce");
  });

  it("keeps a valid generated tip and replaces an invented rule with a template tip on a fired rule", () => {
    const routed = route({}, { prove_knowing: "map_it" });
    const requested = tipRequest(routed, ["produce", "compare"]);
    const tips = settleTips(requested, [
      { step: "produce", title: "Draw the links before the labels.", body: "You said mapping is how you prove you know something, so the links are the part that counts.", ruleId: "L3.q6.map_it" },
      { step: "compare", title: "Check every arrow.", body: "You told us you rush comparisons.", ruleId: "L9.invented" },
    ]);
    expect(tips).toHaveLength(2);
    expect(tips[0]).toMatchObject({ step: "produce", ruleId: "L3.q6.map_it", origin: "generated" });
    expect(tips[1]!.origin).toBe("template");
    expect(routed.ruleIds).toContain(tips[1]!.ruleId);
    expect(tips[1]!.body).toBe(requested[1]!.reasons[0]!.sentence);
  });

  it("refuses a generated tip for a step nobody asked for, or a second tip for one step", () => {
    const requested = tipRequest(route({}, { prove_knowing: "map_it" }), ["produce"]);
    const tips = settleTips(requested, [
      { step: "end", title: "Say it out loud once tonight.", body: "Because you prove knowledge by mapping, retell it.", ruleId: "L3.q6.map_it" },
      { step: "produce", title: "Draw the links before the labels.", body: "You said mapping is how you prove you know it.", ruleId: "L3.q6.map_it" },
      { step: "produce", title: "A second produce tip here.", body: "You said mapping is how you prove you know it.", ruleId: "L3.q6.map_it" },
    ]);
    expect(tips.map((tip) => tip.step)).toEqual(["produce"]);
    expect(tips[0]!.title).toBe("Draw the links before the labels.");
  });

  it("never lets a tip claim an example that was not shown", () => {
    const routed = route({}, { difficulty_help: "concrete_example" });
    const requested = tipRequest(routed, ["study"]);
    expect(requested[0]!.reasons[0]!.ruleId).toBe("L3.q5.concrete_example");
    const tips = settleTips(requested, [{ step: "study", title: "Trace the example step by step.", body: "You said a concrete example helps most.", ruleId: "L3.q5.concrete_example" }], { exampleShown: false });
    expect(tips[0]!.ruleId).not.toBe("L3.q5.concrete_example");
    expect(`${tips[0]!.title} ${tips[0]!.body}`).not.toMatch(/example/i);
  });

  it("the screen shows a tip only when its rule is in route.ruleIds", () => {
    const routed = route({}, { prove_knowing: "map_it" });
    const tip: SessionTip = { step: "produce", title: "Draw the links first.", body: "Because you prove knowledge by mapping, this session used Concept Mapping.", ruleId: "L3.q6.map_it", origin: "template" };
    expect(visibleTip({ produce: tip }, "produce", routed)).toEqual(tip);
    expect(visibleTip({ produce: { ...tip, ruleId: "L3.q6.explain_back" } }, "produce", routed)).toBeNull();
    expect(visibleTip({}, "produce", routed)).toBeNull();
  });

  it("shows the offered missed-point retry tip before a second round has actually run", () => {
    const routed = route({ taskType: "memorization", blockKind: "learn" });
    const [tip] = settleTips(tipRequest(routed, ["round"], { practiceOccurred: true }), []);
    expect(tip?.ruleId).toBe("L4.practice.error_repair.after_missed_round");
    expect(visibleTip({ round: tip }, "round", routed, { practiceOccurred: true, repairRoundOccurred: false, repairRoundAvailable: true })).toMatchObject({
      step: "round", ruleId: "L4.practice.error_repair.after_missed_round",
    });
    expect(visibleTip({ round: tip }, "round", routed, { practiceOccurred: true, repairRoundOccurred: false, repairRoundAvailable: false })).toBeNull();
  });

  it("puts the handoff table in the prompt as exemplars, not as copy", () => {
    const instructions = tipInstructions(["study", "questions"]);
    expect(instructions).toContain(TIP_EXEMPLARS.study[0]!.title);
    expect(instructions).toContain(TIP_EXEMPLARS.questions[0]!.title);
    expect(instructions).toMatch(/style/i);
    expect(instructions).toMatch(/ruleId/);
    expect(tipInstructions([])).toBe("");
  });

  it("two contrasting profiles get different reasons on the same step", () => {
    const mapper = tipRequest(route({}, { prove_knowing: "map_it" }), ["produce"]);
    const explainer = tipRequest(route({}, { prove_knowing: "explain_back", support_needs: ["simpler_repeated_instructions"] }), ["produce"]);
    expect(mapper[0]!.reasons[0]!.ruleId).not.toBe(explainer[0]!.reasons[0]!.ruleId);
  });
});
