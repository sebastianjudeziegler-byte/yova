import { describe, expect, it } from "vitest";
import { emptyOnboardingAnswers, withOnboardingAnswer } from "@/lib/onboarding/answers";
import { personalizationNote } from "./personalization-note";
import { routeSession, type RoutingInput } from "./session-route";

function route(overrides: Partial<RoutingInput> = {}, answers: Record<string, string | string[]> = {}) {
  let record = emptyOnboardingAnswers();
  for (const [id, value] of Object.entries(answers)) record = withOnboardingAnswer(record, id as never, value);
  return routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: true, topicHasProblems: false, answers: record, ...overrides });
}

describe("personalization note", () => {
  it("names the rule that fired and one sentence for it", () => {
    const note = personalizationNote(route({}, { prove_knowing: "map_it" }));
    expect(note).toEqual({ ruleId: "L3.q6.map_it", sentence: "Because you prove knowledge by mapping, this session used Concept Mapping." });
  });

  it("prefers the accessibility override over the preference it overrode", () => {
    const note = personalizationNote(route({}, { prove_knowing: "explain_back", support_needs: ["reduced_text_visual_structure"] }));
    expect(note.ruleId).toBe("C2.q9_visual_overrides_q6");
  });

  it("falls back to the task default sentence when no profile rule fired", () => {
    const note = personalizationNote(route());
    expect(note.ruleId).toBe("L1.conceptual_learning.learn");
    expect(note.sentence).toContain("Feynman Technique");
  });

  // Brief 1.5 item 5: never claim a personalization that did not happen.
  it("claims the example only when one was actually shown", () => {
    const examplesFirst = route({}, { difficulty_help: "concrete_example" });
    expect(personalizationNote(examplesFirst, { exampleShown: true })).toEqual({ ruleId: "L3.q5.concrete_example", sentence: "Because you said a concrete example helps most, YOVA showed a worked example before asking you to produce." });
    const withoutExample = personalizationNote(examplesFirst, { exampleShown: false });
    expect(withoutExample.ruleId).not.toBe("L3.q5.concrete_example");
    expect(withoutExample.sentence).not.toMatch(/example/i);
    const q10 = route({}, { extra_context: "examples_before_ready" });
    expect(personalizationNote(q10, { exampleShown: false }).ruleId).not.toBe("L3.q10.examples_before_ready");
  });

  it("is exactly one sentence", () => {
    for (const answers of [{}, { difficulty_help: "concrete_example" }, { support_needs: ["shorter_sections"] }, { extra_context: "forget_during_tests" }]) {
      const { sentence } = personalizationNote(route({}, answers as never));
      expect(sentence.match(/[.!?](\s|$)/g)?.length).toBe(1);
    }
  });
});
