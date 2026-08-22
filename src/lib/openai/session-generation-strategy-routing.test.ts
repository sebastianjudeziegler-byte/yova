import { describe, expect, it, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import type {
  SessionGenerationContext,
  SessionGenerationRuntime,
} from "@/lib/openai/session-generator";

const generateStreamed = vi.hoisted(() => vi.fn(async (
  context: SessionGenerationContext,
  runtime: SessionGenerationRuntime,
) => {
  void context;
  void runtime;
  return { kind: "streamed" };
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/streamed-teaching-generator", () => ({
  generateStreamedTeachingSkeletonWithOpenAI: generateStreamed,
}));

describe("production session context preparation", () => {
  it("scopes a shortened teaching session before selecting and calling the streamed generator", async () => {
    const original = structuredClone(
      buildSessionEvaluationCases().find((entry) => entry.id === "biology_initial_teaching")!.context,
    );
    const targets = [
      "How a CRISPR guide RNA identifies a complementary DNA sequence",
      "Why an adjacent PAM sequence is required for Cas binding",
      "How mismatches and PAM placement change targeting specificity",
    ];
    original.session = {
      ...original.session,
      estimatedMinutes: 25,
      contentTargets: targets,
      completionEvidence: targets.map((target) => `Explain ${target}`),
    };
    original.sessionAdjustment = {
      availableMinutes: 15,
      familiarity: "need_teaching",
      knownTargets: [],
      note: "",
    };
    const runtime = { deadlineAt: Date.now() + 90_000 };

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    await generateProductionSessionWithOpenAI(original, runtime);

    expect(generateStreamed).toHaveBeenCalledTimes(1);
    const [prepared, forwardedRuntime] = generateStreamed.mock.calls[0]!;
    expect(prepared.session.estimatedMinutes).toBe(15);
    expect(prepared.session.contentTargets).toEqual(targets.slice(0, 2));
    expect(prepared.session.completionEvidence).toEqual([
      `Explain ${targets[0]}`,
      `Explain ${targets[1]}`,
    ]);
    expect(prepared.session.deferredContentTargets).toEqual([targets[2]]);
    expect(prepared.session.objective).toContain(targets[0]);
    expect(prepared.session.objective).not.toContain(targets[2]);
    expect(forwardedRuntime).toBe(runtime);
  });
});
