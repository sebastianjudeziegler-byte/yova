import { describe, expect, it, vi } from "vitest";
import failedSample from "./fixtures/ci410-invalid-osmosis-question.json";
import type { PracticeQuestion } from "@/lib/practice/compose-practice";
import type { SlotProviderCall } from "./shape-slot-generator";
vi.mock("server-only", () => ({}));
import { reviewPracticeQuestions } from "./practice-quality-review";

const question = failedSample.question as PracticeQuestion;
const context = { topic: failedSample.topic, keyPoints: failedSample.keyPoints, explanation: failedSample.explanation, questions: [question] };
const verdict = (overrides = {}) => ({ slotId: question.slotId, answerIndices: [], stemSufficient: true, demandMet: true, issue: "ambiguous", reason: "A to B is the direction, but neither option combines that direction with higher water potential on A.", duplicateOfSlotId: null, ...overrides });

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

  // Counts and the reviewer's fixed codes only (CI #429 needed to know why part
  // one was rejected); never learner content or the reviewer's own prose.
  it("reports only aggregate counts and fixed rejection codes, never learner content or the reviewer's prose", async () => {
    const diagnose = vi.fn();
    const provider = Object.assign(vi.fn(async () => ({ reviews: [verdict({ reason: "private rejection content" })] })), { diagnose });
    await reviewPracticeQuestions(context, provider as never);
    expect(diagnose).toHaveBeenCalledExactlyOnceWith({ stage: "quality", schemaName: "yova_practice_quality_review", outcome: "completed", questionCount: 1, rejectedCount: 1, rejectionCodes: { ambiguous: 1, answer_disagrees: 1 } });
    expect(JSON.stringify(diagnose.mock.calls)).not.toContain("private");
  });

  it("distinguishes incomplete review coverage from zero rejected questions", async () => {
    const diagnose = vi.fn();
    const provider = Object.assign(vi.fn(async () => ({ reviews: [] })), { diagnose });
    expect(await reviewPracticeQuestions(context, provider as never)).toEqual({ ok: false });
    expect(diagnose).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ stage: "quality", schemaName: "yova_practice_quality_review", outcome: "invalid", questionCount: 1 }));
  });

  // CI #427: both live failures were a re-review the provider returned complete
  // and schema-valid, then rejected here, with no record of which check failed.
  // The diagnostic now names it, with counts and codes only - never content.
  // CI #429: live part one lost 8 of 8 and 6 of 8 questions to review, and the
  // log said only how many. The completed diagnostic now tallies why, as the
  // reviewer's own codes - never the question or the reviewer's prose.
  it("tallies why questions were rejected, as codes only", async () => {
    const targets = ["s1", "s2", "s3", "s4"].map(slotId => ({ ...question, slotId }));
    const diagnose = vi.fn();
    const provider = Object.assign(vi.fn(async () => ({ reviews: [
      verdict({ slotId: "s1", answerIndices: [question.correctChoiceIndex], issue: "none", reason: "" }),
      verdict({ slotId: "s2", answerIndices: [question.correctChoiceIndex], issue: "repeated", duplicateOfSlotId: "s1", reason: "Same inference as s1." }),
      verdict({ slotId: "s3", answerIndices: [question.correctChoiceIndex], issue: "none", demandMet: false, reason: "Recall where application was asked." }),
      verdict({ slotId: "s4", answerIndices: [], issue: "ambiguous", stemSufficient: false, reason: "The outside solution is not described." }),
    ] })), { diagnose });
    const result = await reviewPracticeQuestions({ ...context, questions: targets }, provider as never);
    expect(result).toMatchObject({ ok: true, rejected: [{ slotId: "s2" }, { slotId: "s3" }, { slotId: "s4" }] });
    const completed = diagnose.mock.calls.map(([event]) => event).find(event => event.outcome === "completed");
    expect(completed).toMatchObject({ rejectedCount: 3, rejectionCodes: { repeated: 1, duplicate: 1, demand_not_met: 1, ambiguous: 1, missing_conditions: 1, answer_disagrees: 1 } });
    expect(JSON.stringify(completed)).not.toMatch(/Same inference|Recall where|outside solution|Osmosis|water/i);
  });

  it("names why a review reply was unusable, without any question content", async () => {
    const targets = [{ ...question, slotId: "s9" }, { ...question, slotId: "s14" }];
    const priorQuestions = [{ ...question, slotId: "s1" }, { ...question, slotId: "s2" }];
    const cases: Array<[unknown, Record<string, unknown>]> = [
      [null, { reason: "no_reply", expectedCount: 2, returnedCount: null }],
      [{ reviews: "not a list" }, { reason: "schema", expectedCount: 2, returnedCount: null }],
      [{ reviews: [verdict({ slotId: "s9" }), verdict({ slotId: "s14" }), verdict({ slotId: "s1" })] }, { reason: "coverage", expectedCount: 2, returnedCount: 3, priorReviewedCount: 1, unknownCount: 0, duplicateCount: 0 }],
      [{ reviews: [verdict({ slotId: "s9" }), verdict({ slotId: "s9" })] }, { reason: "coverage", expectedCount: 2, returnedCount: 2, priorReviewedCount: 0, unknownCount: 0, duplicateCount: 1 }],
      [{ reviews: [verdict({ slotId: "s9" }), verdict({ slotId: "s77" })] }, { reason: "coverage", expectedCount: 2, returnedCount: 2, priorReviewedCount: 0, unknownCount: 1, duplicateCount: 0 }],
    ];
    for (const [reply, invalidity] of cases) {
      const diagnose = vi.fn();
      const provider = Object.assign(vi.fn(async () => reply), { diagnose });
      expect(await reviewPracticeQuestions({ ...context, questions: targets, priorQuestions }, provider as never)).toEqual({ ok: false });
      const event = diagnose.mock.calls[0]![0];
      expect(event).toMatchObject({ outcome: "invalid", invalidity });
      expect(JSON.stringify(event)).not.toContain(question.prompt);
    }
  });

  it.each([24, 32])("reviews %i questions in parallel batches of at most eight with complete earlier-question context", async count => {
    const questions = Array.from({ length: count }, (_, index) => ({ ...question, slotId: `s${index + 1}` }));
    const prior = { ...question, slotId: "accepted-prior" };
    let active = 0, maxActive = 0;
    const provider = vi.fn(async (call: SlotProviderCall<unknown>) => {
      active += 1; maxActive = Math.max(active, maxActive);
      await Promise.resolve();
      active -= 1;
      const input = JSON.parse(call.input);
      return { reviews: input.questions.map((item: { slotId: string }) => verdict({ slotId: item.slotId, answerIndices: [question.correctChoiceIndex], issue: "none", reason: "" })) };
    });
    expect(await reviewPracticeQuestions({ ...context, questions, priorQuestions: [prior] }, provider as never)).toEqual({ ok: true, rejected: [] });
    expect(provider).toHaveBeenCalledTimes(count / 8);
    expect(maxActive).toBe(count / 8);
    const inputs = provider.mock.calls.map(([call]) => JSON.parse(call.input));
    expect(inputs.flatMap(input => input.questions.map((item: { slotId: string }) => item.slotId))).toEqual(questions.map(item => item.slotId));
    for (const [index, input] of inputs.entries()) {
      expect(input.questions).toHaveLength(8);
      expect(input.priorQuestions.map((item: { slotId: string }) => item.slotId)).toEqual([prior, ...questions.slice(0, index * 8)].map(item => item.slotId));
      expect([...input.questions, ...input.priorQuestions].every(item => !("correctChoiceIndex" in item))).toBe(true);
    }
  });

  it.each(["stemSufficient", "demandMet"])("returns an actionable rejection when %s is false despite a matching answer and issue=none", async field => {
    const provider = vi.fn(async () => ({ reviews: [verdict({ answerIndices: [question.correctChoiceIndex], issue: "none", reason: "The stem omits the relation needed for this inference.", stemSufficient: true, demandMet: true, [field]: false })] }));
    expect(await reviewPracticeQuestions(context, provider as never)).toMatchObject({ ok: true, rejected: [{ slotId: question.slotId, reason: expect.stringContaining(field === "stemSufficient" ? "missing_conditions" : "wrong_type") }] });
  });

  it("refuses the entire review when a later batch omits one target", async () => {
    const questions = Array.from({ length: 16 }, (_, index) => ({ ...question, slotId: `s${index + 1}` }));
    const provider = vi.fn(async (call: SlotProviderCall<unknown>) => {
      const input = JSON.parse(call.input);
      return { reviews: input.questions.filter((item: { slotId: string }) => item.slotId !== "s16").map((item: { slotId: string }) => verdict({ slotId: item.slotId, answerIndices: [question.correctChoiceIndex], issue: "none", reason: "" })) };
    });
    expect(await reviewPracticeQuestions({ ...context, questions }, provider as never)).toEqual({ ok: false });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  // CI #420: reviewing 32 questions splits into four calls, and the last batch —
  // eight questions against 24 earlier ones — came back "incomplete" twice, at
  // 1,230 output tokens. Reasoning is drawn from the same allowance, so the
  // batch with the most to compare against is the one that runs out.
  it("gives each review batch room for its questions and everything it must compare them against", async () => {
    const questions = Array.from({ length: 32 }, (_, index) => ({ ...question, slotId: `s${index + 1}`, prompt: `Osmosis case ${index + 1}?` }));
    const provider = vi.fn(async (call: SlotProviderCall<unknown>) => ({ reviews: JSON.parse(call.input).questions.map((target: { slotId: string }) => verdict({ slotId: target.slotId, answerIndices: [0], issue: "none", reason: "" })) }));
    expect(await reviewPracticeQuestions({ ...context, questions }, provider as never)).toEqual({ ok: true, rejected: [] });
    const calls = (provider.mock.calls as unknown as [SlotProviderCall<unknown>][]).map(([call]) => ({ ...JSON.parse(call.input), maxOutputTokens: call.maxOutputTokens }));
    expect(calls).toHaveLength(4);
    const last = calls.at(-1)!;
    expect(last.questions).toHaveLength(8);
    expect(last.priorQuestions).toHaveLength(24);
    for (const call of calls) {
      expect(call.maxOutputTokens, "a batch must not be cut off mid-review").toBeGreaterThanOrEqual(1_000 + call.questions.length * 150 + call.priorQuestions.length * 20);
    }
    expect(last.maxOutputTokens).toBeGreaterThan(calls[0]!.maxOutputTokens);
  });
});
