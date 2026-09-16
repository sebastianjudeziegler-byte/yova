import { describe, expect, it } from "vitest";
import { emptyOnboardingAnswers, withOnboardingAnswer } from "@/lib/onboarding/answers";
import { personalizationNote } from "./personalization-note";
import { chosenBecause, ruleEvidence } from "./rule-evidence";
import { routeSession, type RoutingInput } from "./session-route";

function route(overrides: Partial<RoutingInput> = {}, answers: Record<string, string | string[]> = {}) {
  let record = emptyOnboardingAnswers();
  for (const [id, value] of Object.entries(answers)) record = withOnboardingAnswer(record, id as never, value);
  return routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: true, topicHasProblems: false, answers: record, ...overrides });
}

// Brief 1.5 items 6 and 7: every reason shown to the learner is evidence of a rule that fired.
describe("rule evidence", () => {
  it("only ever names rules that fired, each with a short head and one sentence", () => {
    const routed = route({}, { prove_knowing: "map_it", gist_detail: "gist_leaning" });
    const evidence = ruleEvidence(routed);
    expect(evidence.map((entry) => entry.ruleId)).toEqual(expect.arrayContaining(["L3.q6.map_it", "L4.mix.conceptual_learning", "L4.q7.gist_leaning.mix_recall"]));
    for (const entry of evidence) {
      expect(routed.ruleIds).toContain(entry.ruleId);
      expect(entry.head.length).toBeGreaterThan(4);
      expect(entry.head).not.toMatch(/^Because/);
      expect(entry.sentence.match(/[.!?](\s|$)/g)?.length).toBe(1);
    }
  });

  it("ranks the personalization note's rule first, so the note and the evidence agree", () => {
    const routed = route({}, { prove_knowing: "explain_back", support_needs: ["reduced_text_visual_structure"] });
    expect(ruleEvidence(routed)[0]?.ruleId).toBe(personalizationNote(routed).ruleId);
  });

  it("names Shape C practice rounds and the question mix, but never the topic difficulty", () => {
    const routed = route({ taskType: "memorization", blockKind: "practice", daysToDeadline: 2, subtopicCount: 9, prerequisiteDepth: 3 });
    expect(routed.ruleIds).toContain("L4.difficulty.high");
    const ids = ruleEvidence(routed).map((entry) => entry.ruleId);
    expect(ids).toContain("L4.practice.practice_test.deadline_within_3_days");
    expect(ids).toContain("L4.mix.memorization");
    expect(ids.some((id) => id.startsWith("L4.difficulty") || id.startsWith("C8."))).toBe(false);
  });

  it("drops a claimed example that was not shown", () => {
    const routed = route({}, { difficulty_help: "concrete_example" });
    expect(ruleEvidence(routed, { exampleShown: true }).map((entry) => entry.ruleId)).toContain("L3.q5.concrete_example");
    expect(ruleEvidence(routed, { exampleShown: false }).map((entry) => entry.ruleId)).not.toContain("L3.q5.concrete_example");
  });

  it("chosen-because pills are the evidence heads, and fall back to the task default", () => {
    const pills = chosenBecause(route({}, { prove_knowing: "map_it" }));
    expect(pills[0]).toEqual({ ruleId: "L3.q6.map_it", head: "you prove knowledge by mapping" });
    const defaults = chosenBecause(route({ blockKind: "learn" }));
    expect(defaults.length).toBeGreaterThan(0);
    for (const pill of defaults) expect(route().ruleIds).toContain(pill.ruleId);
  });
});
