import { describe, expect, it, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";

vi.mock("server-only", () => ({}));

describe("production session generation strategy", () => {
  it("keeps fast common sessions reliable without flattening richer learning methods", async () => {
    const { sessionGenerationStrategy } = await import("@/lib/openai/session-generation-strategy");
    const cases = new Map(buildSessionEvaluationCases().map((entry) => [entry.id, entry.context]));
    const strategyFor = (id: string) => sessionGenerationStrategy(cases.get(id)!);

    expect(strategyFor("startup_funding_foundations")).toBe("reliable");
    expect(strategyFor("biology_initial_teaching")).toBe("reliable");
    expect(strategyFor("calculus_initial_teaching_15_min")).toBe("reliable");
    expect(strategyFor("short_vocabulary_review")).toBe("reliable");

    expect(strategyFor("calculus_delayed_retrieval_self_contained")).toBe("full");
    expect(strategyFor("history_writing_outside")).toBe("full");
    expect(strategyFor("javascript_scaffold_fading")).toBe("full");
    expect(strategyFor("literature_close_reading")).toBe("reliable");
  });
});
