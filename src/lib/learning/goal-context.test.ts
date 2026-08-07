import { describe, expect, it } from "vitest";
import { assessGoalContext } from "@/lib/learning/goal-context";

describe("goal context assessment", () => {
  it.each([
    "Start Calc Unit 3",
    "Study chapter 5",
    "Help me with my biology unit 2 test",
    "Prepare for the upcoming chemistry exam",
    "Review module 4",
    "Study Calc U3",
    "Prepare for unit 3 next week",
    "Biology test Friday",
    "Start the first concept in Unit 3",
    "Review chapter five homework",
  ])("stops opaque class labels without content: %s", (goal) => {
    const result = assessGoalContext(goal);

    expect(result.hasEnoughContext).toBe(false);
    expect(result.message).toContain("actual concept");
  });

  it.each([
    "Practice the product rule for Calc Unit 3",
    "Review cellular respiration for my biology unit 2 test",
    "Study chapter 5 on the causes of the French Revolution",
    "Learn how compound interest works",
    "Help me understand derivatives",
    "Help me lern derivitives for calc unit 3",
    "Calc unit 3 limits and continuity",
    "Understand u-substitution for integrals",
    "Practice Spanish conversation basics",
  ])("allows a goal with an identifiable concept: %s", (goal) => {
    expect(assessGoalContext(goal).hasEnoughContext).toBe(true);
  });

  it("allows a class-local label when uploaded material supplies the missing scope", () => {
    expect(assessGoalContext("Start Calc Unit 3", true).hasEnoughContext).toBe(true);
  });
});
