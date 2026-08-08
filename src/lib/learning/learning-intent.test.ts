import { describe, expect, it } from "vitest";
import {
  inferSessionFamiliarityFromText,
  learningModeContract,
  resolveEffectiveSessionLearningMode,
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

  it("treats completely new and know nothing as hard teaching-first signals", () => {
    expect(resolveLearningIntent({
      goal: "Prepare for a World War I test",
      diagnosticResponses: [
        { answer: "Completely new", evaluation: "self_report" },
        { answer: "I know nothing about this yet", evaluation: "self_report" },
      ],
    })).toMatchObject({ intent: "learn" });
  });

  it("turns plain session notes about ground zero into a teaching-first override", () => {
    expect(inferSessionFamiliarityFromText("I'm starting from ground zero pretty much")).toBe("need_teaching");
    expect(inferSessionFamiliarityFromText("I already know the basics and want a harder check")).toBe("challenge_me");
    expect(inferSessionFamiliarityFromText("Continue with the current plan")).toBeNull();
  });

  it("repairs a stale practice-first session before a new learner has received teaching", () => {
    expect(resolveEffectiveSessionLearningMode({
      planLearningIntent: "learn",
      plannedMode: "study",
      completedSessionCount: 0,
      familiarity: "as_planned",
    })).toBe("learn");
  });

  it("allows explicit learner overrides and later planned practice", () => {
    expect(resolveEffectiveSessionLearningMode({
      planLearningIntent: "learn",
      plannedMode: "learn",
      completedSessionCount: 0,
      familiarity: "challenge_me",
    })).toBe("study");
    expect(resolveEffectiveSessionLearningMode({
      planLearningIntent: "learn",
      plannedMode: "study",
      completedSessionCount: 1,
    })).toBe("study");
  });

  it("gives teaching and practice different first-activity contracts", () => {
    expect(learningModeContract("learn").firstActivityRule).toMatch(/teach|model/i);
    expect(learningModeContract("study").firstActivityRule).toMatch(/question|attempt/i);
  });
});
