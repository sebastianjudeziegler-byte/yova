import { writeFileSync, appendFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { generationContext } from "./brief-c-generation-fixture";
import { generateWorkBlock } from "@/lib/session-blocks/generate";
import { createBlockProvider } from "@/lib/session-blocks/provider";
import { advanceBlockProgress, initialBlockProgress } from "@/lib/session-blocks/progress";
import { WorkBlockSchema } from "@/lib/session-blocks/schema";

vi.mock("server-only", () => ({}));

// Fixture-only capture: exact preparation and review, including rejected
// candidates. Never includes credentials or authentic learner data.
function capturedProvider() {
  const provider = createBlockProvider();
  const record = (value: unknown) => { if (process.env.YOVA_BLOCK_CAPTURE) appendFileSync(process.env.YOVA_BLOCK_CAPTURE, JSON.stringify(value) + "\n"); };
  return { ...provider,
    generate: async (...args: Parameters<typeof provider.generate>) => { const output = await provider.generate(...args); record({ stage: "fill", input: args[0], output }); return output; },
    review: async (...args: Parameters<typeof provider.review>) => { const output = await provider.review(...args); record({ stage: "review", input: args[0], output }); return output; },
  };
}

const subjects = [
  { label: "biology terminology", kind: "flashcards", title: "Memorize ATP terminology", objective: "Recall the names of ATP hydrolysis products and regeneration inputs.", text: "ATP stands for adenosine triphosphate. ADP stands for adenosine diphosphate. Inorganic phosphate is abbreviated Pi. Hydrolysis of ATP with water produces ADP and Pi. Regeneration requires ADP, Pi, and energy from another reaction." },
  { label: "programming calculation", kind: "problems", title: "Calculate Python list sums", objective: "Trace a Python loop that adds the numbers in a list.", text: "In Python, total = 0 initializes an accumulator. The loop for value in numbers: total += value visits each element once and adds it to total. For numbers = [2, 5], total becomes 2 then 7. For an empty list it remains 0. Negative numbers are added normally: [4, -1] totals 3. A repeated number is added for each occurrence." },
  { label: "history argument", kind: "quiz", title: "Write an evidence-supported history argument", objective: "Support a bounded claim about workers' conditions using an assigned historical source.", text: "This fictional teaching source describes a nineteenth-century town. A mill inspector recorded twelve-hour shifts in 1840. A workers' petition in 1842 requested ten-hour shifts, citing exhaustion. The mill owner's 1842 ledger records rising production but no shift-length change. These sources support the claim that workers sought shorter hours despite rising output; they do not establish that the demand succeeded or that every town had the same conditions." },
] as const;

describe.skipIf(process.env.YOVA_RUN_LIVE_BLOCKS !== "1")("Brief C prepared practice quality", () => {
  it.each(subjects)("delivers source-supported $label as $kind", async subject => {
    const context = generationContext(1);
    const topic = context.knowledgeTopics[0]!;
    topic.title = subject.title; topic.description = subject.objective;
    context.learningGoal.title = subject.title; context.learningGoal.topic = subject.title;
    context.session.objective = subject.objective; context.session.title = subject.title;
    context.materials[0]!.text = subject.text;
    context.materials[0]!.name = `${subject.label} lecture.pdf`;
    context.materials[0]!.locationLabel = `Page 1 — ${subject.title}`;
    topic.sourceReferences[0]!.locationLabel = context.materials[0]!.locationLabel;
    context.session.contentTargets = [subject.title]; context.session.completionEvidence = [subject.objective];
    const prepared = await generateWorkBlock(context, {}, capturedProvider());
    const block = WorkBlockSchema.parse(prepared.block);
    expect(block.activities[0]?.kind).toBe("read_source_section");
    const practice = block.activities.find(activity => activity.questionIds.length)!;
    expect(practice.kind).toBe(subject.kind);
    expect(block.semanticReview.status).toBe("passed");
    expect(prepared.answerKeys.every(key => key.sourceIds.includes(block.sources[0]!.id))).toBe(true);
    if (subject.kind === "problems") expect(prepared.answerKeys.every(key => key.workedSolution.length > 0)).toBe(true);
    if (subject.kind === "quiz") expect(block.questions.every(question => question.format === "short_answer")).toBe(true);
    console.info(JSON.stringify({ subject: subject.label, block, answers: prepared.answerKeys }));
  }, 100_000);

  it("A17 starts broad calculus with the assigned prerequisite-ready function block", async () => {
    const context = generationContext(1, "learn", false);
    context.learningGoal.title = "Understand broad calculus"; context.learningGoal.topic = "Calculus";
    context.planRationale = "Start with function inputs and outputs, then follow the saved calculus pathway.";
    context.session.title = "Read function notation";
    context.session.objective = "Interpret the input and output of a function written as f(x).";
    context.session.contentTargets = ["Function inputs and outputs"];
    context.session.completionEvidence = [context.session.objective];
    context.knowledgeTopics[0]!.title = "Function inputs and outputs";
    context.knowledgeTopics[0]!.description = context.session.objective;
    const before = structuredClone(context);
    const { block } = await generateWorkBlock(context, {}, capturedProvider());
    expect(block.activities[0]!.kind).toBe("ai_explanation");
    expect(block.instructions).toContain("Function inputs and outputs");
    expect(block.instructions).toContain("wider calculus pathway continues in later blocks");
    expect(block.topicIds).toEqual(context.session.topicIds);
    expect(block.questions.every(question => question.topicId === context.session.topicIds[0])).toBe(true);
    expect(block.semanticReview.status).toBe("passed");
    expect(context).toEqual(before);
  }, 100_000);

  it("delivers three practice differences for the same PDF and profile-referencing receipts", async () => {
    const delivered = [];
    for (const profile of [1, 2] as const) {
      const { block } = await generateWorkBlock(generationContext(profile), {}, capturedProvider());
      // Reveal/continue is a legitimate completion with no demonstrated evidence.
      let progress = initialBlockProgress(block.id);
      for (const source of block.sources) progress = advanceBlockProgress(block, progress, { action: "source_complete", sourceId: source.id });
      for (const question of block.questions) progress = advanceBlockProgress(block, progress, { action: "reveal", questionId: question.id });
      progress = advanceBlockProgress(block, progress, { action: "complete" });
      delivered.push({ block, receipt: progress.receipt });
    }
    const [p1, p2] = delivered;
    expect(p1!.block.activities[0]!.kind).toBe("read_source_section");
    expect(p2!.block.activities[0]!.kind).toBe("read_source_section");
    expect(p1!.block.sources[0]!.text).toBe(p2!.block.sources[0]!.text);
    const differences = [
      p1!.block.activities.find(item => item.questionIds.length)!.kind !== p2!.block.activities.find(item => item.questionIds.length)!.kind,
      Boolean(p1!.block.questions[0]!.workedExample) !== Boolean(p2!.block.questions[0]!.workedExample),
      Boolean(p1!.block.questions[0]!.hints.length) !== Boolean(p2!.block.questions[0]!.hints.length),
      p1!.block.questions.length !== p2!.block.questions.length,
    ];
    expect(differences.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(p1!.receipt).toMatch(/short check|example/i); expect(p2!.receipt).toMatch(/own words/i);
    expect(p1!.receipt).not.toBe(p2!.receipt);
    if (process.env.YOVA_BLOCK_PRINTOUT) writeFileSync(process.env.YOVA_BLOCK_PRINTOUT, JSON.stringify({ P1: p1, P2: p2 }, null, 2));
  }, 190_000);

  it("rejects semantically ambiguous, unsupported, and duplicate quiz items without retrying", async () => {
    const context = generationContext(1);
    const prepared = await generateWorkBlock(context, {}, capturedProvider());
    const review = capturedProvider();
    const outcomes = [];
    for (const flaw of ["ambiguous", "unsupported", "duplicate"] as const) {
      const block = structuredClone(prepared.block); const answerKeys = structuredClone(prepared.answerKeys);
      if (flaw === "ambiguous") {
        block.questions[0]!.format = "multiple_choice";
        block.questions[0]!.prompt = "Which process uses or transforms energy?";
        block.questions[0]!.choices = ["ATP regeneration", "ATP hydrolysis", "Neither process"];
        answerKeys[0]!.answer = "ATP hydrolysis";
      } else if (flaw === "unsupported") {
        block.questions[0]!.prompt = "Name the exact molecular structure and atomic mass of chlorophyll a.";
        answerKeys[0]!.answer = "C55H72MgN4O5, about 893.5 g/mol";
      } else {
        block.questions[1] = { ...block.questions[0]!, id: block.questions[1]!.id };
        answerKeys[1] = { ...answerKeys[0]!, questionId: answerKeys[1]!.questionId };
      }
      const result = await review.review({ block, answerKeys, assignedTopics: context.knowledgeTopics, deferredContent: ["Photosynthesis and chlorophyll"] }, { timeoutMs: 25_000 });
      outcomes.push({ flaw, ...result });
    }
    expect(outcomes.filter(result => result.verdict !== "fail")).toEqual([]);
  }, 170_000);
});
