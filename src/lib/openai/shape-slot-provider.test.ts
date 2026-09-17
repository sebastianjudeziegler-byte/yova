import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { APIConnectionTimeoutError } from "openai";
const mocks = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/config", () => ({ getOpenAISessionConfig: () => ({ model: "test-model" }) }));
vi.mock("@/lib/openai/client", () => ({ getOpenAIClient: () => ({ responses: { parse: mocks.parse } }) }));
import { openAIShapeSlotProvider } from "./shape-slot-generator";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe("shape provider route budget", () => {
  it("bounds every call and refuses another model call after the shared deadline", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    mocks.parse.mockResolvedValue({ status: "completed", output_parsed: { result: "ok" } });
    const provider = openAIShapeSlotProvider()!;
    const input = { instructions: "Check context", input: "{}", schema: z.object({ result: z.string() }).strict(), schemaName: "test_shape", maxOutputTokens: 100, cacheKey: "test" };
    expect(await provider(input)).toEqual({ result: "ok" });
    expect(mocks.parse.mock.calls[0]?.[1]).toEqual({ maxRetries: 0, timeout: 20_000 });
    vi.setSystemTime(47_000);
    expect(await provider(input)).toEqual({ result: "ok" });
    expect(mocks.parse.mock.calls[1]?.[1]).toEqual({ maxRetries: 0, timeout: 1_000 });
    vi.setSystemTime(49_000);
    expect(await provider(input)).toBeNull();
    expect(mocks.parse).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: "completed", output_parsed: { result: "private generated content" }, outcome: "completed" },
    { status: "incomplete", output_parsed: { result: "private generated content" }, outcome: "incomplete" },
    { status: "completed", output_parsed: { unexpected: "private generated content" }, outcome: "invalid" },
  ])("records bounded $outcome timing without provider content", async ({ outcome, ...response }) => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const onDiagnostic = vi.fn();
    const provider = openAIShapeSlotProvider({ onDiagnostic })!;
    mocks.parse.mockImplementation(async () => { vi.setSystemTime(5_500); return response; });
    await provider({ instructions: "private instructions", input: "private learner input", schema: z.object({ result: z.string() }).strict(), schemaName: "test_shape", maxOutputTokens: 100, cacheKey: "test", questionCount: 8, purpose: "quality_repair" });
    expect(onDiagnostic).toHaveBeenCalledExactlyOnceWith({ traceId: expect.any(String), stage: "provider", schemaName: "test_shape", callId: 1, outcome, elapsedMs: 4_500, totalElapsedMs: 4_500, remainingBudgetMs: 45_500, timeoutMs: 20_000, questionCount: 8, purpose: "quality_repair" });
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain("private");
  });

  it("distinguishes a timeout from a deadline refusal without logging error messages", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const onDiagnostic = vi.fn();
    const provider = openAIShapeSlotProvider({ onDiagnostic })!;
    const input = { instructions: "private instructions", input: "private learner input", schema: z.object({ result: z.string() }).strict(), schemaName: "test_shape", maxOutputTokens: 100, cacheKey: "test" };
    const failure = new APIConnectionTimeoutError({ message: "private error body" });
    mocks.parse.mockImplementation(async () => { vi.setSystemTime(20_000); throw failure; });
    await expect(provider(input)).rejects.toBe(failure);
    vi.setSystemTime(49_000);
    expect(await provider(input)).toBeNull();
    expect(onDiagnostic.mock.calls.map(([event]) => event)).toEqual([
      { traceId: expect.any(String), stage: "provider", schemaName: "test_shape", callId: 1, outcome: "timeout", elapsedMs: 20_000, totalElapsedMs: 20_000, remainingBudgetMs: 30_000, timeoutMs: 20_000 },
      { traceId: expect.any(String), stage: "provider", schemaName: "test_shape", callId: 2, outcome: "deadline", elapsedMs: 0, totalElapsedMs: 49_000, remainingBudgetMs: 1_000, timeoutMs: 0 },
    ]);
    expect(onDiagnostic.mock.calls[0]![0].traceId).toBe(onDiagnostic.mock.calls[1]![0].traceId);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain("private");
  });

  it("does not turn successful generation into failure when the diagnostic sink fails", async () => {
    const provider = openAIShapeSlotProvider({ onDiagnostic: () => { throw new Error("sink unavailable"); } })!;
    mocks.parse.mockResolvedValue({ status: "completed", output_parsed: { result: "ok" } });
    await expect(provider({ instructions: "Check context", input: "{}", schema: z.object({ result: z.string() }).strict(), schemaName: "test_shape", maxOutputTokens: 100, cacheKey: "test" })).resolves.toEqual({ result: "ok" });
    expect(mocks.parse).toHaveBeenCalledTimes(1);
  });
});
