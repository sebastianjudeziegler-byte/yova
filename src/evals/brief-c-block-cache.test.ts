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
});
