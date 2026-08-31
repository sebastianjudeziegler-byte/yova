import { describe, expect, it } from "vitest";
import {
  CORE_METHOD_CATALOG,
  isRecognizedCoreMethodName,
  learningScienceCatalogForPrompt,
  METHOD_PRESENTATION_POLICY_VERSION,
  recognizedCoreMethodNames,
} from "@/lib/learning/method-catalog";

describe("learner-facing method catalog names", () => {
  it("exposes the launch catalog under recognizable names", () => {
    expect(METHOD_PRESENTATION_POLICY_VERSION).toBe("method_presentation_v2");
    expect(Object.fromEntries(Object.entries(CORE_METHOD_CATALOG).map(([id, method]) => (
      [id, method.name]
    )))).toMatchObject({
      retrieval_practice: "Active Recall",
      spaced_retrieval: "Spaced Repetition",
      worked_example_fading: "Worked Examples",
      interleaved_practice: "Interleaving",
      retrieval_based_outlining: "Outline from Memory",
      scaffolded_coding: "Trace–Code–Test",
      practice_test_error_repair: "Practice Tests",
      self_explanation: "Feynman Technique",
      read_recall_review: "SQ3R",
      pretesting: "Pretesting",
      concept_mapping: "Concept Mapping",
      practice_problems: "Practice Problems",
    });
  });

  it.each([
    ["retrieval_practice", "Retrieval practice"],
    ["spaced_retrieval", "Spaced retrieval"],
    ["worked_example_fading", "Worked example fading"],
    ["interleaved_practice", "Interleaved practice"],
    ["retrieval_based_outlining", "Retrieval-based outlining"],
    ["scaffolded_coding", "Scaffolded coding with fading"],
    ["practice_test_error_repair", "Practice test and error repair"],
    ["self_explanation", "Self-explanation"],
    ["read_recall_review", "Read-recall-review"],
  ] as const)("keeps the legacy %s label recognizable", (methodId, legacyName) => {
    expect(recognizedCoreMethodNames(methodId)).toContain(legacyName);
    expect(isRecognizedCoreMethodName(methodId, legacyName)).toBe(true);
  });

  it("hands the same recognizable names to session generation", () => {
    expect(learningScienceCatalogForPrompt([
      "retrieval_practice",
      "scaffolded_coding",
    ]).map(({ name }) => name)).toEqual([
      "Active Recall",
      "Trace–Code–Test",
    ]);
  });
});
