import { describe, expect, it } from "vitest";
import {
  inferSessionFamiliarityFromText,
  isWorkProductGoal,
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

  it.each([
    ["Prepare a persuasive speech about climate policy", "Not started"],
    ["Build a presentation with speaker notes; I have not started it yet", ""],
    ["Draft a comparative history essay", "I haven't begun"],
    ["Draft a comparative history thesis using textbook evidence", ""],
  ])("gives an unstarted work product a supported Learn start: %s", (goal, startingPoint) => {
    expect(resolveLearningIntent({ goal, startingPoint })).toMatchObject({
      intent: "learn",
      reason: expect.stringMatching(/supported model|first draft|rehearsal/i),
    });
  });

  it("treats preparation of a work product differently from preparation for an exam", () => {
    expect(resolveLearningIntent({
      goal: "Prepare a presentation about the July Crisis",
    })).toMatchObject({ intent: "learn" });
    expect(resolveLearningIntent({
      goal: "Prepare for a biology exam on cellular respiration",
    })).toMatchObject({ intent: "study" });
  });

  it("does not treat generic not-started wording as missing knowledge", () => {
    expect(resolveLearningIntent({
      goal: "Review derivative rules for tomorrow's exam",
      startingPoint: "Not started",
    })).toMatchObject({ intent: "study" });
  });

  it.each([
    "I have not started my essay",
    "I need help with my persuasive speech",
    "My presentation is due tomorrow",
    "I have a 1,500-word history essay due in 14 days and I have not started yet",
    "My persuasive speech about renewable energy is due in 14 days and I have not started it yet",
    "I need to build a biology presentation with slides and speaker notes due in 14 days and I have not started yet",
  ])("recognizes an explicitly owned or requested work product: %s", (goal) => {
    expect(isWorkProductGoal(goal)).toBe(true);
    expect(resolveLearningIntent({ goal })).toMatchObject({ intent: "learn" });
  });

  it("lets explicit unstarted artifact evidence override only the generic Study Now practice default", () => {
    const startingPoint = "I understand the basics but need practice";
    expect(resolveLearningIntent({
      goal: "I have not started my essay",
      startingPoint,
    })).toMatchObject({ intent: "learn" });
    expect(resolveLearningIntent({
      goal: "Revise my existing essay",
      startingPoint,
    })).toMatchObject({ intent: "study" });
  });

  it.each([
    "Read and study a research paper due Friday for a quiz",
    "Practice biology questions from the presentation slides before the final",
    "Prepare from my presentation slides for the biology exam",
    "The research paper is assigned reading and I have not started studying it for the quiz",
  ])("keeps a paper or slides used as study material on the ordinary learning path: %s", (goal) => {
    expect(isWorkProductGoal(goal)).toBe(false);
    expect(resolveLearningIntent({ goal })).toMatchObject({ intent: "study" });
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
