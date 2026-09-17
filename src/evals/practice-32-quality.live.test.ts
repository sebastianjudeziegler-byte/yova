import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SlotDiagnostic, SlotProvider, SlotProviderCall } from "@/lib/openai/shape-slot-generator";
import { ShapeSlotResponseSchema, type LearnBlockRequest, type ShapeSlotResponse } from "@/lib/session-shapes/slots-schema";

vi.mock("server-only", () => ({}));

// Fixed synthetic input only. Full provider content belongs in this CI artifact,
// never production diagnostics or the ordinary test log. This deliberately uses
// the same topic and mix as the 32-question live API gate, without its HTTP/auth layer.
describe.skipIf(process.env.CI !== "true" || process.env.YOVA_RUN_LIVE_PRACTICE_QUALITY !== "1")("synthetic 32-question generation trace", () => {
  it("delivers all 32 reviewed questions within the unchanged shared provider budget", async () => {
    const { fillShapeSlot, openAIShapeSlotProvider } = await import("@/lib/openai/shape-slot-generator");
    const input: LearnBlockRequest = {
      action: "learn_block", requestId: randomUUID(), recoveryKey: randomUUID(), planId: randomUUID(), planSessionId: randomUUID(), tips: [],
      topic: {
        id: "b729504a-8746-4ef3-a4c2-d3b7116c8138", title: "Osmosis",
        description: "Predict net water movement from water potential and explain the role of a partially permeable membrane.",
        subtopics: ["Water potential", "Membrane permeability", "Plant cell turgor"], taskType: "conceptual_learning",
        learningGoal: "Prepare for A-level Biology application questions: predict the effect of unfamiliar conditions on water movement and justify the mechanism.",
      },
      modifiers: { instructionStyle: "standard", questionMix: { recall: 6, application: 12, compare_contrast: 6, prediction: 0, misconception: 0 }, produceStep: "typed_explanation", explanationFocus: "concept", questionCap: 32, questionTarget: 32, workloadBounded: true },
    };
    const startedAt = Date.now();
    const diagnostics: SlotDiagnostic[] = [];
    const pendingCalls = new Set<Promise<unknown>>();
    const calls: Array<{ callId: number; schemaName: string; startedMs: number; instructions: string; input: unknown; maxOutputTokens: number; cacheKey: string; elapsedMs?: number; output?: unknown; outcome: "pending" | "returned" | "threw" }> = [];
    let result: ShapeSlotResponse | undefined;
    let passed = false;
    try {
      const provider = openAIShapeSlotProvider({ onDiagnostic: event => diagnostics.push(event) });
      expect(provider, "CI synthetic generation requires a configured provider").not.toBeNull();
      if (!provider) throw new Error("Configured provider required");
      const capture: SlotProvider = async <T,>(call: SlotProviderCall<T>) => {
        const callStartedAt = Date.now();
        const entry: (typeof calls)[number] = { callId: calls.length + 1, schemaName: call.schemaName, startedMs: callStartedAt - startedAt, instructions: call.instructions, input: JSON.parse(call.input), maxOutputTokens: call.maxOutputTokens, cacheKey: call.cacheKey, outcome: "pending" };
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
      result = ShapeSlotResponseSchema.parse(await fillShapeSlot(input, capture));
      expect(result.action).toBe("learn_block");
      if (result.action !== "learn_block") throw new Error("Expected learn block");
      expect(result.questions).toHaveLength(32);
      expect(new Set(result.questions.map(question => question.prompt)).size).toBe(32);
      expect(result.keyPoints.every(point => point.sourceTopicId === input.topic.id)).toBe(true);
      expect(result.questions.some(question => question.kind === "application")).toBe(true);
      expect(diagnostics.filter(event => event.stage === "quality").at(-1)).toMatchObject({ outcome: "completed", rejectedCount: 0 });
      passed = true;
    } finally {
      // A failed parallel batch can finish before its siblings. Retain the
      // existing calls' outcomes too; this never schedules additional work.
      await Promise.allSettled([...pendingCalls]);
      const directory = resolve("artifacts/quality");
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, "practice-32-synthetic-trace.json"), JSON.stringify({ environment: "CI only; fixed synthetic osmosis input; real provider; no HTTP, auth, database or learner account", passed, elapsedMs: Date.now() - startedAt, input, result, diagnostics, calls }, null, 2));
    }
  }, 65_000);
});
