import { describe, expect, it } from "vitest";
import {
  learningModeContract,
  resolveLearningIntent,
} from "@/lib/learning/learning-intent";

describe("learning approach router", () => {
  it("turns a concrete starting point into teaching-first without asking for technical terminology", () => {
    expect(resolveLearningIntent({
      goal: "Help me with derivative rules",
      startingPoint: "I've seen it, but it doesn't make sense yet",
    })).toMatchObject({ intent: "learn" });
  });

  it("turns an existing foundation into practice-first", () => {
    expect(resolveLearningIntent({
      goal: "Help me with derivative rules",
      startingPoint: "I understand the basics but need practice",
    })).toMatchObject({ intent: "study" });
  });

  it("uses demonstrated starting evidence when no plain-language starting point is supplied", () => {
    expect(resolveLearningIntent({
      goal: "Build knowledge of cellular respiration",
      diagnosticResponses: [
        { answer: "ATP", evaluation: "correct" },
        { answer: "Mitochondria", evaluation: "correct" },
      ],
    })).toMatchObject({ intent: "study" });
  });

  it("teaches first when a starting check consistently shows a missing foundation", () => {
    expect(resolveLearningIntent({
      goal: "Prepare for my biology exam",
      diagnosticResponses: [
        { answer: "A", evaluation: "incorrect" },
        { answer: "B", evaluation: "incorrect" },
      ],
    })).toMatchObject({ intent: "learn" });
  });

  it("teaches first when the user says they cannot explain the material yet", () => {
    expect(resolveLearningIntent({
      goal: "Prepare for my biology exam",
      diagnosticResponses: [
        { answer: "I cannot explain this yet", evaluation: "self_report" },
      ],
    })).toMatchObject({ intent: "learn" });
  });

  it("gives teaching and practice different first-activity contracts", () => {
    expect(learningModeContract("learn").firstActivityRule).toMatch(/teach|model/i);
    expect(learningModeContract("study").firstActivityRule).toMatch(/question|attempt/i);
  });
});
