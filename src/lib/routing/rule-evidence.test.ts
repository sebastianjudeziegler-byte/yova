import { describe, expect, it } from "vitest";
import { emptyOnboardingAnswers, withOnboardingAnswer } from "@/lib/onboarding/answers";
import { personalizationNote } from "./personalization-note";
import { chosenBecause, receiptEvidence, ruleEvidence } from "./rule-evidence";
import { applyTopicWorkloadToRoute } from "@/lib/plan-generation/topic-workload-route";
import { TopicWorkloadSchema } from "@/lib/plan-generation/topic-plan-contract";
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
    expect(evidence.map((entry) => entry.ruleId)).toContain("L3.q6.map_it");
    expect(evidence.map((entry) => entry.ruleId)).not.toContain("L4.mix.conceptual_learning");
    expect(ruleEvidence(routed, { practiceOccurred: true }).map((entry) => entry.ruleId)).toEqual(expect.arrayContaining(["L4.mix.conceptual_learning", "L4.q7.gist_leaning.mix_recall"]));
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

  it("describes check-ins as offered stopping points rather than automatic pauses", () => {
    const routed = route({}, { support_needs: ["frequent_check_ins"] });
    const claim = ruleEvidence(routed, { checkInsShown: true }).find(entry => entry.ruleId === "L4.q9.frequent_check_ins");
    expect(claim?.sentence).toContain("offered an explicit stopping point");
    expect(claim?.sentence).not.toContain("paused");
    expect(ruleEvidence(routed, { checkInsShown: false }).some(entry => entry.ruleId === "L4.q9.frequent_check_ins")).toBe(false);
  });

  it("chosen-because pills are the evidence heads, and fall back to the task default", () => {
    const pills = chosenBecause(route({}, { prove_knowing: "map_it" }));
    expect(pills[0]).toEqual({ ruleId: "L3.q6.map_it", head: "you prove knowledge by mapping" });
    const defaults = chosenBecause(route({ blockKind: "learn" }));
    expect(defaults.length).toBeGreaterThan(0);
    for (const pill of defaults) expect(route().ruleIds).toContain(pill.ruleId);
  });

  // CI #414: a 10-15 minute, loses-focus-very-often profile was delivered a
  // 22-minute, six-question block sized without its answers, and the end
  // receipt still told the learner it had a shorter allowance.
  const shortProfile = { session_length: "minutes_10_15", focus_loss: "very_often", support_needs: ["shorter_sections"] };
  const workload = (estimatedMinutes: number, questionCount: number) => TopicWorkloadSchema.parse({
    version: "topic_workload_v1", topicSubtopics: [{ topicId: "11111111-1111-4111-8111-111111111111", subtopics: ["Light absorption", "Energy carriers"] }],
    questionCount, recallQuestionCount: questionCount, transferQuestionCount: 0, produceSteps: 1, sourceReadMinutes: 4,
    estimatedMinutes, ceilingMinutes: estimatedMinutes, practicePlaceholder: false, practiceRound: 0, suggestedDate: false, ruleIds: ["plan.workload.content_estimate"],
  });
  const allowanceClaims = (estimatedMinutes: number, questionCount: number) =>
    receiptEvidence(applyTopicWorkloadToRoute(route({}, shortProfile), workload(estimatedMinutes, questionCount)), { practiceOccurred: true })
      .filter(entry => /allowance|smaller workload/u.test(entry.sentence));

  it("claims a shorter allowance only when the block delivered one", () => {
    const sized = allowanceClaims(11, 3);
    expect(sized.map(entry => entry.ruleId)).toEqual(expect.arrayContaining(["L4.q3.very_often", "L4.q9.shorter_sections", "L4.q2.minutes_10_15"]));
    for (const entry of sized) expect(entry.sentence).toContain("11-minute");

    for (const entry of allowanceClaims(22, 6)) {
      expect(entry.sentence, `${entry.ruleId} claims an allowance the block did not deliver`).not.toMatch(/shorter workload allowance|smaller workload|within your allowance/u);
    }
  });

  it("still names a focus or support rule whose allowance was not delivered, without the claim", () => {
    const receipt = receiptEvidence(applyTopicWorkloadToRoute(route({}, shortProfile), workload(22, 6)), { practiceOccurred: true });
    const ids = receipt.map(entry => entry.ruleId);
    expect(ids).toContain("L4.q3.very_often");
    expect(ids).toContain("L4.q9.shorter_sections");
    const focus = receipt.find(entry => entry.ruleId === "L4.q3.very_often")?.sentence ?? "";
    expect(focus).toContain("15 minutes");
    expect(focus).toContain("estimated at 22 minutes");
  });
});
