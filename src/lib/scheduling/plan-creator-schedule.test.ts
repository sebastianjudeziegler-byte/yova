import { describe, expect, it } from "vitest";
import {
  configureAvailability,
  planCreatorScheduleReducer,
  type AvailabilityChoice,
  type PlanCreatorScheduleState,
} from "@/lib/scheduling/plan-creator-schedule";

const choices: AvailabilityChoice[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
].map((day, index) => ({
  day,
  dateLabel: `Oct ${index + 5}`,
  window: "Morning",
  minutes: 25,
  enabled: false,
}));

function state(): PlanCreatorScheduleState {
  return {
    deadlineDate: "2026-10-09",
    studyFrequency: "three_four",
    preferredWindows: ["Morning"],
    sessionLength: 25,
    customScheduleOpen: false,
    availabilityChoices: configureAvailability(choices, "three_four", ["Morning"], 25, "Evening"),
    recommendedWindow: "Evening",
  };
}

describe("plan creator schedule state", () => {
  it("applies each quick choice to the availability it describes", () => {
    const frequency = planCreatorScheduleReducer(state(), {
      type: "choose_frequency",
      frequency: "one_two",
    });
    expect(frequency.availabilityChoices.map((choice) => choice.enabled))
      .toEqual([false, true, false, false, true, false, false]);

    const twoWindows = planCreatorScheduleReducer(frequency, {
      type: "toggle_window",
      window: "Evening",
    });
    expect(twoWindows.preferredWindows).toEqual(["Morning", "Evening"]);
    expect(twoWindows.availabilityChoices.filter((choice) => choice.enabled).map((choice) => choice.window))
      .toEqual(["Evening", "Morning"]);

    const longer = planCreatorScheduleReducer(twoWindows, {
      type: "choose_session_length",
      minutes: 45,
    });
    expect(longer.availabilityChoices.every((choice) => choice.minutes === 45)).toBe(true);

    const anytime = planCreatorScheduleReducer(longer, {
      type: "toggle_window",
      window: "Anytime",
    });
    expect(anytime.preferredWindows).toEqual(["Anytime"]);
    expect(anytime.availabilityChoices.every((choice) => choice.window === "Evening")).toBe(true);
  });

  it("preserves an explicit deadline through every rhythm and custom-calendar change", () => {
    const actions = [
      { type: "choose_frequency", frequency: "every_day" } as const,
      { type: "toggle_window", window: "Afternoon" } as const,
      { type: "choose_session_length", minutes: 60 } as const,
      { type: "set_custom_open", open: true } as const,
      { type: "toggle_day", index: 2 } as const,
      { type: "set_day_window", index: 0, window: "Evening" } as const,
      { type: "set_day_minutes", index: 0, minutes: 30 } as const,
      { type: "set_custom_open", open: false } as const,
    ];

    const result = actions.reduce(planCreatorScheduleReducer, state());

    expect(result.deadlineDate).toBe("2026-10-09");
  });

  it("changes only the deadline when the learner edits the date field", () => {
    const before = state();
    const after = planCreatorScheduleReducer(before, {
      type: "set_deadline",
      deadlineDate: "2026-11-02",
    });

    expect(after).toEqual({ ...before, deadlineDate: "2026-11-02" });
  });
});
