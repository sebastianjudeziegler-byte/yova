import { describe, expect, it, vi } from "vitest";
import failedSample from "./fixtures/ci410-invalid-osmosis-question.json";
import type { PracticeQuestion } from "@/lib/practice/compose-practice";
vi.mock("server-only", () => ({}));
import { reviewPracticeQuestions } from "./practice-quality-review";

const question = failedSample.question as PracticeQuestion;
const context = { topic: failedSample.topic, keyPoints: failedSample.keyPoints, explanation: failedSample.explanation, questions: [question] };
const verdict = (overrides = {}) => ({ slotId: question.slotId, answerIndices: [], issue: "ambiguous", reason: "A to B is the direction, but neither option combines that direction with higher water potential on A.", duplicateOfSlotId: null, ...overrides });

describe("independent practice answer review", () => {
  it("rejects the retained live question with no fully correct option, without exposing its proposed key to the reviewer", async () => {
    const provider = vi.fn(async () => ({ reviews: [verdict()] }));
    const result = await reviewPracticeQuestions(context, provider as never);
    expect(result).toMatchObject({ ok: true, rejected: [{ slotId: "s12" }] });
    const input = JSON.parse((provider.mock.calls as unknown as [{ input: string }][])[0]![0].input);
    expect(input.questions[0]).not.toHaveProperty("correctChoiceIndex");
    expect(input.questions[0].choices).toEqual(question.choices);
  });

  it("refuses a wrong key even if the review finds one valid option", async () => {
    const result = await reviewPracticeQuestions(context, vi.fn(async () => ({ reviews: [verdict({ answerIndices: [3], issue: "none" })] })) as never);
    expect(result).toMatchObject({ ok: true, rejected: [{ slotId: "s12" }] });
  });

  it.each(["explanation", "unsupported", "wrong_type", "weak_distractors", "repeated"])("rejects %s despite a matching answer index", async issue => {
    const result = await reviewPracticeQuestions(context, vi.fn(async () => ({ reviews: [verdict({ answerIndices: [0], issue })] })) as never);
    expect(result).toMatchObject({ ok: true, rejected: [{ slotId: "s12" }] });
  });

  it("accepts only a complete, unique review with one matching answer and no quality issue", async () => {
    const provider = vi.fn(async () => ({ reviews: [verdict({ answerIndices: [0], issue: "none", reason: "A valid fixture for the review transport contract." })] }));
    expect(await reviewPracticeQuestions(context, provider as never)).toEqual({ ok: true, rejected: [] });
  });

  it.each([{ reviews: [] }, { reviews: [verdict(), verdict()] }, { reviews: [verdict({ slotId: "unknown" })] }])("rejects missing, duplicated or invented review IDs", async ({ reviews }) => {
    expect(await reviewPracticeQuestions(context, vi.fn(async () => ({ reviews })) as never)).toEqual({ ok: false });
  });

  it("preserves accepted questions as context when checking repaired slots for repetition", async () => {
    const provider = vi.fn(async () => ({ reviews: [verdict()] }));
    await reviewPracticeQuestions({ ...context, priorQuestions: [{ ...question, slotId: "s1" }] }, provider as never);
    const input = JSON.parse((provider.mock.calls as unknown as [{ input: string }][])[0]![0].input);
    expect(input.priorQuestions[0].slotId).toBe("s1");
    expect(input.priorQuestions[0]).not.toHaveProperty("correctChoiceIndex");
  });

  it("reports only aggregate rejected counts, never learner content or rejection reasons", async () => {
    const diagnose = vi.fn();
    const provider = Object.assign(vi.fn(async () => ({ reviews: [verdict({ reason: "private rejection content" })] })), { diagnose });
    await reviewPracticeQuestions(context, provider as never);
    expect(diagnose).toHaveBeenCalledExactlyOnceWith({ stage: "quality", schemaName: "yova_practice_quality_review", outcome: "completed", questionCount: 1, rejectedCount: 1 });
    expect(JSON.stringify(diagnose.mock.calls)).not.toContain("private");
  });

  it("distinguishes incomplete review coverage from zero rejected questions", async () => {
    const diagnose = vi.fn();
    const provider = Object.assign(vi.fn(async () => ({ reviews: [] })), { diagnose });
    expect(await reviewPracticeQuestions(context, provider as never)).toEqual({ ok: false });
    expect(diagnose).toHaveBeenCalledExactlyOnceWith({ stage: "quality", schemaName: "yova_practice_quality_review", outcome: "invalid", questionCount: 1 });
  });
});
