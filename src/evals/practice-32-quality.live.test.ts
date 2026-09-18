import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SlotDiagnostic, SlotProvider, SlotProviderCall } from "@/lib/openai/shape-slot-generator";
import { ShapeSlotResponseSchema, type LearnBlockResponse, type ShapeSlotResponse } from "@/lib/session-shapes/slots-schema";

vi.mock("server-only", () => ({}));

// Fixed synthetic input only. Full provider content belongs in this CI artifact,
// never production diagnostics or the ordinary test log. This deliberately uses
// the same topic and mix as the 32-question live API gate, without its HTTP/auth layer.
describe.skipIf(process.env.CI !== "true" || process.env.YOVA_RUN_LIVE_PRACTICE_QUALITY !== "1")("synthetic 32-question generation trace", () => {
  // Founder decision (18 Sept 2026, option B): the 32-question workload is one
  // sitting in four parts of eight, built up from recall. Each part is its own
  // request with its own 50-second provider budget, exactly as the session asks
  // for it: part one with the lesson, later parts carrying the key points and
  // every earlier prompt.
  it("delivers the 32-question workload as four reviewed parts, each within its own provider budget", async () => {
    const { fillShapeSlot, openAIShapeSlotProvider } = await import("@/lib/openai/shape-slot-generator");
    const base = {
      planId: randomUUID(), planSessionId: randomUUID(), tips: [],
      topic: {
        id: "b729504a-8746-4ef3-a4c2-d3b7116c8138", title: "Osmosis",
        description: "Predict net water movement from water potential and explain the role of a partially permeable membrane.",
        subtopics: ["Water potential", "Membrane permeability", "Plant cell turgor"], taskType: "conceptual_learning" as const,
        learningGoal: "Prepare for A-level Biology application questions: predict the effect of unfamiliar conditions on water movement and justify the mechanism.",
      },
      modifiers: { instructionStyle: "standard" as const, questionMix: { recall: 6, application: 12, compare_contrast: 6, prediction: 0, misconception: 0 }, produceStep: "typed_explanation" as const, explanationFocus: "concept" as const, questionCap: 32, questionTarget: 32, workloadBounded: true },
    };
    const startedAt = Date.now();
    const diagnostics: Array<SlotDiagnostic & { part: number }> = [];
    const pendingCalls = new Set<Promise<unknown>>();
    const calls: Array<{ part: number; callId: number; schemaName: string; startedMs: number; instructions: string; input: unknown; maxOutputTokens: number; cacheKey: string; elapsedMs?: number; output?: unknown; outcome: "pending" | "returned" | "threw" }> = [];
    const results: ShapeSlotResponse[] = [];
    const partElapsedMs: number[] = [];
    let passed = false;
    try {
      let keyPoints: LearnBlockResponse["keyPoints"] = [];
      const prompts: string[] = [];
      for (let part = 1; part <= 4; part += 1) {
        const provider = openAIShapeSlotProvider({ onDiagnostic: event => diagnostics.push({ ...event, part }) });
        expect(provider, "CI synthetic generation requires a configured provider").not.toBeNull();
        if (!provider) throw new Error("Configured provider required");
        const capture: SlotProvider = async <T,>(call: SlotProviderCall<T>) => {
          const callStartedAt = Date.now();
          const entry: (typeof calls)[number] = { part, callId: calls.length + 1, schemaName: call.schemaName, startedMs: callStartedAt - startedAt, instructions: call.instructions, input: JSON.parse(call.input), maxOutputTokens: call.maxOutputTokens, cacheKey: call.cacheKey, outcome: "pending" };
          calls.push(entry);
          const operation = provider(call);
          pendingCalls.add(operation);
          try {
            const output = await operation;
            entry.output = output;
            entry.outcome = "returned";
            return output;
          } catch (error) {
            entry.outcome = "threw";
            throw error;
          } finally { entry.elapsedMs = Date.now() - callStartedAt; pendingCalls.delete(operation); }
        };
        capture.diagnose = provider.diagnose;
        const request = part === 1
          ? { ...base, action: "learn_block" as const, requestId: randomUUID(), recoveryKey: randomUUID() }
          : { ...base, action: "practice" as const, requestId: randomUUID(), recoveryKey: randomUUID(), round: 1, part: { index: part, count: 4 }, priorPrompts: [...prompts], keyPoints, outstandingKeyPointIds: [], excerpts: [], attempt: randomUUID(), roundKind: "active_recall" as const, repairTargets: [] };
        const partStartedAt = Date.now();
        const result = ShapeSlotResponseSchema.parse(await fillShapeSlot(request, capture));
        partElapsedMs.push(Date.now() - partStartedAt);
        results.push(result);
        if (result.action !== "learn_block" && result.action !== "practice") throw new Error("Expected questions");
        if (result.action === "learn_block") keyPoints = result.keyPoints;
        expect(result.questions.length, `part ${part}`).toBeLessThanOrEqual(8);
        expect(result.questions.length, `part ${part}`).toBeGreaterThanOrEqual(7);
        prompts.push(...result.questions.map(question => question.prompt));
        const partQuality = diagnostics.filter(event => event.part === part && event.stage === "quality");
        expect(partQuality.length, `part ${part} was reviewed`).toBeGreaterThan(0);
      }
      const questions = results.flatMap(result => result.action === "learn_block" || result.action === "practice" ? result.questions : []);
      expect(questions.length, "a dropped question may shorten the pass, never gut it").toBeGreaterThanOrEqual(30);
      expect(new Set(questions.map(question => question.prompt)).size, "no part repeats an earlier prompt").toBe(questions.length);
      expect(keyPoints.every(point => point.sourceTopicId === base.topic.id)).toBe(true);
      expect(questions.some(question => question.kind === "application")).toBe(true);
      for (const elapsed of partElapsedMs) expect(elapsed, "each part fits its own 50-second provider budget").toBeLessThan(50_000);
      passed = true;
    } finally {
      // A failed parallel call can finish before its siblings. Retain the
      // existing calls' outcomes too; this never schedules additional work.
      await Promise.allSettled([...pendingCalls]);
      const directory = resolve("artifacts/quality");
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, "practice-32-synthetic-trace.json"), JSON.stringify({ environment: "CI only; fixed synthetic osmosis input; real provider; no HTTP, auth, database or learner account; four parts, one provider budget each", passed, elapsedMs: Date.now() - startedAt, partElapsedMs, results, diagnostics, calls }, null, 2));
    }
  }, 240_000);
});
