import { describe, expect, it } from "vitest";
import type { CoreMethodId } from "@/lib/learning/method-catalog";
import type { MethodOutcomeSignal } from "@/lib/personalization/method-outcomes";
import {
  rankMethodsByLearnerFit,
  type DeclaredProfileText,
} from "@/lib/learning/method-preference-fit";

function observedSignal(
  methodId: CoreMethodId,
  status: MethodOutcomeSignal["status"],
  sessions: number,
): MethodOutcomeSignal {
  return {
    methodId,
    methodName: methodId.replaceAll("_", " "),
    taskType: "conceptual_learning",
    knowledgeStage: "developing",
    comparisonLabel: "conceptual learning · developing knowledge",
    sessions,
    checkedAnswers: sessions * 4,
    accuracyPercent: 80,
    difficultRatings: 0,
    status,
    evidence: "test fixture",
    deliveryGuidance: "test fixture",
  };
}

const exampleLearner: DeclaredProfileText = {
  explanationPreference: "A concrete example first",
};

describe("rankMethodsByLearnerFit", () => {
  it("returns null when no method is eligible", () => {
    expect(rankMethodsByLearnerFit({
      eligibleMethodIds: [],
      declaredProfile: exampleLearner,
      observedSignals: [],
    })).toBeNull();
  });

  it("never introduces a method that was not eligible", () => {
    const ranking = rankMethodsByLearnerFit({
      eligibleMethodIds: ["retrieval_practice", "spaced_retrieval"],
      // Mentions examples, which maps to worked_example_fading.
      declaredProfile: exampleLearner,
      observedSignals: [observedSignal("worked_example_fading", "promising", 9)],
    });

    expect(ranking?.orderedMethodIds).toEqual(["retrieval_practice", "spaced_retrieval"]);
    expect(ranking?.selectedMethodId).toBe("retrieval_practice");
  });

  it("keeps catalog order when the learner has told YOVA nothing relevant", () => {
    const ranking = rankMethodsByLearnerFit({
      eligibleMethodIds: ["self_explanation", "read_recall_review", "retrieval_practice"],
      declaredProfile: null,
      observedSignals: [],
    });

    expect(ranking?.orderedMethodIds).toEqual([
      "self_explanation",
      "read_recall_review",
      "retrieval_practice",
    ]);
    expect(ranking?.changedFromBaseline).toBe(false);
    expect(ranking?.learnerFacingReason).toBeNull();
  });

  it("lets a declared preference choose between methods that are all valid", () => {
    const ranking = rankMethodsByLearnerFit({
      // worked_example_fading is last by catalog order here.
      eligibleMethodIds: ["interleaved_practice", "practice_test_error_repair", "worked_example_fading"],
      declaredProfile: exampleLearner,
      observedSignals: [],
    });

    expect(ranking?.selectedMethodId).toBe("worked_example_fading");
    expect(ranking?.changedFromBaseline).toBe(true);
    expect(ranking?.learnerFacingReason).toContain("concrete example");
  });

  it("does not let one comparable session overturn a stated preference", () => {
    const ranking = rankMethodsByLearnerFit({
      eligibleMethodIds: ["interleaved_practice", "worked_example_fading"],
      declaredProfile: exampleLearner,
      observedSignals: [observedSignal("interleaved_practice", "promising", 1)],
    });

    expect(ranking?.selectedMethodId).toBe("worked_example_fading");
  });

  it("lets repeated observed results outweigh what the learner said", () => {
    const ranking = rankMethodsByLearnerFit({
      eligibleMethodIds: ["interleaved_practice", "worked_example_fading"],
      declaredProfile: exampleLearner,
      observedSignals: [observedSignal("interleaved_practice", "promising", 6)],
    });

    expect(ranking?.selectedMethodId).toBe("interleaved_practice");
    expect(ranking?.learnerFacingReason).toContain("went well");
  });

  it("demotes a method that has repeatedly needed more support", () => {
    const ranking = rankMethodsByLearnerFit({
      eligibleMethodIds: ["retrieval_practice", "spaced_retrieval"],
      declaredProfile: null,
      observedSignals: [observedSignal("retrieval_practice", "needs_more_support", 6)],
    });

    expect(ranking?.selectedMethodId).toBe("spaced_retrieval");
  });

  it("produces the same route for the same inputs", () => {
    const input = {
      eligibleMethodIds: ["self_explanation", "retrieval_practice", "spaced_retrieval"] as CoreMethodId[],
      declaredProfile: exampleLearner,
      observedSignals: [observedSignal("retrieval_practice", "early_signal", 2)],
    };

    expect(rankMethodsByLearnerFit(input)).toEqual(rankMethodsByLearnerFit(input));
  });

  it("records both the declared and observed reasons behind the winning method", () => {
    const ranking = rankMethodsByLearnerFit({
      eligibleMethodIds: ["interleaved_practice", "worked_example_fading"],
      declaredProfile: exampleLearner,
      observedSignals: [observedSignal("worked_example_fading", "promising", 6)],
    });

    const winner = ranking?.scores[0];
    expect(winner?.methodId).toBe("worked_example_fading");
    expect(winner?.signals.map((signal) => signal.source)).toEqual(
      expect.arrayContaining(["declared", "observed"]),
    );
    expect(ranking?.learnerFacingReason).toContain(" and ");
  });

  it("explains a preference match even when it agrees with the default method", () => {
    const ranking = rankMethodsByLearnerFit({
      eligibleMethodIds: ["worked_example_fading", "self_explanation"],
      declaredProfile: exampleLearner,
      observedSignals: [],
    });

    expect(ranking?.changedFromBaseline).toBe(false);
    expect(ranking?.learnerFacingReason).toContain("also fits how you work");
  });
});
