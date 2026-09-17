import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
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
});
