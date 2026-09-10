import { describe, expect, it, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";

vi.mock("server-only", () => ({}));

describe("legacy V15/V17 strategy compatibility", () => {
  it("keeps fast common sessions reliable without flattening richer learning methods", async () => {
    const { legacySessionGenerationStrategy } = await import("@/evals/legacy-generation-harness");
    const cases = new Map(buildSessionEvaluationCases().map((entry) => [entry.id, entry.context]));
    const strategyFor = (id: string) => legacySessionGenerationStrategy(cases.get(id)!);

    expect(strategyFor("startup_funding_foundations")).toBe("streamed");
    expect(strategyFor("biology_initial_teaching")).toBe("streamed");
    expect(strategyFor("calculus_initial_teaching_15_min")).toBe("streamed");
    expect(strategyFor("short_vocabulary_review")).toBe("reliable");

    expect(strategyFor("calculus_delayed_retrieval_self_contained")).toBe("full");
    expect(strategyFor("bioenergetics_multi_target_study")).toBe("full");
    expect(strategyFor("calculus_demonstrated_foundations_study_25")).toBe("full");
    expect(strategyFor("history_writing_outside")).toBe("full");
    expect(strategyFor("javascript_scaffold_fading")).toBe("streamed");
    expect(strategyFor("literature_close_reading")).toBe("streamed");
  });

  it("streams every ordinary inside-YOVA teaching-first session, including older plans", async () => {
    const { legacySessionGenerationStrategy } = await import("@/evals/legacy-generation-harness");
    const cases = new Map(buildSessionEvaluationCases().map((entry) => [entry.id, entry.context]));
    const learn = cases.get("biology_initial_teaching")!;
    const review = cases.get("calculus_delayed_retrieval_self_contained")!;
    const outside = cases.get("history_writing_outside")!;

    expect(legacySessionGenerationStrategy({ ...learn, sessionArchitectureVersion: "streamed_teaching_v1" })).toBe("streamed");
    expect(legacySessionGenerationStrategy({ ...review, sessionArchitectureVersion: "streamed_teaching_v1" })).toBe("full");
    expect(legacySessionGenerationStrategy({ ...outside, sessionArchitectureVersion: "streamed_teaching_v1" })).toBe("full");
    expect(legacySessionGenerationStrategy(learn)).toBe("streamed");
  });

  it("does not let overdue evidence from another plan topic change today's generation path", async () => {
    const { legacySessionGenerationStrategy } = await import("@/evals/legacy-generation-harness");
    const cases = new Map(buildSessionEvaluationCases().map((entry) => [entry.id, entry.context]));
    const ordinary = structuredClone(cases.get("short_vocabulary_review")!);
    ordinary.conceptSignals = [{
      topicId: "99999999-9999-4999-8999-999999999999",
      concept: "Managerial accounting",
      attempts: 1,
      secureAttempts: 0,
      needsReviewAttempts: 1,
      lastOutcome: "needs_review",
      lastObservedAt: "2026-08-18T18:00:00.000Z",
      status: "needs_review",
    }];

    expect(legacySessionGenerationStrategy(ordinary)).toBe("reliable");

    ordinary.conceptSignals[0] = {
      ...ordinary.conceptSignals[0]!,
      topicId: ordinary.session.topicIds[0],
    };
    ordinary.knowledgeTopics[0] = {
      ...ordinary.knowledgeTopics[0]!,
      subtopics: [...ordinary.knowledgeTopics[0]!.subtopics, "Managerial accounting"],
    };
    expect(legacySessionGenerationStrategy(ordinary)).toBe("reliable");

    ordinary.conceptSignals[0] = {
      ...ordinary.conceptSignals[0]!,
      concept: ordinary.session.title,
    };
    expect(legacySessionGenerationStrategy(ordinary)).toBe("full");
  });
});
