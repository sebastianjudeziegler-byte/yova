import { describe, expect, it } from "vitest";
import { deadlineDateFromGoal, frequencyIndexes, recommendStudySchedule } from "@/lib/personalization/study-schedule";

describe("study schedule personalization", () => {
  it("uses the learner's explicit energy window and realistic session length", () => {
    const recommendation = recommendStudySchedule(
      "What study-session length usually feels realistic? 20 to 30 minutes When do you usually have the most usable energy? Evening",
    );

    expect(recommendation.window).toBe("Evening");
    expect(recommendation.minutes).toBe(25);
    expect(recommendation.reason).toContain("most usable energy");
  });

  it("recommends more frequent bounded starts when consistency is a stated problem", () => {
    const recommendation = recommendStudySchedule(
      "What most often makes studying difficult? I struggle to start What study-session length usually feels realistic? 10 to 15 minutes When do you usually have the most usable energy? Morning",
    );

    expect(recommendation.frequency).toBe("most_days");
    expect(recommendation.minutes).toBe(15);
  });

  it("keeps an unknown time preference flexible", () => {
    const recommendation = recommendStudySchedule("No established behavioral preferences yet.");

    expect(recommendation.window).toBe("Anytime");
    expect(recommendation.minutes).toBe(25);
  });

  it("spreads three-to-four-day plans instead of stacking consecutive days", () => {
    expect(frequencyIndexes("three_four")).toEqual([0, 2, 4, 6]);
  });

  it("turns natural relative deadlines into a target date", () => {
    expect(deadlineDateFromGoal("I have a history test in two weeks", new Date("2026-08-07T12:00:00")))
      .toBe("2026-08-21");
    expect(deadlineDateFromGoal("Review this in 3 days", new Date("2026-08-07T12:00:00")))
      .toBe("2026-08-10");
  });
});
