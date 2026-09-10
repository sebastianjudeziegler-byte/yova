import { describe, expect, it } from "vitest";
import { blockFixture } from "./brief-c-block-fixture";
import { readSessionResourceFromStepData } from "@/lib/session-generation/resource";

function reopened(profile: 1 | 2) {
  const resource = readSessionResourceFromStepData({ generatedSession: JSON.parse(JSON.stringify(blockFixture(profile))) });
  return Reflect.get(resource ?? {}, "block") as ReturnType<typeof blockFixture>["block"] | undefined;
}

describe("Brief C saved block delivered to the learner", () => {
  it("reopens with the objective, source section, instructions, stopping point and duration intact", () => {
    const block = reopened(1);
    expect(block?.objective).toContain("ATP hydrolysis");
    expect(block?.sources[0]?.title).toBe("Cellular energetics lecture.pdf");
    expect(block?.sources[0]?.section).toContain("Page 1");
    expect(block?.instructions).toContain("Read page 1");
    expect(block?.stoppingPoint).toContain("attempt each practice question");
    expect(block?.estimatedMinutes).toBe(20);
  });

  it("preserves source first, then the same saved practice prompts on resume", () => {
    const before = blockFixture(1).block;
    const after = reopened(1);
    expect(after?.activities.map(activity => activity.kind)).toEqual(["read_source_section", "quiz"]);
    expect(after?.questions.map(question => question.prompt)).toEqual(before.questions.map(question => question.prompt));
    expect(after?.id).toBe(before.id);
    expect(after?.semanticReview).toEqual(before.semanticReview);
  });

  it("retains the visible P1/P2 example, hint and set-size delta after reopening the same PDF", () => {
    const p1 = reopened(1);
    const p2 = reopened(2);
    expect(p1?.questions[0]?.workedExample).toContain("regeneration");
    expect(p2?.questions[0]?.workedExample).toBeNull();
    expect(p1?.questions[0]?.hints).toHaveLength(2);
    expect(p2?.questions[0]?.hints).toHaveLength(0);
    expect(p1?.questions).toHaveLength(2);
    expect(p2?.questions).toHaveLength(3);
    expect(p1?.personalization.profileReason).toContain("short focus");
    expect(p2?.personalization.profileReason).toContain("own words");
  });

  it.each([
    ["cross-topic question", (value: ReturnType<typeof blockFixture>) => { value.block.questions[0]!.topicId = "c0000000-0000-4000-8000-000000000099"; }],
    ["foreign source section", (value: ReturnType<typeof blockFixture>) => { value.block.sources[0]!.topicId = "c0000000-0000-4000-8000-000000000099"; }],
    ["duplicate choices", (value: ReturnType<typeof blockFixture>) => { value.block.questions[0]!.choices[1] = value.block.questions[0]!.choices[0]!; }],
    ["duplicate question", (value: ReturnType<typeof blockFixture>) => { value.block.questions[1]!.prompt = value.block.questions[0]!.prompt; }],
    ["source with no practice", (value: ReturnType<typeof blockFixture>) => { value.block.activities.pop(); }],
    ["source-mode mismatch", (value: ReturnType<typeof blockFixture>) => { value.block.learningMode = "study"; value.methodBriefing.learningMode = "study"; }],
    ["stale route receipt", (value: ReturnType<typeof blockFixture>) => { value.routeRevisionId = "c0000000-0000-4000-8000-000000000099"; }],
    ["forged evidence in public work", (value: ReturnType<typeof blockFixture>) => { Object.assign(value.block, { conceptEvidence: [{ topicId: value.block.topicIds[0], outcome: "secure" }] }); }],
  ])("refuses %s instead of delivering it as valid practice", (_label, corrupt) => {
    const candidate = blockFixture();
    corrupt(candidate);
    expect(readSessionResourceFromStepData({ generatedSession: candidate })).toBeUndefined();
  });
});
