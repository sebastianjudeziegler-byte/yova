import { describe, expect, it } from "vitest";
import {
  workProductKindForPlan,
  workProductPlanCopy,
} from "@/lib/learning/work-product-plan";

describe("work-product plan presentation", () => {
  it.each([
    ["Draft a 1,500-word history essay", "writing", "DRAFT AND REFINE"],
    ["Prepare a persuasive speech about climate policy", "speech", "REHEARSE AND REFINE"],
    ["Build a biology presentation with speaker notes", "presentation", "BUILD AND REHEARSE"],
    ["I have a 1,500-word history essay due in 14 days and I have not started yet", "writing", "DRAFT AND REFINE"],
    ["My persuasive speech about renewable energy is due in 14 days and I have not started it yet", "speech", "REHEARSE AND REFINE"],
    ["I need to build a biology presentation with slides and speaker notes due in 14 days and I have not started yet", "presentation", "BUILD AND REHEARSE"],
  ] as const)("presents %s as artifact work", (goal, kind, label) => {
    expect(workProductKindForPlan(goal)).toBe(kind);
    expect(workProductPlanCopy(goal)).toMatchObject({ kind, sessionModeLabel: label });
  });

  it.each([
    "Prepare for a biology exam",
    "Study a research paper about climate policy",
    "Learn how public speaking affects an audience",
    "Review lecture slides for a quiz",
    "The research paper is assigned reading and I have not started studying it for the quiz",
  ])("does not hide Learn or Practice for knowledge work: %s", (goal) => {
    expect(workProductKindForPlan(goal)).toBeNull();
    expect(workProductPlanCopy(goal)).toBeNull();
  });

  it("keeps unsupported generic projects on the ordinary flow", () => {
    expect(workProductKindForPlan("Build my capstone project for submission")).toBeNull();
  });
});
